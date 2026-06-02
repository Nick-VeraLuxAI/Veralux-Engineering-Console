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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA } from "./production-deployment-packet-types";
import {
  setControlledLocalScriptStagingDeploymentAdapterForTests,
  type ControlledLocalScriptStagingDeploymentAdapter,
} from "./local-script-staging-deployment-adapter";

const PRODUCTION_DEPLOYMENT_PACKET_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/prepare-production-deployment-packet.ts",
  ),
  "utf8",
);

describe("Governed production deployment packet phase 20", () => {
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
        return { stdout: "https://github.com/test-org/p20-test/pull/101\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      if (args[0] === "pr" && args[1] === "view") {
        const candidate = getLatestCommitCandidateForRun(
          (globalThis as { __p20RunId?: string }).__p20RunId ?? "",
        );
        const headOid = candidate?.localCommitHash ?? localCommitHash;
        return {
          stdout: JSON.stringify({
            state: prMerged ? "MERGED" : "OPEN",
            merged: prMerged,
            url: "https://github.com/test-org/p20-test/pull/101",
            headRefName: candidate?.remoteBranchName ?? "engineering/p20-test",
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

  const mockAdapter: ControlledLocalScriptStagingDeploymentAdapter = {
    exec: vi.fn(async (repoPath: string, _mergeCommitSha: string) => ({
      exitCode: 0,
      stdout: "staging deploy ok\n",
      stderr: "",
      timedOut: false,
      scriptPath: path.join(repoPath, "scripts/deploy-staging.sh"),
    })),
  };

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    listedPrs = [];
    prMerged = false;
    localCommitHash = "";
    setControlledGitExecutorForTests(mockExecutor);
    setControlledGhMergeExecutorForTests(mockGhMergeExecutor);
    setControlledLocalScriptStagingDeploymentAdapterForTests(mockAdapter);

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-prod-p20-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-prod-p20-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "scripts/deploy-staging.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p20-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json", "scripts/deploy-staging.sh"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `governed-prod-p20-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-prod-p20-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    delete (globalThis as { __p20RunId?: string }).__p20RunId;
    setControlledGitExecutorForTests(null);
    setControlledGhMergeExecutorForTests(null);
    setControlledLocalScriptStagingDeploymentAdapterForTests(null);
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

  async function seedWithProductionReadinessReady() {
    const task = createTask({
      title: "Governed production deployment packet P20",
      description: "Phase 20",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p20RunId?: string }).__p20RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p20 doc",
      allowedFiles: ["docs/p20.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p20.md",
          content: "# p20\n",
          reason: "phase20",
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
      "--- a/docs/p20.md\n+++ b/docs/p20.md\n@@ -0,0 +1,2 @@\n+# p20\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p20.md", changeType: "add", reason: "phase20", allowedByPolicy: true }],
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
      reason: "Ready for production deployment packet",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p20 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    localCommitHash = getLatestCommitCandidateForRun(run.id)?.localCommitHash ?? "";

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p20-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p20-test.git"],
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

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const packetApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Prepare production deployment packet",
  };

  const rollbackNotes = "Revert to previous production release tag v1.2.3 if health checks fail.";

  it("does not deploy production or mark run complete", () => {
    expect(PRODUCTION_DEPLOYMENT_PACKET_SOURCE).not.toContain("executeStagingDeployment");
    expect(PRODUCTION_DEPLOYMENT_PACKET_SOURCE).not.toMatch(/\bcompleteRun\b/);
    expect(PRODUCTION_DEPLOYMENT_PACKET_SOURCE).not.toContain("deploy-local-production");
    expect(PRODUCTION_DEPLOYMENT_PACKET_SOURCE).not.toContain("sudo");
  });

  it("cannot prepare production deployment packet without production readiness", async () => {
    const { run } = await seedWithProductionReadinessReady();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          status = 'staging_deployed',
          production_readiness_status = NULL,
          production_readiness_decision = NULL,
          production_readiness_evidence_path = NULL
         WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_READINESS_REQUIRED" });
  });

  it("cannot prepare production deployment packet unless production readiness is ready", async () => {
    const { run } = await seedWithProductionReadinessReady();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET production_readiness_decision = 'blocked' WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_READINESS_NOT_READY" });
  });

  it("cannot prepare production deployment packet without successful staging deployment", async () => {
    const { run } = await seedWithProductionReadinessReady();
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          status = 'production_readiness_recorded',
          staging_deployment_status = NULL,
          staging_deployment_evidence_path = NULL,
          staging_deployment_exit_code = NULL
         WHERE run_id = @run_id`,
      )
      .run({ run_id: run.id });
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "STAGING_DEPLOYMENT_REQUIRED" });
  });

  it("requires operator approval", async () => {
    const { run } = await seedWithProductionReadinessReady();
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });

  it("requires non-empty reason", async () => {
    const { run } = await seedWithProductionReadinessReady();
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("requires rollback notes", async () => {
    const { run } = await seedWithProductionReadinessReady();
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        rollbackNotes: "  ",
      }),
    ).rejects.toMatchObject({ code: "ROLLBACK_NOTES_REQUIRED" });
  });

  it("rejects non-production target environment", async () => {
    const { run } = await seedWithProductionReadinessReady();
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        targetEnvironment: "staging" as "production",
        operatorApproval: packetApproval,
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET_ENVIRONMENT" });
  });

  it("records evidence artifacts without deploying production", async () => {
    const { run } = await seedWithProductionReadinessReady();
    const commitCountBefore = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );

    const result = await prepareProductionDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      deploymentNotes: "Deploy during maintenance window",
      rollbackNotes,
    });

    expect(result.status).toBe("production_deployment_packet_prepared");
    expect(result.targetEnvironment).toBe("production");
    expect(result.notProductionDeployed).toBe(true);
    expect(result.notComplete).toBe(true);
    expect(fs.existsSync(result.productionDeploymentPacketPath)).toBe(true);
    expect(fs.existsSync(result.productionDeploymentPlanPath)).toBe(true);

    const packet = JSON.parse(
      fs.readFileSync(result.productionDeploymentPacketPath, "utf8"),
    ) as {
      schema: string;
      rollbackNotes: string;
      notProductionDeployed: boolean;
      notComplete: boolean;
    };
    expect(packet.schema).toBe(ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA);
    expect(packet.rollbackNotes).toBe(rollbackNotes);
    expect(packet.notProductionDeployed).toBe(true);
    expect(packet.notComplete).toBe(true);

    const plan = fs.readFileSync(result.productionDeploymentPlanPath, "utf8");
    expect(plan).toContain("Not production deployed");
    expect(plan).toContain("production deployment packet only");

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("production_deployment_packet_prepared");
    expect(record?.productionDeploymentRollbackNotes).toBe(rollbackNotes);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_PREPARED);

    const commitCountAfter = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    expect(commitCountAfter).toBe(commitCountBefore);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("does not run deploy scripts or restart services", async () => {
    const { run } = await seedWithProductionReadinessReady();
    await prepareProductionDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      rollbackNotes,
    });
    expect(PRODUCTION_DEPLOYMENT_PACKET_SOURCE).not.toMatch(/\bspawn\b|\bexecFileSync\b|\bexecSync\b/);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("rejects deploy now requests", async () => {
    const { run } = await seedWithProductionReadinessReady();
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        rollbackNotes,
        deployNow: true,
      }),
    ).rejects.toMatchObject({ code: "DEPLOY_NOW_FORBIDDEN" });
  });

  it("bridge summary includes latest production deployment packet", async () => {
    const { run } = await seedWithProductionReadinessReady();
    const result = await prepareProductionDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      rollbackNotes,
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestProductionDeploymentPacket.productionDeploymentPacketStatus).toBe(
      "production_deployment_packet_prepared",
    );
    expect(bridge?.productionDeploymentPacketPath).toBe(result.productionDeploymentPacketPath);
    expect(bridge?.productionDeploymentPlanPath).toBe(result.productionDeploymentPlanPath);
    expect(bridge?.notProductionDeployed).toBe(true);
    expect(bridge?.notComplete).toBe(true);
  });

  it("cannot prepare production deployment packet after rollback invalidates workflow", async () => {
    const { run, dispatch } = await seedWithProductionReadinessReady();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      prepareProductionDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        rollbackNotes,
      }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("Hermes consumer cannot prepare production deployment packet", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(
      /production-deployment-packet|prepareProductionDeploymentPacket/,
    );
  });

  it("VeraLux OS cannot prepare production deployment packet via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(
      /production-deployment-packet|prepareProductionDeploymentPacket/,
    );
  });
});
