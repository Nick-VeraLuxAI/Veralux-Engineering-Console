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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA } from "./production-deployment-types";
import {
  LOCAL_SCRIPT_PRODUCTION_ADAPTER_USES_SHELL,
  setControlledLocalScriptProductionDeploymentAdapterForTests,
  type ControlledLocalScriptProductionDeploymentAdapter,
} from "./local-script-production-deployment-adapter";

const PRODUCTION_DEPLOY_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/execute-production-deployment.ts",
  ),
  "utf8",
);
const ADAPTER_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/local-script-production-deployment-adapter.ts",
  ),
  "utf8",
);

describe("Governed production deployment phase 21", () => {
  let repoRoot: string;
  let bareRemote: string;
  let tmpDb: string;
  let tmpEvidence: string;
  let listedPrs: Array<{ number: number; url: string }> = [];
  let prMerged = false;
  let localCommitHash = "";
  const adapterCalls: Array<{ repoPath: string; mergeCommitSha: string }> = [];

  const mockExecutor: ControlledGitExecutor = {
    git: vi.fn(async () => ({ stdout: "", stderr: "" })),
    gh: vi.fn(async (args: string[]) => {
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify(listedPrs), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.com/test-org/p21-test/pull/101\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      if (args[0] === "pr" && args[1] === "view") {
        const candidate = getLatestCommitCandidateForRun(
          (globalThis as { __p21RunId?: string }).__p21RunId ?? "",
        );
        const headOid = candidate?.localCommitHash ?? localCommitHash;
        return {
          stdout: JSON.stringify({
            state: prMerged ? "MERGED" : "OPEN",
            merged: prMerged,
            url: "https://github.com/test-org/p21-test/pull/101",
            headRefName: candidate?.remoteBranchName ?? "engineering/p21-test",
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

  const mockAdapter: ControlledLocalScriptProductionDeploymentAdapter = {
    exec: vi.fn(async (repoPath: string, mergeCommitSha: string) => {
      adapterCalls.push({ repoPath, mergeCommitSha });
      return {
        exitCode: 0,
        stdout: "production deploy ok\n",
        stderr: "",
        timedOut: false,
        scriptPath: path.join(repoPath, "scripts/deploy-production.sh"),
      };
    }),
  };

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    listedPrs = [];
    prMerged = false;
    localCommitHash = "";
    adapterCalls.length = 0;
    setControlledGitExecutorForTests(mockExecutor);
    setControlledGhMergeExecutorForTests(mockGhMergeExecutor);
    setControlledLocalScriptProductionDeploymentAdapterForTests(mockAdapter);

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-prod-p21-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-prod-p21-bare-"));
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
        name: "p21-test",
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

    tmpDb = path.join(os.tmpdir(), `governed-prod-p21-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-prod-p21-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    delete (globalThis as { __p21RunId?: string }).__p21RunId;
    setControlledGitExecutorForTests(null);
    setControlledGhMergeExecutorForTests(null);
    setControlledLocalScriptProductionDeploymentAdapterForTests(null);
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function seedWithProductionDeploymentPacketPrepared() {
    const task = createTask({
      title: "Governed production deployment P21",
      description: "Phase 21",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p21RunId?: string }).__p21RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p21 doc",
      allowedFiles: ["docs/p21.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p21.md",
          content: "# p21\n",
          reason: "phase21",
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
      "--- a/docs/p21.md\n+++ b/docs/p21.md\n@@ -0,0 +1,2 @@\n+# p21\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p21.md", changeType: "add", reason: "phase21", allowedByPolicy: true }],
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
      reason: "Ready for production deployment",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p21 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    localCommitHash = getLatestCommitCandidateForRun(run.id)?.localCommitHash ?? "";

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p21-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p21-test.git"],
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

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const deployApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Deploy to production",
  };

  it("uses execFile, not shell", () => {
    expect(LOCAL_SCRIPT_PRODUCTION_ADAPTER_USES_SHELL).toBe(false);
    expect(ADAPTER_SOURCE).toContain('shell: false');
    expect(ADAPTER_SOURCE).not.toContain("spawn(");
    expect(PRODUCTION_DEPLOY_SOURCE).not.toMatch(/\bcompleteRun\b/);
    expect(PRODUCTION_DEPLOY_SOURCE).not.toContain("sudo");
  });

  it("cannot deploy production without production deployment packet", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          status = 'production_readiness_recorded',
          production_deployment_packet_status = NULL,
          production_deployment_packet_path = NULL,
          production_deployment_plan_path = NULL,
          production_deployment_rollback_notes = NULL
         WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_DEPLOYMENT_PACKET_REQUIRED" });
  });

  it("cannot deploy production unless production readiness is ready", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET production_readiness_decision = 'blocked' WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_READINESS_NOT_READY" });
  });

  it("cannot deploy production without successful staging deployment", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          staging_deployment_status = NULL,
          staging_deployment_evidence_path = NULL,
          staging_deployment_exit_code = NULL
         WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "STAGING_DEPLOYMENT_REQUIRED" });
  });

  it("requires rollback notes from packet", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET production_deployment_rollback_notes = NULL WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "ROLLBACK_NOTES_REQUIRED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("rejects non-production target", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "staging" as "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "NON_PRODUCTION_TARGET_FORBIDDEN" });
  });

  it("rejects unsafe adapter and arbitrary commands", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "render-cli" as "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_DEPLOYMENT_ADAPTER" });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
        customCommand: "npm run deploy",
      }),
    ).rejects.toMatchObject({ code: "ARBITRARY_COMMAND_FORBIDDEN" });
  });

  it("rejects production deploy when adapter script is unavailable", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    fs.rmSync(path.join(repoRoot, "scripts/deploy-production.sh"));
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_ADAPTER_UNAVAILABLE" });
  });

  it("records production deployment evidence on success", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    const result = await executeProductionDeploymentForRun({
      runId: run.id,
      operatorApproval: deployApproval,
      targetEnvironment: "production",
      deploymentAdapter: "local-production-script",
    });

    expect(result.status).toBe("production_deployed");
    expect(result.exitCode).toBe(0);
    expect(result.notComplete).toBe(true);
    expect(fs.existsSync(result.deploymentEvidencePath)).toBe(true);

    const evidence = JSON.parse(fs.readFileSync(result.deploymentEvidencePath, "utf8")) as {
      schema: string;
      targetEnvironment: string;
      deploymentAdapter: string;
      rollbackNotes: string;
      notComplete: boolean;
    };
    expect(evidence.schema).toBe(ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA);
    expect(evidence.targetEnvironment).toBe("production");
    expect(evidence.deploymentAdapter).toBe("local-production-script");
    expect(evidence.rollbackNotes).toContain("Revert to previous production release");
    expect(evidence.notComplete).toBe(true);

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("production_deployed");
    expect(adapterCalls.length).toBe(1);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("records failed production deployment evidence when adapter fails", async () => {
    setControlledLocalScriptProductionDeploymentAdapterForTests({
      exec: vi.fn(async () => ({
        exitCode: 2,
        stdout: "",
        stderr: "production deploy failed",
        timedOut: false,
        scriptPath: path.join(repoRoot, "scripts/deploy-production.sh"),
      })),
    });
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    const result = await executeProductionDeploymentForRun({
      runId: run.id,
      operatorApproval: deployApproval,
      targetEnvironment: "production",
      deploymentAdapter: "local-production-script",
    });

    expect(result.status).toBe("production_deployment_failed");
    expect(result.exitCode).toBe(2);
    expect(fs.existsSync(result.deploymentEvidencePath)).toBe(true);
    expect(getLatestCommitCandidateForRun(run.id)?.status).toBe("production_deployment_failed");

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_FAILED);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("does not mark run complete or delete branches", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    const branchesBefore = execFileSync("git", ["branch", "-a"], { cwd: repoRoot }).toString();
    await executeProductionDeploymentForRun({
      runId: run.id,
      operatorApproval: deployApproval,
      targetEnvironment: "production",
      deploymentAdapter: "local-production-script",
    });
    const branchesAfter = execFileSync("git", ["branch", "-a"], { cwd: repoRoot }).toString();
    expect(branchesAfter).toBe(branchesBefore);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("bridge summary includes latest production deployment", async () => {
    const { run } = await seedWithProductionDeploymentPacketPrepared();
    const result = await executeProductionDeploymentForRun({
      runId: run.id,
      operatorApproval: deployApproval,
      targetEnvironment: "production",
      deploymentAdapter: "local-production-script",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestProductionDeployment.productionDeploymentStatus).toBe("production_deployed");
    expect(bridge?.productionDeploymentEvidencePath).toBe(result.deploymentEvidencePath);
    expect(bridge?.notComplete).toBe(true);
  });

  it("cannot deploy production after rollback invalidates workflow", async () => {
    const { run, dispatch } = await seedWithProductionDeploymentPacketPrepared();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      executeProductionDeploymentForRun({
        runId: run.id,
        operatorApproval: deployApproval,
        targetEnvironment: "production",
        deploymentAdapter: "local-production-script",
      }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("Hermes consumer cannot trigger production deployment", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/production-deploy|executeProductionDeployment/);
  });

  it("VeraLux OS cannot trigger production deployment via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(/production-deploy|executeProductionDeployment/);
  });
});
