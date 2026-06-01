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
import {
  HERMES_BOUNDED_COMMAND_USES_SHELL,
  runBoundedCommand,
} from "./hermes-bounded-command-runner";
import { canShowHermesPostApplyQualityGates } from "./hermes-patch-quality-gates-ui-eligibility";
import { prepareHermesRunForEngineeringRun } from "./hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "./hermes-evidence-types";
import { ingestHermesWorkerEvidenceForRun } from "./hermes-evidence-ingest";
import {
  HermesQualityGateRunError,
  runHermesPostApplyQualityGates,
} from "./run-hermes-post-apply-quality-gates";
import { resolveHermesEvidenceReportPath } from "./read-hermes-worker-evidence";
import { HERMES_PATCH_ARTIFACT_FILES } from "./read-hermes-patch-proposal";
import {
  validateHermesQualityGatesForRun,
} from "./validate-hermes-quality-gates-for-run";
import { buildRunEvidenceSummaryForBridge } from "../bridge/run-evidence-summary";
import { getHermesPatchApplicationForRun } from "./hermes-patch-application-manager";

describe("Hermes post-apply quality gates phase 10", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p10-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p10-test",
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

    tmpDb = path.join(os.tmpdir(), `hermes-p10-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p10-evidence-"));

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

  function seedPatchApplied() {
    const task = createTask({
      title: "Gates P10",
      description: "Quality gates test",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add gates doc",
      allowedFiles: ["docs/gates-p10.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/gates-p10.md",
          content: "# gates p10\n",
          reason: "phase10",
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
      "--- a/docs/gates-p10.md\n+++ b/docs/gates-p10.md\n@@ -0,0 +1,2 @@\n+# gates p10\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [
          {
            path: "docs/gates-p10.md",
            changeType: "add",
            reason: "phase10",
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
        boundaryValidation: { valid: true, checks: [] },
        governance: {
          evidenceOnly: true,
          notSignOff: true,
          sourceOfTruth: "engineering-console",
        },
      }),
    );

    applyHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: {
        approved: true,
        approvedBy: "test-operator",
        reason: "apply for gates",
      },
    });

    return { run, dispatch };
  }

  const approval = {
    approved: true as const,
    approvedBy: "test-operator",
    reason: "Post-apply validation",
  };

  it("cannot run gates before patch application", () => {
    const task = createTask({
      title: "No apply",
      description: "x",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "plan",
      allowedFiles: ["a.md"],
      operations: [{ type: "create_file", path: "a.md", content: "x", reason: "r" }],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    updateWorkerPlanValidation(record.id, validateWorkerPlan(plan, repoRoot, run.id));
    prepareHermesRunForEngineeringRun(run.id);

    expect(() =>
      validateHermesQualityGatesForRun({
        runId: run.id,
        gateIds: ["test"],
        operatorApproval: approval,
      }),
    ).toThrow(expect.objectContaining({ code: "PATCH_NOT_APPLIED" }));
  });

  it("cannot run gates after rollback", async () => {
    const { run, dispatch } = seedPatchApplied();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback before gates" },
    });
    await expect(
      runHermesPostApplyQualityGates({
        runId: run.id,
        gateIds: ["test"],
        operatorApproval: approval,
      }),
    ).rejects.toMatchObject({ code: "PATCH_ROLLED_BACK" });
  });

  it("requires operator approval reason", () => {
    const { run } = seedPatchApplied();
    expect(() =>
      validateHermesQualityGatesForRun({
        runId: run.id,
        gateIds: ["test"],
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).toThrow(HermesQualityGateRunError);
  });

  it("rejects unknown gate ids", () => {
    const { run } = seedPatchApplied();
    expect(() =>
      validateHermesQualityGatesForRun({
        runId: run.id,
        gateIds: ["deploy"],
        operatorApproval: approval,
      }),
    ).toThrow(expect.objectContaining({ code: "GATE_NOT_ALLOWED" }));
  });

  it("runs allowlisted gates, captures evidence, and audits", async () => {
    const { run } = seedPatchApplied();
    const result = await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test", "build"],
      operatorApproval: approval,
    });

    expect(result.status).toBe("quality_gates_completed");
    expect(result.notSignOff).toBe(true);
    expect(result.results.length).toBe(2);
    expect(result.results.every((r) => fs.existsSync(r.artifactPath))).toBe(true);
    expect(result.results.every((r) => fs.existsSync(r.stdoutArtifactPath))).toBe(true);

    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(ingested.summary.postApplyQualityGates.status).toBe("completed");
    expect(ingested.summary.postApplyQualityGates.passedCount).toBeGreaterThan(0);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_QUALITY_GATES_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_QUALITY_GATES_COMPLETED);
  });

  it("records no-shell execution metadata and bounded cwd in artifacts", async () => {
    expect(HERMES_BOUNDED_COMMAND_USES_SHELL).toBe(false);
    const { run } = seedPatchApplied();
    const result = await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: approval,
    });
    const parsed = JSON.parse(
      fs.readFileSync(result.results[0]!.artifactPath, "utf8"),
    ) as { usesShell: boolean; executable: string; cwd: string };
    expect(parsed.usesShell).toBe(false);
    expect(parsed.executable).toBe("npm");
    expect(path.resolve(parsed.cwd)).toBe(path.resolve(repoRoot));
  });

  it("enforces timeout on long-running commands", async () => {
    const result = await runBoundedCommand({
      cwd: repoRoot,
      executable: "node",
      args: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
  });

  it("passing gates does not sign off, complete run, or make merge/deploy ready", async () => {
    const { run } = seedPatchApplied();
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: approval,
    });
    expect(getRunById(run.id)?.status).not.toBe("completed");
    const merge = await evaluateMergeReadiness(run.id, null, { inspectGithub: false });
    expect(merge.status).not.toBe("ready");
    const env = listDeploymentEnvironments()[0];
    if (env) {
      const deploy = evaluateDeploymentReadiness(run.id, env.id);
      expect(deploy.status).not.toBe("ready");
    }
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.hermesPostApplyQualityGates.notSignOff).toBe(true);
    const signOffEvents = listAuditEventsForRun(run.id).filter((e) =>
      /SIGN.?OFF/i.test(e.eventType),
    );
    expect(signOffEvents).toHaveLength(0);
  });

  it("failed gates do not auto-rollback patch", async () => {
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p10-fail",
        scripts: { test: 'node -e "process.exit(1)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    const { run } = seedPatchApplied();
    const result = await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: approval,
    });
    expect(result.overallStatus).toBe("failed");
    const application = getHermesPatchApplicationForRun(run.id);
    expect(application?.status).toBe("applied");
    expect(fs.existsSync(path.join(repoRoot, "docs/gates-p10.md"))).toBe(true);
  });

  it("UI eligibility hides gates before apply and shows after apply", () => {
    const { run } = seedPatchApplied();
    const before = ingestHermesWorkerEvidenceForRun(run.id);
    expect(canShowHermesPostApplyQualityGates(before.summary.patchApplication)).toBe(true);

    const notApplied = {
      status: "not_applied" as const,
      appliedAt: null,
      appliedBy: null,
      changedFiles: [],
      rollbackArtifactPath: null,
      rolledBackAt: null,
      rolledBackBy: null,
      rolledBackReason: null,
      notSignOff: true as const,
    };
    expect(canShowHermesPostApplyQualityGates(notApplied)).toBe(false);
  });
});
