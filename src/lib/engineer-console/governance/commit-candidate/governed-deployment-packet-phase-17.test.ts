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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_DEPLOYMENT_PACKET_SCHEMA } from "./deployment-packet-types";

const DEPLOYMENT_PACKET_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/prepare-deployment-packet.ts",
  ),
  "utf8",
);

describe("Governed deployment packet phase 17", () => {
  let repoRoot: string;
  let bareRemote: string;
  let tmpDb: string;
  let tmpEvidence: string;
  const ghCalls: string[][] = [];
  const ghMergeCalls: string[][] = [];
  let listedPrs: Array<{ number: number; url: string }> = [];
  let prMerged = false;
  let localCommitHash = "";

  const mockExecutor: ControlledGitExecutor = {
    git: vi.fn(async () => ({ stdout: "", stderr: "" })),
    gh: vi.fn(async (args: string[]) => {
      ghCalls.push(args);
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify(listedPrs), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.com/test-org/p17-test/pull/88\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      ghMergeCalls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        const candidate = getLatestCommitCandidateForRun(
          (globalThis as { __p17RunId?: string }).__p17RunId ?? "",
        );
        const headOid = candidate?.localCommitHash ?? localCommitHash;
        return {
          stdout: JSON.stringify({
            state: prMerged ? "MERGED" : "OPEN",
            merged: prMerged,
            url: "https://github.com/test-org/p17-test/pull/88",
            headRefName: candidate?.remoteBranchName ?? "engineering/p17-test",
            baseRefName: "main",
            headRefOid: headOid,
            mergeCommit: prMerged
              ? { oid: "cafebabecafebabecafebabecafebabecafebabe" }
              : null,
          }),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        prMerged = true;
        return { stdout: "Merged pull request #88\n", stderr: "" };
      }
      throw new Error("unexpected gh merge call");
    }),
  };

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    ghCalls.length = 0;
    ghMergeCalls.length = 0;
    listedPrs = [];
    prMerged = false;
    localCommitHash = "";
    setControlledGitExecutorForTests(mockExecutor);
    setControlledGhMergeExecutorForTests(mockGhMergeExecutor);

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-deploy-p17-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-deploy-p17-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p17-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `governed-deploy-p17-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-deploy-p17-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    delete (globalThis as { __p17RunId?: string }).__p17RunId;
    setControlledGitExecutorForTests(null);
    setControlledGhMergeExecutorForTests(null);
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

  async function seedWithDeployReadinessReady() {
    const task = createTask({
      title: "Governed deployment packet P17",
      description: "Phase 17",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p17RunId?: string }).__p17RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p17 doc",
      allowedFiles: ["docs/p17.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p17.md",
          content: "# p17\n",
          reason: "phase17",
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
      "--- a/docs/p17.md\n+++ b/docs/p17.md\n@@ -0,0 +1,2 @@\n+# p17\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p17.md", changeType: "add", reason: "phase17", allowedByPolicy: true }],
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
      reason: "Ready for deployment packet",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p17 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    localCommitHash = getLatestCommitCandidateForRun(run.id)?.localCommitHash ?? "";

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p17-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p17-test.git"],
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

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const packetApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Prepare governed deployment packet",
  };

  it("does not execute deployment commands or mark run complete", () => {
    expect(DEPLOYMENT_PACKET_SOURCE).not.toContain("executeDeployment");
    expect(DEPLOYMENT_PACKET_SOURCE).not.toMatch(/\bcompleteRun\b/);
    expect(DEPLOYMENT_PACKET_SOURCE).not.toContain("scripts/deploy");
    expect(DEPLOYMENT_PACKET_SOURCE).toContain("reference only");
    expect(DEPLOYMENT_PACKET_SOURCE).toContain("Not deployed");
  });

  async function seedWithMergedPrOnly() {
    const seeded = await seedWithDeployReadinessReady();
    const candidate = getLatestCommitCandidateForRun(seeded.run.id)!;
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET
          status = 'pull_request_merged',
          deploy_readiness_status = NULL,
          deploy_readiness_decision = NULL,
          deploy_readiness_evidence_path = NULL
         WHERE id = @id`,
      )
      .run({ id: candidate.id });
    return { ...seeded, candidate: getLatestCommitCandidateForRun(seeded.run.id)! };
  }

  it("cannot prepare deployment packet without deploy readiness", async () => {
    const { run } = await seedWithMergedPrOnly();
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        targetEnvironment: "staging",
      }),
    ).rejects.toMatchObject({ code: "DEPLOY_READINESS_REQUIRED" });
  });

  it("cannot prepare deployment packet unless deploy readiness is ready", async () => {
    const { run } = await seedWithDeployReadinessReady();
    await recordDeployReadinessForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      decision: "blocked",
    });
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        targetEnvironment: "staging",
      }),
    ).rejects.toMatchObject({ code: "DEPLOY_READINESS_NOT_READY" });
  });

  it("cannot prepare deployment packet without merge", async () => {
    const task = createTask({ title: "No merge", description: "x", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        targetEnvironment: "staging",
      }),
    ).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithDeployReadinessReady();
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
        targetEnvironment: "staging",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
        targetEnvironment: "staging",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("rejects unsafe target environment", async () => {
    const { run } = await seedWithDeployReadinessReady();
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        targetEnvironment: "production" as "staging",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_TARGET_ENVIRONMENT" });
  });

  it("prepares deployment packet with evidence artifacts", async () => {
    const { run } = await seedWithDeployReadinessReady();
    const result = await prepareDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      targetEnvironment: "staging",
      deploymentNotes: "staging candidate only",
    });

    expect(result.status).toBe("deployment_packet_prepared");
    expect(result.targetEnvironment).toBe("staging");
    expect(result.notDeployed).toBe(true);
    expect(result.notComplete).toBe(true);
    expect(fs.existsSync(result.deploymentPacketPath)).toBe(true);
    expect(fs.existsSync(result.deploymentPlanPath)).toBe(true);

    const packet = JSON.parse(fs.readFileSync(result.deploymentPacketPath, "utf8")) as {
      schema: string;
      targetEnvironment: string;
      mergeCommitSha: string;
      notDeployed: boolean;
      notComplete: boolean;
    };
    expect(packet.schema).toBe(ENGINEERING_DEPLOYMENT_PACKET_SCHEMA);
    expect(packet.targetEnvironment).toBe("staging");
    expect(packet.mergeCommitSha).toBeTruthy();
    expect(packet.notDeployed).toBe(true);
    expect(packet.notComplete).toBe(true);

    const plan = fs.readFileSync(result.deploymentPlanPath, "utf8");
    expect(plan).toContain("Not deployed");
    expect(plan).toContain("reference only");

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("deployment_packet_prepared");
    expect(record?.deploymentTargetEnvironment).toBe("staging");

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_DEPLOYMENT_PACKET_PREPARED);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("does not deploy, restart services, or run deploy scripts", async () => {
    const { run } = await seedWithDeployReadinessReady();
    const commitCountBefore = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    await prepareDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      targetEnvironment: "staging",
    });
    const commitCountAfter = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    expect(commitCountAfter).toBe(commitCountBefore);
    expect(DEPLOYMENT_PACKET_SOURCE).not.toMatch(/\bspawn\b|\bexecFileSync\b|\bexecSync\b/);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("bridge summary includes latest deployment packet", async () => {
    const { run } = await seedWithDeployReadinessReady();
    await prepareDeploymentPacketForRun({
      runId: run.id,
      operatorApproval: packetApproval,
      targetEnvironment: "staging",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestDeploymentPacket.deploymentPacketStatus).toBe(
      "deployment_packet_prepared",
    );
    expect(bridge?.deploymentTargetEnvironment).toBe("staging");
    expect(bridge?.latestDeploymentPacket.notDeployed).toBe(true);
    expect(bridge?.latestDeploymentPacket.notComplete).toBe(true);
  });

  it("cannot prepare deployment packet after rollback invalidates workflow", async () => {
    const { run, dispatch } = await seedWithDeployReadinessReady();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      prepareDeploymentPacketForRun({
        runId: run.id,
        operatorApproval: packetApproval,
        targetEnvironment: "staging",
      }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("Hermes consumer cannot prepare deployment packet", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/deployment-packet|prepareDeploymentPacket/);
  });

  it("VeraLux OS cannot prepare deployment packet via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(/deployment-packet|prepareDeploymentPacket/);
  });
});
