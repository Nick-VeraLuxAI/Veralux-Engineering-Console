import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { evaluateMergeReadiness } from "../release/merge-controls/evaluate-merge-readiness";
import { evaluateDeploymentReadiness } from "../release/deployment-gates/evaluate-deployment-readiness";
import { listDeploymentEnvironments } from "../release/deployment-gates/deployment-environments";
import { createRun, getRunById } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  createWorkerPlanRecord,
  updateWorkerPlanValidation,
} from "../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../worker-plan/worker-plan-validation";
import {
  applyHermesPatchForRun,
  HermesPatchApplyError,
  rollbackHermesPatchForRun,
} from "./apply-hermes-patch";
import { prepareHermesRunForEngineeringRun } from "./hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "./hermes-evidence-types";
import { ingestHermesWorkerEvidenceForRun } from "./hermes-evidence-ingest";
import { resolveHermesEvidenceReportPath } from "./read-hermes-worker-evidence";
import { HERMES_PATCH_ARTIFACT_FILES } from "./read-hermes-patch-proposal";
import { validateHermesPatchForApply } from "./validate-hermes-patch-for-apply";
import { buildRunEvidenceSummaryForBridge } from "../bridge/run-evidence-summary";

describe("Hermes controlled patch application phase 9", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p9-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `hermes-p9-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p9-evidence-"));

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

  function seedPatchProposal() {
    const task = createTask({
      title: "Apply P9",
      description: "Apply patch test",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add apply doc",
      allowedFiles: ["docs/apply-p9.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/apply-p9.md",
          content: "# apply p9\n",
          reason: "phase9",
        },
      ],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    updateWorkerPlanValidation(record.id, validateWorkerPlan(plan, repoRoot, run.id));

    const { dispatch, packet } = prepareHermesRunForEngineeringRun(run.id);
    const evidenceDir = path.dirname(dispatch.evidencePlaceholderPath);
    const diff = [
      "--- a/docs/apply-p9.md",
      "+++ b/docs/apply-p9.md",
      "@@ -0,0 +1,2 @@",
      "+# apply p9",
      "+",
    ].join("\n");
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedPatch), `${diff}\n`);
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [
          {
            path: "docs/apply-p9.md",
            changeType: "add",
            reason: "phase9",
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
        filesProposedForChange: ["docs/apply-p9.md"],
        boundaryValidation: { valid: true, checks: [] },
        governance: {
          evidenceOnly: true,
          notSignOff: true,
          sourceOfTruth: "engineering-console",
        },
      }),
    );

    return { task, run, dispatch, packet, plan };
  }

  const approval = {
    approved: true as const,
    approvedBy: "test-operator",
    reason: "Reviewed proposal; safe to apply",
  };

  it("rejects apply without operator approval", () => {
    const { run, dispatch } = seedPatchProposal();
    expect(() =>
      validateHermesPatchForApply({
        runId: run.id,
        dispatchId: dispatch.id,
        operatorApproval: { approved: false, approvedBy: "x", reason: "no" },
      }),
    ).toThrow(HermesPatchApplyError);
  });

  it("rejects apply without approval reason", () => {
    const { run, dispatch } = seedPatchProposal();
    expect(() =>
      validateHermesPatchForApply({
        runId: run.id,
        dispatchId: dispatch.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).toThrow(HermesPatchApplyError);
  });

  it("applies patch, creates rollback artifact, and records audit", () => {
    const { run, dispatch } = seedPatchProposal();
    const target = path.join(repoRoot, "docs/apply-p9.md");
    expect(fs.existsSync(target)).toBe(false);

    const result = applyHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: approval,
    });

    expect(result.status).toBe("patch_applied");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toContain("# apply p9");
    expect(fs.existsSync(result.rollbackArtifactPath)).toBe(true);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_PATCH_APPLY_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_PATCH_VALIDATION_PASSED);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_PATCH_APPLIED);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_PATCH_ROLLBACK_ARTIFACT_CREATED);
  });

  it("cannot apply twice", () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    expect(() =>
      applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval }),
    ).toThrow(HermesPatchApplyError);
  });

  it("cannot apply to wrong run", () => {
    const { run, dispatch } = seedPatchProposal();
    const other = createRun(run.taskId);
    expect(() =>
      applyHermesPatchForRun({
        runId: other.id,
        dispatchId: dispatch.id,
        operatorApproval: approval,
      }),
    ).toThrow(HermesPatchApplyError);
  });

  it("does not mark run complete or merge/deploy ready", async () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    const fresh = getRunById(run.id);
    expect(fresh?.status).not.toBe("completed");
    const merge = await evaluateMergeReadiness(run.id, null, { inspectGithub: false });
    expect(merge.status).not.toBe("ready");
    const env = listDeploymentEnvironments()[0];
    if (env) {
      const deploy = evaluateDeploymentReadiness(run.id, env.id);
      expect(deploy.status).not.toBe("ready");
    }
  });

  it("ingest and bridge summary reflect patch application without sign-off", async () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(ingested.summary.patchApplication.status).toBe("patch_applied");
    expect(ingested.summary.patchApplication.notSignOff).toBe(true);
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.hermesPatchApplication.status).toBe("patch_applied");
    expect(bridge?.hermesPatchApplication.notSignOff).toBe(true);
    const signOffEvents = listAuditEventsForRun(run.id).filter((e) =>
      /SIGN.?OFF/i.test(e.eventType),
    );
    expect(signOffEvents).toHaveLength(0);
  });

  it("rollback restores repository files", () => {
    const { run, dispatch } = seedPatchProposal();
    const target = path.join(repoRoot, "docs/apply-p9.md");
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    expect(fs.existsSync(target)).toBe(true);

    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: {
        approved: true,
        approvedBy: "test-operator",
        reason: "rollback test",
      },
    });
    expect(fs.existsSync(target)).toBe(false);
    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_PATCH_ROLLBACK_APPLIED);
  });

  it("rejects forbidden path in diff", () => {
    const { run, dispatch } = seedPatchProposal();
    const evidenceDir = path.dirname(dispatch.evidencePlaceholderPath);
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedPatch),
      "--- a/.env\n+++ b/.env\n@@ -0,0 +1 @@\n+SECRET=1\n",
    );
    expect(() =>
      validateHermesPatchForApply({
        runId: run.id,
        dispatchId: dispatch.id,
        operatorApproval: approval,
      }),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN_PATH" }));
  });

  it("rejects paths outside worker plan allowed scope", () => {
    const { run, dispatch } = seedPatchProposal();
    const evidenceDir = path.dirname(dispatch.evidencePlaceholderPath);
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedPatch),
      "--- a/docs/out-of-scope.md\n+++ b/docs/out-of-scope.md\n@@ -0,0 +1 @@\n+x\n",
    );
    expect(() =>
      validateHermesPatchForApply({
        runId: run.id,
        dispatchId: dispatch.id,
        operatorApproval: approval,
      }),
    ).toThrow(expect.objectContaining({ code: "PATH_OUT_OF_SCOPE" }));
  });

  it("rejects when patch proposal evidence is missing", () => {
    const { run, dispatch } = seedPatchProposal();
    fs.rmSync(resolveHermesEvidenceReportPath(dispatch), { force: true });
    expect(() =>
      validateHermesPatchForApply({
        runId: run.id,
        dispatchId: dispatch.id,
        operatorApproval: approval,
      }),
    ).toThrow(expect.objectContaining({ code: "EVIDENCE_MISSING" }));
  });

  it("Hermes consumer script does not apply patches (proposal only)", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/apply-patch|applyPatch|git apply/);
    expect(source).toMatch(/propose-patch|proposePatch|patch.proposal/i);
  });
});
