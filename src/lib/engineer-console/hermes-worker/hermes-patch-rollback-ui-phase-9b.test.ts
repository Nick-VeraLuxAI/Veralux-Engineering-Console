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
import { applyHermesPatchForRun, rollbackHermesPatchForRun } from "./apply-hermes-patch";
import { prepareHermesRunForEngineeringRun } from "./hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "./hermes-evidence-types";
import { ingestHermesWorkerEvidenceForRun } from "./hermes-evidence-ingest";
import {
  canShowHermesPatchApplyControls,
  canShowHermesPatchRollbackControls,
} from "./hermes-patch-rollback-ui-eligibility";
import {
  hermesWorkerApplyPatchPath,
  hermesWorkerRollbackPatchPath,
} from "./hermes-worker-api-paths";
import { HERMES_PATCH_ARTIFACT_FILES } from "./read-hermes-patch-proposal";
import { resolveHermesEvidenceReportPath } from "./read-hermes-worker-evidence";

const PANEL_SOURCE_PATH = path.join(
  process.cwd(),
  "src/components/engineer-console/hermes-worker-panel.tsx",
);

describe("Hermes patch rollback UI phase 9B", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p9b-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `hermes-p9b-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p9b-evidence-"));

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
      title: "Rollback UI P9B",
      description: "Rollback UI test",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add rollback doc",
      allowedFiles: ["docs/rollback-p9b.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/rollback-p9b.md",
          content: "# rollback p9b\n",
          reason: "phase9b",
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
      "--- a/docs/rollback-p9b.md\n+++ b/docs/rollback-p9b.md\n@@ -0,0 +1,2 @@\n+# rollback p9b\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [
          {
            path: "docs/rollback-p9b.md",
            changeType: "add",
            reason: "phase9b",
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
        filesProposedForChange: ["docs/rollback-p9b.md"],
        boundaryValidation: { valid: true, checks: [] },
        governance: {
          evidenceOnly: true,
          notSignOff: true,
          sourceOfTruth: "engineering-console",
        },
      }),
    );

    return { run, dispatch };
  }

  const approval = {
    approved: true as const,
    approvedBy: "test-operator",
    reason: "Reviewed and approved for test",
  };

  it("hides rollback controls before patch application", () => {
    const { run } = seedPatchProposal();
    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(canShowHermesPatchRollbackControls(ingested.summary.patchApplication)).toBe(false);
    expect(
      canShowHermesPatchApplyControls(ingested.summary.patchApplication, {
        patchProposalAvailable: ingested.summary.patchProposal.available,
        changesApplied: ingested.summary.changesApplied,
        hasDispatchId: true,
      }),
    ).toBe(true);
  });

  it("shows rollback controls only after patch application with rollback artifact", () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(ingested.summary.patchApplication.status).toBe("patch_applied");
    expect(canShowHermesPatchRollbackControls(ingested.summary.patchApplication)).toBe(true);
    expect(
      canShowHermesPatchApplyControls(ingested.summary.patchApplication, {
        patchProposalAvailable: true,
        changesApplied: true,
        hasDispatchId: true,
      }),
    ).toBe(false);
  });

  it("hides rollback controls after patch is rolled back", () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "undo test apply" },
    });
    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(ingested.summary.patchApplication.status).toBe("rolled_back");
    expect(ingested.summary.patchApplication.rolledBackBy).toBe("op");
    expect(ingested.summary.patchApplication.rolledBackReason).toBe("undo test apply");
    expect(canShowHermesPatchRollbackControls(ingested.summary.patchApplication)).toBe(false);
  });

  it("rollback requires a reason", () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    expect(() =>
      rollbackHermesPatchForRun({
        runId: run.id,
        dispatchId: dispatch.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).toThrow();
  });

  it("rollback does not complete run or make merge/deploy ready", async () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback governance test" },
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

  it("rollback does not create sign-off audit events", () => {
    const { run, dispatch } = seedPatchProposal();
    applyHermesPatchForRun({ runId: run.id, dispatchId: dispatch.id, operatorApproval: approval });
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.HERMES_PATCH_ROLLBACK_APPLIED);
    expect(types.some((t) => /SIGN.?OFF/i.test(t))).toBe(false);
  });

  it("panel uses dedicated rollback endpoint only for rollback handler", () => {
    const source = fs.readFileSync(PANEL_SOURCE_PATH, "utf8");
    const rollbackHandler = source.slice(
      source.indexOf("async function handleRollbackPatch"),
      source.indexOf("return (", source.indexOf("async function handleRollbackPatch")),
    );
    expect(rollbackHandler).toContain("hermesWorkerRollbackPatchPath(runId)");
    expect(rollbackHandler).not.toContain("apply-patch");
    expect(source).toContain("Rollback applied patch");
    expect(source).toContain("hermes-rollback-reason");
    expect(source).toMatch(/disabled=\{busy !== null \|\| !rollbackReason\.trim\(\)\}/);
  });

  it("rollback and apply API paths are distinct", () => {
    expect(hermesWorkerRollbackPatchPath("r1")).not.toBe(hermesWorkerApplyPatchPath("r1"));
    expect(hermesWorkerRollbackPatchPath("r1")).toContain("rollback-patch");
  });

  it("VeraLux OS does not reference Hermes worker rollback UI", () => {
    const osRoot = path.resolve(process.cwd(), "../Veralux-System");
    if (!fs.existsSync(osRoot)) return;
    const walk = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        if (entry.isDirectory()) files.push(...walk(full));
        else if (/\.(ts|tsx|js|jsx|md)$/.test(entry.name)) files.push(full);
      }
      return files;
    };
    const forbidden = ["rollback-patch", "HermesWorkerPanel"];
    for (const file of walk(osRoot)) {
      const text = fs.readFileSync(file, "utf8");
      for (const needle of forbidden) {
        expect(text.includes(needle)).toBe(false);
      }
    }
  });
});
