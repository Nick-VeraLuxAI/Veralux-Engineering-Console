import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { buildRunEvidenceSummaryForBridge } from "../../bridge/run-evidence-summary";
import { getEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { applyHermesPatchForRun, rollbackHermesPatchForRun } from "../../hermes-worker/apply-hermes-patch";
import { prepareHermesRunForEngineeringRun } from "../../hermes-worker/hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "../../hermes-worker/hermes-evidence-types";
import { HERMES_PATCH_ARTIFACT_FILES } from "../../hermes-worker/read-hermes-patch-proposal";
import { resolveHermesEvidenceReportPath } from "../../hermes-worker/read-hermes-worker-evidence";
import { runHermesPostApplyQualityGates } from "../../hermes-worker/run-hermes-post-apply-quality-gates";
import {
  setControlledGitExecutorForTests,
  type ControlledGitExecutor,
} from "../../release/pr-creation/controlled-git-executor";
import {
  setControlledGhMergeExecutorForTests,
  type ControlledGhMergeExecutor,
} from "../../release/merge-controls/controlled-gh-merge";
import { getRunById } from "../../run-manager/run-manager";
import { createRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import {
  createWorkerPlanRecord,
  updateWorkerPlanValidation,
} from "../../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../../worker-plan/worker-plan-validation";
import { createEngineeringReviewSignoff } from "../engineering-review-signoff/create-engineering-review-signoff";
import { prepareCommitCandidateForRun } from "./prepare-commit-candidate";
import { createLocalCommitForRun } from "./create-local-commit";
import { pushRemoteBranchForRun } from "./push-remote-branch";
import { createGovernedPullRequestForRun } from "./create-governed-pull-request";
import { recordMergeReadinessForRun } from "./record-merge-readiness";
import { mergeGovernedPullRequestForRun } from "./merge-governed-pull-request";
import { recordDeployReadinessForRun } from "./record-deploy-readiness";
import { prepareDeploymentPacketForRun } from "./prepare-deployment-packet";
import { executeStagingDeploymentForRun } from "./execute-staging-deployment";
import { recordProductionReadinessForRun } from "./record-production-readiness";
import { prepareProductionDeploymentPacketForRun } from "./prepare-production-deployment-packet";
import { executeProductionDeploymentForRun } from "./execute-production-deployment";
import { recordCompletionReadinessForRun } from "./record-completion-readiness";
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA } from "./completion-readiness-types";
import {
  setControlledLocalScriptStagingDeploymentAdapterForTests,
  type ControlledLocalScriptStagingDeploymentAdapter,
} from "./local-script-staging-deployment-adapter";
import {
  setControlledLocalScriptProductionDeploymentAdapterForTests,
  type ControlledLocalScriptProductionDeploymentAdapter,
} from "./local-script-production-deployment-adapter";

const COMPLETION_READINESS_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/record-completion-readiness.ts",
  ),
  "utf8",
);
const PRODUCTION_VERIFICATION_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/governed-production-verification.ts",
  ),
  "utf8",
);

