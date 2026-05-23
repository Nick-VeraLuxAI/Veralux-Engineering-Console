import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  getEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { buildApprovalReport } from "../../approval/approval-report";
import { handleApprovalAction } from "../../orchestrator/run-orchestrator";
import { saveApprovalReport, createRun, saveQualityGateResults } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../governance-engine";
import {
  getEvidenceBundleForRun,
  refreshRunEvidenceBundle,
} from "../evidence-bundles/evidence-bundle-manager";
import { createDecisionRecord } from "../decision-records/create-decision-record";
import { AUDIT_ACTOR_TYPES } from "../audit-ledger/audit-event-types";
import {
  buildRedactedReplayPackage,
  buildReplayPackageForRun,
  runReplayVerification,
  verifyRunReplay,
} from "./replay-verification-manager";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-replay-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "replay-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

function seedRunWithApproval() {
  const task = createTask({ title: "Replay task", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  const report = buildApprovalReport({
    task,
    run: { ...run, status: "waiting_for_approval", branchName: "engineer/test" },
    changedFiles: ["src/a.ts"],
    diffSummary: "1 file changed",
    governance: assessChangedFiles(["src/a.ts"]),
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  return { task, run, report };
}

async function seedApprovedRun() {
  const seeded = seedRunWithApproval();
  await refreshRunEvidenceBundle({ runId: seeded.run.id });
  await handleApprovalAction(seeded.run.id, "approve", { rationale: "ok" });
  return seeded;
}

describe("replay verification", () => {
  it("valid approved run replay passes or warns only", async () => {
    const { run } = await seedApprovedRun();
    const result = verifyRunReplay(run.id);
    expect(result.summary.failed).toBe(0);
    expect(result.checks.some((c) => c.code === "EVIDENCE_BUNDLE_HASH" && c.status === "passed")).toBe(
      true,
    );
    expect(result.checks.some((c) => c.code === "FINAL_STATE" && c.status === "passed")).toBe(true);
  });

  it("evidence bundle hash tamper fails", async () => {
    const { run } = await seedApprovedRun();
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_run_evidence_bundles SET bundle_hash = 'deadbeef' WHERE run_id = ?`)
      .run(run.id);
    const result = verifyRunReplay(run.id);
    expect(result.status).toBe("failed");
    expect(result.checks.some((c) => c.code === "EVIDENCE_BUNDLE_HASH" && c.status === "failed")).toBe(
      true,
    );
  });

  it("missing evidence bundle fails for approved run", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    await handleApprovalAction(run.id, "approve", { rationale: "approved for replay test" });
    getEngineerConsoleDb()
      .prepare(`DELETE FROM engineer_run_evidence_bundles WHERE run_id = ?`)
      .run(run.id);
    const result = verifyRunReplay(run.id);
    expect(result.checks.some((c) => c.code === "EVIDENCE_BUNDLE_PRESENT" && c.status === "failed")).toBe(
      true,
    );
  });

  it("decision record missing evidence hash fails", async () => {
    const { run } = await seedApprovedRun();
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_decision_records SET evidence_bundle_hash = NULL WHERE run_id = ?`)
      .run(run.id);
    const result = verifyRunReplay(run.id);
    expect(result.checks.some((c) => c.code === "DECISION_EVIDENCE_LINK" && c.status === "failed")).toBe(
      true,
    );
  });

  it("approved decision with canApprove false fails", async () => {
    const { run } = await seedApprovedRun();
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_decision_records SET can_approve = 0 WHERE run_id = ?`)
      .run(run.id);
    const result = verifyRunReplay(run.id);
    expect(result.checks.some((c) => c.code === "APPROVAL_CONSISTENCY" && c.status === "failed")).toBe(
      true,
    );
  });

  it("quality gate count mismatch fails", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    saveQualityGateResults(run.id, [
      {
        id: "g1",
        runId: run.id,
        command: "npm test",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        status: "passed",
        createdAt: new Date().toISOString(),
      },
    ]);
    const result = verifyRunReplay(run.id);
    expect(
      result.checks.some((c) => c.code === "QUALITY_GATE_SUMMARY" && c.status === "failed"),
    ).toBe(true);
  });

  it("worker plan reference missing fails", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    const bundle = getEvidenceBundleForRun(run.id)!;
    const parsed = JSON.parse(bundle.bundleJson) as Record<string, unknown>;
    parsed.workerPlan = {
      workerPlanId: "missing-plan-id",
      summary: "x",
      validationStatus: "valid",
      executionStatus: "executed",
      operationCount: 1,
      executedCount: 1,
      errorCount: 0,
    };
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_run_evidence_bundles SET bundle_json = @json WHERE run_id = @run_id`)
      .run({ run_id: run.id, json: JSON.stringify(parsed) });
    const result = verifyRunReplay(run.id);
    expect(
      result.checks.some((c) => c.code === "WORKER_PLAN_REFERENCE" && c.status === "failed"),
    ).toBe(true);
  });

  it("request_fix creates decision and final state check", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    await handleApprovalAction(run.id, "request_fix", { rationale: "needs work" });
    const result = verifyRunReplay(run.id);
    expect(result.checks.some((c) => c.code === "DECISION_RECORD_TYPE" && c.status === "passed")).toBe(
      true,
    );
  });

  it("replay package excludes raw prompts and full logs", async () => {
    const { run } = await seedApprovedRun();
    const pkg = buildRedactedReplayPackage(run.id);
    const json = JSON.stringify(pkg);
    expect(json).not.toContain("rawResponse");
    expect(json).not.toContain("stdout");
    expect(json).not.toContain("/tmp/repo");
    expect(pkg.packageVersion).toBe("engineer_replay_package_v1");
  });

  it("runReplayVerification emits audit events", async () => {
    const { run } = await seedApprovedRun();
    runReplayVerification(run.id);
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.REPLAY_VERIFICATION_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.REPLAY_VERIFICATION_COMPLETED);
  });

  it("buildReplayPackageForRun returns structured verification", async () => {
    const { run } = await seedApprovedRun();
    const pkg = buildReplayPackageForRun(run.id);
    expect(pkg.verification.runId).toBe(run.id);
    expect(pkg.auditEventHashes.length).toBeGreaterThan(0);
  });

  it("model actor cannot approve via decision path is separate", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    expect(() =>
      createDecisionRecord({
        runId: run.id,
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
      }),
    ).toThrow(/Model actors cannot approve/);
  });
});
