import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { buildRunEvidenceSummaryForBridge } from "../../bridge/run-evidence-summary";
import { resetEngineerConsoleDbForTests } from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { applyHermesPatchForRun } from "../../hermes-worker/apply-hermes-patch";
import { prepareHermesRunForEngineeringRun } from "../../hermes-worker/hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "../../hermes-worker/hermes-evidence-types";
import { HERMES_PATCH_ARTIFACT_FILES } from "../../hermes-worker/read-hermes-patch-proposal";
import { resolveHermesEvidenceReportPath } from "../../hermes-worker/read-hermes-worker-evidence";
import { runHermesPostApplyQualityGates } from "../../hermes-worker/run-hermes-post-apply-quality-gates";
import { evaluateMergeReadiness } from "../../release/merge-controls/evaluate-merge-readiness";
import { evaluateDeploymentReadiness } from "../../release/deployment-gates/evaluate-deployment-readiness";
import { listDeploymentEnvironments } from "../../release/deployment-gates/deployment-environments";
import { createRun, getRunById } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import {
  createWorkerPlanRecord,
  updateWorkerPlanValidation,
} from "../../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../../worker-plan/worker-plan-validation";
import { createEngineeringReviewSignoff } from "./create-engineering-review-signoff";
import {
  EngineeringReviewSignoffError,
  validateEngineeringReviewSignoffInput,
} from "./validate-engineering-review-signoff";
import { hashEvidenceSnapshot, stableSnapshotStringify } from "./hash-evidence-snapshot";
import {
  getLatestEngineeringReviewSignoffForRun,
  listEngineeringReviewSignoffsForRun,
} from "./engineering-review-signoff-manager";
import { rollbackHermesPatchForRun } from "../../hermes-worker/apply-hermes-patch";