describe("Governed completion readiness phase 22", () => {
  let repoRoot: string;
  let bareRemote: string;
  let tmpDb: string;
  let tmpEvidence: string;
  let listedPrs: Array<{ number: number; url: string }> = [];
  let prMerged = false;
  let localCommitHash = "";

  const mockExecutor: ControlledGitExecutor = {
    git: vi.fn(async () => ({ stdout: "", stderr: "" })),
    gh: vi.fn(async (args: string[]) => {
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify(listedPrs), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.com/test-org/p22-test/pull/101\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      if (args[0] === "pr" && args[1] === "view") {
        const candidate = getLatestCommitCandidateForRun(
          (globalThis as { __p22RunId?: string }).__p22RunId ?? "",
        );
        const headOid = candidate?.localCommitHash ?? localCommitHash;
        return {
          stdout: JSON.stringify({
            state: prMerged ? "MERGED" : "OPEN",
            merged: prMerged,
            url: "https://github.com/test-org/p22-test/pull/101",
            headRefName: candidate?.remoteBranchName ?? "engineering/p22-test",
            baseRefName: "main",
            headRefOid: headOid,
            mergeCommit: prMerged
              ? { oid: "abcabcabcabcabcabcabcabcabcabcabcabc" }
              : null,
          }),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        prMerged = true;
        return { stdout: "Merged pull request #101\n", stderr: "" };
      }
      throw new Error("unexpected gh merge call");
    }),
  };

  const mockStagingAdapter: ControlledLocalScriptStagingDeploymentAdapter = {
    exec: vi.fn(async (repoPath: string, _mergeCommitSha: string) => ({
      exitCode: 0,
      stdout: "staging deploy ok\n",
      stderr: "",
      timedOut: false,
      scriptPath: path.join(repoPath, "scripts/deploy-staging.sh"),
    })),
  };

  const mockProductionAdapter: ControlledLocalScriptProductionDeploymentAdapter = {
    exec: vi.fn(async (repoPath: string, _mergeCommitSha: string) => ({
      exitCode: 0,
      stdout: "production deploy ok\n",
      stderr: "",
      timedOut: false,
      scriptPath: path.join(repoPath, "scripts/deploy-production.sh"),
    })),
  };

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    listedPrs = [];
    prMerged = false;
    localCommitHash = "";
    setControlledGitExecutorForTests(mockExecutor);
    setControlledGhMergeExecutorForTests(mockGhMergeExecutor);
    setControlledLocalScriptStagingDeploymentAdapterForTests(mockStagingAdapter);
    setControlledLocalScriptProductionDeploymentAdapterForTests(mockProductionAdapter);

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-comp-p22-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-comp-p22-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "scripts/deploy-staging.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(repoRoot, "scripts/deploy-production.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p22-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync(
      "git",
      ["add", "package.json", "scripts/deploy-staging.sh", "scripts/deploy-production.sh"],
      { cwd: repoRoot },
    );
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `governed-comp-p22-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-comp-p22-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    delete process.env.ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON;
    delete process.env.ENGINEER_CONSOLE_GOVERNED_PRODUCTION_HEALTH_PROFILE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    delete (globalThis as { __p22RunId?: string }).__p22RunId;
    setControlledGitExecutorForTests(null);
    setControlledGhMergeExecutorForTests(null);
    setControlledLocalScriptStagingDeploymentAdapterForTests(null);
    setControlledLocalScriptProductionDeploymentAdapterForTests(null);
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    delete process.env.ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON;
    delete process.env.ENGINEER_CONSOLE_GOVERNED_PRODUCTION_HEALTH_PROFILE;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function seedWithProductionDeployed() {
    const task = createTask({
      title: "Governed completion readiness P22",
      description: "Phase 22",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p22RunId?: string }).__p22RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p22 doc",
      allowedFiles: ["docs/p22.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p22.md",
          content: "# p22\n",
          reason: "phase22",
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
      "--- a/docs/p22.md\n+++ b/docs/p22.md\n@@ -0,0 +1,2 @@\n+# p22\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p22.md", changeType: "add", reason: "phase22", allowedByPolicy: true }],
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
      reason: "Ready for completion readiness",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p22 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    localCommitHash = getLatestCommitCandidateForRun(run.id)?.localCommitHash ?? "";

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p22-test.git"],
      { cwd: repoRoot },
    );
    execFileSync("git", ["remote", "add", "push-target", bareRemote], { cwd: repoRoot });
    execFileSync("git", ["push", "push-target", "HEAD:refs/heads/main"], { cwd: repoRoot });
    execFileSync("git", ["remote", "set-url", "origin", bareRemote], { cwd: repoRoot });

    await pushRemoteBranchForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "push branch" },
    });

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p22-test.git"],
      { cwd: repoRoot },
    );

    await createGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Create governed pull request",
      },
      mode: "create_pr",
      baseBranch: "main",
    });

    await recordMergeReadinessForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Merge readiness ready",
      },
      decision: "ready",
    });

    await mergeGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Merge governed PR",
      },
      mergeMethod: "squash",
    });

    await recordDeployReadinessForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Deploy readiness ready",
      },
      decision: "ready",
    });

    await prepareDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Prepare deployment packet",
      },
      targetEnvironment: "staging",
    });

    await executeStagingDeploymentForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Deploy to staging",
      },
      targetEnvironment: "staging",
      deploymentAdapter: "local-script",
    });

    await recordProductionReadinessForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Production readiness ready",
      },
      decision: "ready",
    });

    await prepareProductionDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Prepare production deployment packet",
      },
      rollbackNotes: "Revert to previous production release tag v1.2.3 if health checks fail.",
    });

    await executeProductionDeploymentForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Deploy to production",
      },
      targetEnvironment: "production",
      deploymentAdapter: "local-production-script",
    });

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const readinessApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Record completion readiness review",
  };

  it("does not complete run or deploy production", () => {
    expect(COMPLETION_READINESS_SOURCE).not.toContain("executeProductionDeployment");
    expect(COMPLETION_READINESS_SOURCE).not.toMatch(/\bcompleteRun\s*\(/);
    expect(COMPLETION_READINESS_SOURCE).not.toContain("scripts/deploy");
    expect(PRODUCTION_VERIFICATION_SOURCE).not.toContain("spawn(");
    expect(PRODUCTION_VERIFICATION_SOURCE).not.toContain("sudo");
  });

  it("cannot record completion readiness without production deployment", async () => {
    const { run } = await seedWithProductionDeployed();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          status = 'production_deployment_packet_prepared',
          production_deployment_status = NULL,
          production_deployment_exit_code = NULL,
          production_deployment_evidence_path = NULL
         WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: readinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_DEPLOYMENT_REQUIRED" });
  });

  it("cannot record completion readiness if production deployment failed", async () => {
    const { run } = await seedWithProductionDeployed();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          status = 'production_deployment_failed',
          production_deployment_status = 'production_deployment_failed',
          production_deployment_exit_code = 2
         WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: readinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_DEPLOYMENT_FAILED" });
  });

  it("cannot record completion readiness without production deployment evidence", async () => {
    const { run } = await seedWithProductionDeployed();
    const candidate = getLatestCommitCandidateForRun(run.id)!;
    if (candidate.productionDeploymentEvidencePath) {
      fs.rmSync(candidate.productionDeploymentEvidencePath);
    }
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET production_deployment_evidence_path = NULL WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: readinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_DEPLOYMENT_EVIDENCE_MISSING" });
  });

  it("requires production readiness ready", async () => {
    const { run } = await seedWithProductionDeployed();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET production_readiness_decision = 'blocked' WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: readinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_READINESS_NOT_READY" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithProductionDeployed();
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("rejects run completion attempts", async () => {
    const { run } = await seedWithProductionDeployed();
    await expect(
      recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: readinessApproval,
        decision: "ready",
        completeRun: true,
      }),
    ).rejects.toMatchObject({ code: "RUN_COMPLETION_FORBIDDEN" });
  });

  it.each(["ready", "not_ready", "blocked"] as const)(
    "records completion readiness decision %s with evidence",
    async (decision) => {
      const { run } = await seedWithProductionDeployed();
      const result = await recordCompletionReadinessForRun({
        runId: run.id,
        operatorApproval: readinessApproval,
        decision,
        verificationNotes: `notes for ${decision}`,
      });

      expect(result.status).toBe("completion_readiness_recorded");
      expect(result.decision).toBe(decision);
      expect(result.notComplete).toBe(true);
      expect(fs.existsSync(result.completionReadinessEvidencePath)).toBe(true);

      const evidence = JSON.parse(
        fs.readFileSync(result.completionReadinessEvidencePath, "utf8"),
      ) as {
        schema: string;
        decision: string;
        productionVerificationSummary: unknown;
        notComplete: boolean;
      };
      expect(evidence.schema).toBe(ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA);
      expect(evidence.decision).toBe(decision);
      expect(evidence.notComplete).toBe(true);

      const record = getLatestCommitCandidateForRun(run.id);
      expect(record?.status).toBe("completion_readiness_recorded");
      expect(record?.completionReadinessDecision).toBe(decision);

      const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
      expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_COMPLETION_READINESS_RECORDED);
      expect(getRunById(run.id)?.status).not.toBe("completed");
    },
  );

  it("does not run deploy scripts or restart services", async () => {
    const { run } = await seedWithProductionDeployed();
    const commitCountBefore = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    await recordCompletionReadinessForRun({
      runId: run.id,
      operatorApproval: readinessApproval,
      decision: "ready",
    });
    const commitCountAfter = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    expect(commitCountAfter).toBe(commitCountBefore);
    expect(COMPLETION_READINESS_SOURCE).not.toMatch(/\bspawn\b|\bexecFileSync\b|\bexecSync\b/);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("bridge summary includes latest completion readiness", async () => {
    const { run } = await seedWithProductionDeployed();
    await recordCompletionReadinessForRun({
      runId: run.id,
      operatorApproval: readinessApproval,
      decision: "blocked",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestCompletionReadiness.completionReadinessStatus).toBe(
      "completion_readiness_recorded",
    );
    expect(bridge?.completionReadinessDecision).toBe("blocked");
    expect(bridge?.notComplete).toBe(true);
  });

  it("Hermes consumer cannot record completion readiness", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/completion-readiness|recordCompletionReadiness/);
  });

  it("VeraLux OS cannot record completion readiness via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(/completion-readiness|recordCompletionReadiness/);
  });
});
