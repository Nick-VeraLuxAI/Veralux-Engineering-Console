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
import { applyHermesPatchForRun, rollbackHermesPatchForRun } from "../../hermes-worker/apply-hermes-patch";
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
import { createEngineeringReviewSignoff } from "../engineering-review-signoff/create-engineering-review-signoff";
import { validateCommitCandidateMessage } from "./validate-commit-message";
import {
  CommitCandidateError,
  validateCommitCandidateForRun,
} from "./validate-commit-candidate-for-run";
import { prepareCommitCandidateForRun } from "./prepare-commit-candidate";
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA } from "./commit-candidate-types";

const PREPARE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/engineer-console/governance/commit-candidate/prepare-commit-candidate.ts"),
  "utf8",
);

describe("Governed commit/PR candidate phase 12", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "commit-p12-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p12-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `commit-p12-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "commit-p12-evidence-"));

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

  async function seedApprovedWorkflow() {
    const task = createTask({
      title: "Commit Candidate P12",
      description: "Phase 12",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p12 doc",
      allowedFiles: ["docs/p12.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p12.md",
          content: "# p12\n",
          reason: "phase12",
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
      "--- a/docs/p12.md\n+++ b/docs/p12.md\n@@ -0,0 +1,2 @@\n+# p12\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p12.md", changeType: "add", reason: "phase12", allowedByPolicy: true }],
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

    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });

    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "approved",
      reviewer: "lead",
      reason: "Ready for commit candidate",
    });

    return { run, dispatch, task };
  }

  const approval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Prepare governed commit candidate",
  };

  it("does not invoke git commit or push in prepare module", () => {
    expect(PREPARE_SOURCE).not.toContain("createControlledGitCommit");
    expect(PREPARE_SOURCE).not.toContain("runGit");
    expect(PREPARE_SOURCE).not.toContain("execFile");
    expect(PREPARE_SOURCE).not.toContain('["commit"');
    expect(PREPARE_SOURCE).not.toContain('["push"');
  });

  it("cannot prepare without approved sign-off", async () => {
    const { run, dispatch } = await seedApprovedWorkflow();
    const { getLatestEngineeringReviewSignoffForRun } = await import(
      "../engineering-review-signoff/engineering-review-signoff-manager"
    );
    void getLatestEngineeringReviewSignoffForRun;

    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "needs_changes",
      reviewer: "lead",
      reason: "not ready",
    });

    await expect(
      prepareCommitCandidateForRun({
        runId: run.id,
        commitMessage: "feat: p12",
        operatorApproval: approval,
      }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
    void dispatch;
  });

  it("cannot prepare after rollback", async () => {
    const { run, dispatch } = await seedApprovedWorkflow();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      prepareCommitCandidateForRun({
        runId: run.id,
        commitMessage: "feat: p12",
        operatorApproval: approval,
      }),
    ).rejects.toMatchObject({ code: "PATCH_ROLLED_BACK" });
  });

  it("requires operator reason and safe commit message", async () => {
    const { run } = await seedApprovedWorkflow();
    await expect(
      validateCommitCandidateForRun({
        runId: run.id,
        commitMessage: "feat: ok",
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).rejects.toThrow(CommitCandidateError);

    expect(() => validateCommitCandidateMessage("")).toThrow();
    expect(() => validateCommitCandidateMessage("-bad")).toThrow();
  });

  it("prepares artifacts with evidence linkage and audit events", async () => {
    const { run } = await seedApprovedWorkflow();
    const result = await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p12 documentation",
      operatorApproval: approval,
    });

    expect(result.status).toBe("commit_candidate_prepared");
    expect(result.notCommitted).toBe(true);
    expect(fs.existsSync(result.commitPacketPath)).toBe(true);
    expect(fs.existsSync(result.prDraftPath)).toBe(true);

    const packet = JSON.parse(fs.readFileSync(result.commitPacketPath, "utf8")) as {
      schema: string;
      evidenceSnapshotHash: string;
      notCommitted: boolean;
    };
    expect(packet.schema).toBe(ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA);
    expect(packet.evidenceSnapshotHash).toBe(result.evidenceSnapshotHash);
    expect(packet.notCommitted).toBe(true);

    const prDraft = fs.readFileSync(result.prDraftPath, "utf8");
    expect(prDraft).toContain("Not committed");
    expect(prDraft).toContain("not pushed");
    expect(prDraft).toContain("not merged");
    expect(prDraft).toContain("not deployed");

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_COMMIT_CANDIDATE_PREPARED);

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.evidenceSnapshotHash).toBe(result.evidenceSnapshotHash);
  });

  it("does not merge, deploy, or complete run after candidate preparation", async () => {
    const { run } = await seedApprovedWorkflow();
    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: p12",
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
  });

  it("failed quality gates can produce needs_changes sign-off", async () => {
    const task = createTask({
      title: "Needs changes P12",
      description: "Phase 12",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p12 nc",
      allowedFiles: ["docs/p12-nc.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p12-nc.md",
          content: "# nc\n",
          reason: "phase12",
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
      "--- a/docs/p12-nc.md\n+++ b/docs/p12-nc.md\n@@ -0,0 +1 @@\n+# nc\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p12-nc.md", changeType: "add", reason: "p12", allowedByPolicy: true }],
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
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p12-fail",
        scripts: { test: 'node -e "process.exit(1)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });
    const signoff = await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "needs_changes",
      reviewer: "lead",
      reason: "Tests failed after patch apply",
    });
    expect(signoff.decision).toBe("needs_changes");
  });

  it("bridge summary includes latest commit candidate", async () => {
    const { run } = await seedApprovedWorkflow();
    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: p12",
      operatorApproval: approval,
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestCommitCandidate.commitCandidateStatus).toBe("commit_candidate_prepared");
    expect(bridge?.latestCommitCandidate.notCommitted).toBe(true);
  });

  it("Hermes consumer does not prepare commit candidates", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/commit-candidate|commit_candidate/);
  });
});