describe("Engineering review sign-off phase 11", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-p11-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p11-test",
        scripts: {
          test: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      }),
    );
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "."], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `review-p11-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "review-p11-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
  });

  function seedHermesWorkflowAppliedWithGates() {
    const task = createTask({
      title: "Signoff P11",
      description: "Review signoff",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add signoff doc",
      allowedFiles: ["docs/signoff-p11.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/signoff-p11.md",
          content: "# signoff\n",
          reason: "p11",
        },
      ],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    updateWorkerPlanValidation(record.id, validateWorkerPlan(plan, repoRoot, run.id));

    const { dispatch } = prepareHermesRunForEngineeringRun(run.id);
    const evidenceDir = path.dirname(dispatch.evidencePlaceholderPath);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedPatch),
      "--- a/docs/signoff-p11.md\n+++ b/docs/signoff-p11.md\n@@ -0,0 +1,2 @@\n+# signoff\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [
          {
            path: "docs/signoff-p11.md",
            changeType: "add",
            reason: "p11",
            allowedByPolicy: true,
          },
        ],
      }),
    );
    fs.writeFileSync(
      resolveHermesEvidenceReportPath(dispatch),
      JSON.stringify({
        schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
        mode: "patch-proposal",
        status: "patch_proposed",
        dispatchId: dispatch.id,
        runId: run.id,
        taskId: task.id,
        changesApplied: false,
        timestamp: new Date().toISOString(),
        governance: { evidenceOnly: true, notSignOff: true, sourceOfTruth: "engineering-console" },
      }),
    );

    applyHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "apply" },
    });

    return { run, dispatch };
  }

  it("requires decision, reviewer, and reason", () => {
    const { run } = seedHermesWorkflowAppliedWithGates();
    expect(() =>
      validateEngineeringReviewSignoffInput({
        runId: run.id,
        decision: "invalid",
        reviewer: "op",
        reason: "x",
      }),
    ).toThrow(EngineeringReviewSignoffError);
    expect(() =>
      validateEngineeringReviewSignoffInput({
        runId: run.id,
        decision: "approved",
        reviewer: "  ",
        reason: "x",
      }),
    ).toThrow(EngineeringReviewSignoffError);
    expect(() =>
      validateEngineeringReviewSignoffInput({
        runId: run.id,
        decision: "approved",
        reviewer: "op",
        reason: "  ",
      }),
    ).toThrow(EngineeringReviewSignoffError);
  });

  it("does not auto-sign-off when quality gates pass", async () => {
    const { run, dispatch } = seedHermesWorkflowAppliedWithGates();
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });
    expect(getLatestEngineeringReviewSignoffForRun(run.id)).toBeNull();
    void dispatch;
  });

  it("allows needs_changes when quality gates failed", async () => {
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p11-fail",
        scripts: { test: 'node -e "process.exit(1)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    const { run } = seedHermesWorkflowAppliedWithGates();
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });
    const result = await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "needs_changes",
      reviewer: "reviewer-1",
      reason: "Tests failed; rework required",
    });
    expect(result.decision).toBe("needs_changes");
    expect(result.notMerge).toBe(true);
  });

  it("rejects approved when patch rolled back", async () => {
    const { run, dispatch } = seedHermesWorkflowAppliedWithGates();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      createEngineeringReviewSignoff({
        runId: run.id,
        decision: "approved",
        reviewer: "op",
        reason: "should fail",
      }),
    ).rejects.toMatchObject({ code: "PATCH_ROLLED_BACK" });
  });

  it("stores evidence snapshot and writes audit events on approved sign-off", async () => {
    const { run } = seedHermesWorkflowAppliedWithGates();
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });
    const result = await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "approved",
      reviewer: "lead",
      reason: "Evidence reviewed; gates passed",
    });
    const record = getLatestEngineeringReviewSignoffForRun(run.id);
    expect(record?.evidenceSnapshotHash).toBe(result.evidenceSnapshotHash);
    expect(record?.evidenceSummaryJson.length).toBeGreaterThan(10);
    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_CREATED);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_APPROVED);
    expect(listEngineeringReviewSignoffsForRun(run.id).length).toBe(1);
  });

  it("approved sign-off does not merge, deploy, or complete run", async () => {
    const { run } = seedHermesWorkflowAppliedWithGates();
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "approved",
      reviewer: "lead",
      reason: "ok",
    });
    expect(getRunById(run.id)?.status).not.toBe("completed");
    const merge = await evaluateMergeReadiness(run.id, null, { inspectGithub: false });
    expect(merge.status).not.toBe("ready");
    const env = listDeploymentEnvironments()[0];
    if (env) {
      const deploy = evaluateDeploymentReadiness(run.id, env.id);
      expect(deploy.status).not.toBe("ready");
    }
  });

  it("evidence snapshot hash is stable for identical payloads", () => {
    const snapshot = { schemaVersion: "engineering-review-evidence-snapshot/v1", runId: "r1", z: 1, a: 2 };
    const a = hashEvidenceSnapshot(snapshot);
    const b = hashEvidenceSnapshot(JSON.parse(stableSnapshotStringify(snapshot)));
    expect(a).toBe(b);
  });

  it("bridge summary includes latest review sign-off", async () => {
    const { run } = seedHermesWorkflowAppliedWithGates();
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "blocked",
      reviewer: "lead",
      reason: "blocked for test",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestReviewSignoff.reviewDecision).toBe("blocked");
    expect(bridge?.latestReviewSignoff.notMerge).toBe(true);
    expect(bridge?.reviewDecision).toBe("blocked");
  });

  it("Hermes consumer does not create engineering review sign-off", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/ENGINEERING_REVIEW_SIGNOFF|review-signoff/);
  });

  it("VeraLux OS does not reference engineering review sign-off API", () => {
    const osRoot = path.resolve(process.cwd(), "../Veralux-System");
    if (!fs.existsSync(osRoot)) return;
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    for (const file of walk(osRoot)) {
      expect(fs.readFileSync(file, "utf8")).not.toContain("review-signoff");
    }
  });
});
