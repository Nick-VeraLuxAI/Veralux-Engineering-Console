import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { buildApprovalReport } from "../../approval/approval-report";
import { handleApprovalAction } from "../../orchestrator/run-orchestrator";
import { saveApprovalReport, createRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../governance-engine";
import { refreshRunEvidenceBundle } from "../evidence-bundles/evidence-bundle-manager";
import * as createDecisionModule from "./create-decision-record";
import { createDecisionRecord } from "./create-decision-record";
import { summarizeQualityGateState } from "./build-decision-snapshot";
import {
  DecisionRecordError,
  type DecisionSnapshotV1,
} from "./decision-record-types";
import {
  listDecisionRecords,
  recordDecisionForApprovalAction,
  toPublicDecisionRecord,
} from "./decision-record-manager";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-decision-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "decision-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

function seedRunWithApproval() {
  const task = createTask({ title: "Decision task", targetRepoPath: "/tmp/repo" });
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

async function seedWithEvidence() {
  const seeded = seedRunWithApproval();
  await refreshRunEvidenceBundle({ runId: seeded.run.id });
  return seeded;
}

describe("decision records", () => {
  it("creates decision record for approve", async () => {
    const { run } = await seedWithEvidence();
    const record = recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      rationale: "Looks good",
    });
    expect(record.decision).toBe("approved");
    expect(record.evidenceBundleHash).toBeTruthy();
  });

  it("creates decision record for request_fix", async () => {
    const { run } = await seedWithEvidence();
    const record = recordDecisionForApprovalAction({
      runId: run.id,
      action: "request_fix",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      rationale: "Tests failing",
    });
    expect(record.decision).toBe("request_fix");
    expect(record.rationale).toBe("Tests failing");
  });

  it("creates decision record for stop", async () => {
    const { run } = await seedWithEvidence();
    const record = recordDecisionForApprovalAction({
      runId: run.id,
      action: "stop",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      rationale: "Wrong scope",
    });
    expect(record.decision).toBe("stopped");
  });

  it("approval fails if evidence bundle missing", async () => {
    const { run } = seedRunWithApproval();
    await expect(
      handleApprovalAction(run.id, "approve", { rationale: "ok" }),
    ).rejects.toThrow(/Evidence bundle missing/);
  });

  it("approval fails if decision record creation fails", async () => {
    const { run } = await seedWithEvidence();
    vi.spyOn(createDecisionModule, "createDecisionRecord").mockImplementation(() => {
      throw new DecisionRecordError("simulated failure");
    });
    await expect(handleApprovalAction(run.id, "approve", { rationale: "retry" })).rejects.toThrow(
      "simulated failure",
    );
  });

  it("model actor cannot approve", async () => {
    const { run } = await seedWithEvidence();
    expect(() =>
      createDecisionRecord({
        runId: run.id,
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
      }),
    ).toThrow(/Model actors cannot approve/);
  });

  it("decision snapshot includes evidence bundle hash", async () => {
    const { run } = await seedWithEvidence();
    const record = recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
    });
    const snapshot = JSON.parse(record.decisionSnapshotJson) as DecisionSnapshotV1;
    expect(snapshot.evidenceBundleHash).toBe(record.evidenceBundleHash);
  });

  it("decision snapshot includes governance risk", async () => {
    const { run, report } = await seedWithEvidence();
    const record = recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
    });
    const snapshot = JSON.parse(record.decisionSnapshotJson) as DecisionSnapshotV1;
    expect(snapshot.governanceRiskLevel).toBe(report.riskLevel);
    expect(record.riskLevel).toBe(report.riskLevel);
  });

  it("decision snapshot includes quality gate state", async () => {
    const { run } = await seedWithEvidence();
    const record = recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
    });
    expect(record.qualityGateState).toBe(summarizeQualityGateState([]));
  });

  it("decision record emits audit event", async () => {
    const { run } = await seedWithEvidence();
    recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
    });
    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.DECISION_RECORDED);
  });

  it("public API shape is redacted", async () => {
    const { run } = await seedWithEvidence();
    recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      rationale: "ok",
    });
    const pub = listDecisionRecords(run.id).map(toPublicDecisionRecord);
    expect(pub.length).toBe(1);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("stdout");
    expect(json).not.toContain("rawResponse");
    expect(pub[0].snapshot?.evidenceBundleHash).toBeTruthy();
  });

  it("persists rationale", async () => {
    const { run } = await seedWithEvidence();
    await handleApprovalAction(run.id, "request_fix", {
      rationale: "Need more tests",
    });
    const records = listDecisionRecords(run.id);
    expect(records.some((r) => r.rationale === "Need more tests")).toBe(true);
  });

  it("handleApprovalAction creates decision record on approve", async () => {
    const { run } = await seedWithEvidence();
    const result = await handleApprovalAction(run.id, "approve", { rationale: "Ship it" });
    expect(result?.decisionRecordId).toBeTruthy();
    expect(listDecisionRecords(run.id).length).toBeGreaterThanOrEqual(1);
  });
});
