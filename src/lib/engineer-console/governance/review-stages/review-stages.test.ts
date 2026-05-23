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
import {
  createRun,
  getRunById,
  saveApprovalReport,
  saveQualityGateResults,
  updateRun,
} from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../governance-engine";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { refreshRunEvidenceBundle } from "../evidence-bundles/evidence-bundle-manager";
import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import { runPolicyEvaluation } from "../policy-results/policy-result-manager";
import { runReplayVerification } from "../replay-verification/replay-verification-manager";
import { determineRequiredReviewStages } from "./determine-required-review-stages";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "./review-stage-manager";
import { ReviewStageError } from "./review-stage-types";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-review-stages-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "review-stages-test";
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

function seedRun(overrides?: {
  changedFiles?: string[];
  governance?: ReturnType<typeof assessChangedFiles>;
}) {
  const changedFiles = overrides?.changedFiles ?? ["src/a.ts"];
  const governance = overrides?.governance ?? assessChangedFiles(changedFiles);
  const task = createTask({ title: "Review stage task", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  updateRun(run.id, {
    status: "waiting_for_approval",
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
    diffSummary: `${changedFiles.length} files changed`,
    governance,
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  return { task, run, changedFiles, governance };
}

async function seedWithPolicyAndStages(changedFiles: string[]) {
  const seeded = seedRun({ changedFiles, governance: assessChangedFiles(changedFiles) });
  runPolicyEvaluation(seeded.run.id, { persist: true, audit: false });
  reconcileReviewStagesForRun(seeded.run.id, { audit: false });
  await refreshRunEvidenceBundle({ runId: seeded.run.id, changedFiles });
  return seeded;
}

describe("review stages", () => {
  it("determines architecture_review from migrations and policy requires_review", async () => {
    const { run } = await seedWithPolicyAndStages(["db/migrate/001_init.sql"]);
    const specs = determineRequiredReviewStages(run.id);
    expect(specs.some((s) => s.stage === "architecture_review")).toBe(true);
  });

  it("determines risky_diff_review from package-lock and high-risk signals", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const specs = determineRequiredReviewStages(run.id);
    expect(specs.some((s) => s.stage === "risky_diff_review")).toBe(true);
  });

  it("determines release_readiness_review from skipped gates and replay warnings", async () => {
    const { run } = seedRun();
    saveQualityGateResults(run.id, [
      {
        id: "g1",
        runId: run.id,
        command: "npm test",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        status: "skipped",
        createdAt: new Date().toISOString(),
      },
    ]);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    await refreshRunEvidenceBundle({ runId: run.id });
    await runReplayVerification(run.id, { persist: true, audit: false });

    const specs = determineRequiredReviewStages(run.id);
    expect(specs.some((s) => s.stage === "release_readiness_review")).toBe(true);
  });

  it("creates required stages without duplicates", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const first = reconcileReviewStagesForRun(run.id, { audit: false });
    const second = reconcileReviewStagesForRun(run.id, { audit: false });
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    const stages = listReviewStagesForRun(run.id);
    const stageTypes = stages.map((s) => s.stage);
    expect(new Set(stageTypes).size).toBe(stageTypes.length);
  });

  it("stage approve records actor, rationale, and audit event", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const stage = listReviewStagesForRun(run.id)[0]!;
    completeReviewStageAction({
      stageId: stage.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "senior-reviewer",
      rationale: "Looks good",
    });
    const updated = listReviewStagesForRun(run.id).find((s) => s.id === stage.id)!;
    expect(updated.status).toBe("approved");
    expect(updated.reviewerActorLabel).toBe("senior-reviewer");
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.REVIEW_STAGE_APPROVED);
  });

  it("stage reject blocks final approval", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const stage = listReviewStagesForRun(run.id).find((s) => s.required)!;
    completeReviewStageAction({
      stageId: stage.id,
      action: "reject",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "reviewer",
      rationale: "Not acceptable",
    });
    await expect(
      handleApprovalAction(run.id, "approve", { rationale: "attempt approve" }),
    ).rejects.toThrow(/blocked/i);
  });

  it("pending required stage blocks final approval", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    await expect(
      handleApprovalAction(run.id, "approve", { rationale: "attempt approve" }),
    ).rejects.toThrow(/blocked/i);
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.REVIEW_STAGE_BLOCKED_APPROVAL);
  });

  it("skipped optional stage allowed with rationale", async () => {
    const { run } = seedRun();
    const now = new Date().toISOString();
    getEngineerConsoleDb()
      .prepare(
        `INSERT INTO engineer_review_stages
          (id, run_id, task_id, stage, status, required, reason, created_at, updated_at)
         VALUES (?, ?, ?, 'implementation_review', 'pending', 0, 'optional check', ?, ?)`,
      )
      .run("optional-stage", run.id, run.taskId, now, now);

    completeReviewStageAction({
      stageId: "optional-stage",
      action: "skip",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      rationale: "Not needed for this run",
    });
    const updated = listReviewStagesForRun(run.id)[0]!;
    expect(updated.status).toBe("skipped");
  });

  it("model actor cannot approve stage", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const stage = listReviewStagesForRun(run.id)[0]!;
    expect(() =>
      completeReviewStageAction({
        stageId: stage.id,
        action: "approve",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "gpt-model",
      }),
    ).toThrow(ReviewStageError);
  });

  it("request_fix and stop still work with pending or rejected stages", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    await expect(
      handleApprovalAction(run.id, "request_fix", { rationale: "needs fix" }),
    ).resolves.toBeTruthy();
    expect(getRunById(run.id)?.status).toBe("failed");

    const seeded2 = await seedWithPolicyAndStages(["package-lock.json"]);
    const stage = listReviewStagesForRun(seeded2.run.id)[0]!;
    completeReviewStageAction({
      stageId: stage.id,
      action: "reject",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "reviewer",
      rationale: "reject",
    });
    await expect(
      handleApprovalAction(seeded2.run.id, "stop", { rationale: "stop run" }),
    ).resolves.toBeTruthy();
  });

  it("lists review stages for run via manager", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const stages = listReviewStagesForRun(run.id);
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.every((s) => s.runId === run.id)).toBe(true);
  });

  it("evidence bundle includes review stage summary", async () => {
    const { run } = await seedWithPolicyAndStages(["package-lock.json"]);
    const bundle = getEvidenceBundleForRun(run.id);
    expect(bundle).not.toBeNull();
    const parsed = JSON.parse(bundle!.bundleJson) as {
      reviewStages?: { requiredCount: number; pendingCount: number };
    };
    expect(parsed.reviewStages?.requiredCount).toBeGreaterThan(0);
    expect(parsed.reviewStages?.pendingCount).toBeGreaterThan(0);
  });

  it("approval succeeds after required stages approved", async () => {
    const { run } = await seedWithPolicyAndStages(["src/safe.ts"]);
    const stages = listReviewStagesForRun(run.id);
    for (const stage of stages.filter((s) => s.required)) {
      completeReviewStageAction({
        stageId: stage.id,
        action: "approve",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "reviewer",
      });
    }
  await runReplayVerification(run.id, { persist: true, audit: false });
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    await refreshRunEvidenceBundle({ runId: run.id });

    if (listReviewStagesForRun(run.id).some((s) => s.required && s.status === "pending")) {
      reconcileReviewStagesForRun(run.id, { audit: false });
      for (const stage of listReviewStagesForRun(run.id).filter((s) => s.required && s.status === "pending")) {
        completeReviewStageAction({
          stageId: stage.id,
          action: "approve",
          actorType: AUDIT_ACTOR_TYPES.HUMAN,
          actorLabel: "reviewer",
        });
      }
    }

    await expect(
      handleApprovalAction(run.id, "approve", { rationale: "all gates passed" }),
    ).resolves.toMatchObject({ status: "approve" });
  });
});
