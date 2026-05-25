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
import { buildApprovalReport } from "../../approval/approval-report";
import { handleApprovalAction } from "../../orchestrator/run-orchestrator";
import { saveApprovalReport, createRun, saveQualityGateResults, updateRun, getRunById } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../governance-engine";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { refreshRunEvidenceBundle } from "../evidence-bundles/evidence-bundle-manager";
import { DEFAULT_ENGINEERING_POLICY } from "./default-engineering-policy";
import { evaluateRunPolicy } from "./evaluate-run-policy";
import { hashPolicyDefinition } from "./hash-policy";
import {
  getLatestPolicyEvaluationResult,
  listPolicyResultsForRun,
  runPolicyEvaluation,
  toPublicPolicyResult,
} from "./policy-result-manager";
import { runReplayVerification } from "../replay-verification/replay-verification-manager";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-policy-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "policy-test";
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

function seedRunWithApproval(overrides?: {
  changedFiles?: string[];
  governance?: ReturnType<typeof assessChangedFiles>;
  runStatus?: string;
}) {
  const changedFiles = overrides?.changedFiles ?? ["src/a.ts"];
  const governance = overrides?.governance ?? assessChangedFiles(changedFiles);
  const task = createTask({ title: "Policy task", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  updateRun(run.id, {
    status: (overrides?.runStatus ?? "waiting_for_approval") as "waiting_for_approval",
    branchName: "engineer/test",
    riskLevel: governance.riskLevel,
    governanceNotes: JSON.stringify(governance),
  });
  const report = buildApprovalReport({
    task,
    run: {
      ...run,
      status: "waiting_for_approval",
      branchName: "engineer/test",
      riskLevel: governance.riskLevel,
      governanceNotes: JSON.stringify(governance),
    },
    changedFiles,
    diffSummary: "1 file changed",
    governance,
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  return { task, run, report, governance };
}

async function seedWithEvidenceAndPolicy() {
  const seeded = seedRunWithApproval();
  runPolicyEvaluation(seeded.run.id, { persist: true, audit: false });
  await refreshRunEvidenceBundle({ runId: seeded.run.id });
  return seeded;
}

describe("policy results", () => {
  it("default policy hash is stable", () => {
    const first = hashPolicyDefinition(DEFAULT_ENGINEERING_POLICY);
    const second = hashPolicyDefinition(DEFAULT_ENGINEERING_POLICY);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates persisted policy result", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    const result = runPolicyEvaluation(run.id, { persist: true, audit: false });
    expect(result.status).toBe("requires_review");
    const stored = listPolicyResultsForRun(run.id);
    expect(stored.length).toBe(1);
    expect(stored[0]!.policyVersion).toBe(DEFAULT_ENGINEERING_POLICY.version);
  });

  it("blocks on failed quality gate", () => {
    const { run } = seedRunWithApproval();
    saveQualityGateResults(run.id, [
      {
        id: "g1",
        runId: run.id,
        command: "npm test",
        stdout: "fail",
        stderr: "",
        exitCode: 1,
        durationMs: 10,
        status: "failed",
        createdAt: new Date().toISOString(),
      },
    ]);
    const result = evaluateRunPolicy(run.id);
    expect(result.status).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("Quality gate"))).toBe(true);
  });

  it("blocks on blocked governance risk", () => {
    const governance = assessChangedFiles([".env"]);
    const { run } = seedRunWithApproval({ changedFiles: [".env"], governance });
    const result = evaluateRunPolicy(run.id);
    expect(result.status).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("Governance risk") || b.includes("Protected path"))).toBe(
      true,
    );
  });

  it("requires review on high governance risk", async () => {
    const governance = assessChangedFiles(["package-lock.json"]);
    const { run } = seedRunWithApproval({ changedFiles: ["package-lock.json"], governance });
    await refreshRunEvidenceBundle({ runId: run.id });
    const result = evaluateRunPolicy(run.id);
    expect(result.status).toBe("requires_review");
    expect(result.reviewRequired.some((r) => r.includes("package-lock"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("high"))).toBe(true);
  });

  it("warns on replay verification warnings", async () => {
    const { run } = await seedWithEvidenceAndPolicy();
    runReplayVerification(run.id, { persist: true, audit: false });
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_run_evidence_bundles SET bundle_hash = 'deadbeef' WHERE run_id = ?`)
      .run(run.id);
    runReplayVerification(run.id, { persist: true, audit: false });
    const result = getLatestPolicyEvaluationResult(run.id);
    expect(result?.warnings.some((w) => w.includes("Replay verification"))).toBe(true);
  });

  it("blocks on replay verification failure", async () => {
    const { run } = await seedWithEvidenceAndPolicy();
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_run_evidence_bundles SET bundle_hash = 'deadbeef' WHERE run_id = ?`)
      .run(run.id);
    runReplayVerification(run.id, { persist: true, audit: false });
    const result = evaluateRunPolicy(run.id);
    expect(result.status).toBe("blocked");
    expect(result.blockers.some((b) => b.includes("Replay verification failed"))).toBe(true);
  });

  it("approval fails closed when policy is blocked", async () => {
    const { run } = seedRunWithApproval();
    saveQualityGateResults(run.id, [
      {
        id: "g1",
        runId: run.id,
        command: "npm test",
        stdout: "",
        stderr: "fail",
        exitCode: 1,
        durationMs: 10,
        status: "failed",
        createdAt: new Date().toISOString(),
      },
    ]);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    await refreshRunEvidenceBundle({ runId: run.id });
    await expect(
      handleApprovalAction(run.id, "approve", { rationale: "attempt approve" }),
    ).rejects.toThrow(/blocked by governance policy/i);
  });

  it("request_fix and stop still work when policy blocked", async () => {
    const { run } = seedRunWithApproval();
    saveQualityGateResults(run.id, [
      {
        id: "g1",
        runId: run.id,
        command: "npm test",
        stdout: "",
        stderr: "fail",
        exitCode: 1,
        durationMs: 10,
        status: "failed",
        createdAt: new Date().toISOString(),
      },
    ]);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    await refreshRunEvidenceBundle({ runId: run.id });

    await expect(
      handleApprovalAction(run.id, "request_fix", { rationale: "fix gates" }),
    ).resolves.toBeTruthy();
    expect(getRunById(run.id)?.status).toBe("failed");

    const seeded2 = seedRunWithApproval();
    saveQualityGateResults(seeded2.run.id, [
      {
        id: "g2",
        runId: seeded2.run.id,
        command: "npm test",
        stdout: "",
        stderr: "fail",
        exitCode: 1,
        durationMs: 10,
        status: "failed",
        createdAt: new Date().toISOString(),
      },
    ]);
    runPolicyEvaluation(seeded2.run.id, { persist: true, audit: false });
    await refreshRunEvidenceBundle({ runId: seeded2.run.id });
    await expect(
      handleApprovalAction(seeded2.run.id, "stop", { rationale: "stop run" }),
    ).resolves.toBeTruthy();
  });

  it("emits audit events for policy evaluation", () => {
    const { run } = seedRunWithApproval();
    runPolicyEvaluation(run.id, { persist: true, audit: true });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.POLICY_EVALUATION_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.POLICY_EVALUATION_COMPLETED);
  });

  it("public policy result shape excludes raw logs and diffs", () => {
    const { run } = seedRunWithApproval({
      changedFiles: Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`),
    });
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const pub = toPublicPolicyResult(listPolicyResultsForRun(run.id)[0]!);
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toMatch(/stdout|stderr|diffSummary|"content":/i);
    expect(pub.warnings.length).toBeGreaterThan(0);
    expect(pub.signals.changedFileCount).toBe(25);
  });
});
