import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { buildRunEvidenceSummaryForBridge } from "../../bridge/run-evidence-summary";
import { resetEngineerConsoleDbForTests, getEngineerConsoleDb } from "../../db/client";
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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_MERGE_READINESS_RESULT_SCHEMA } from "./merge-readiness-types";

const MERGE_READINESS_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/record-merge-readiness.ts",
  ),
  "utf8",
);

describe("Governed merge readiness phase 14", () => {
  let repoRoot: string;
  let bareRemote: string;
  let tmpDb: string;
  let tmpEvidence: string;
  const ghCalls: string[][] = [];
  const ghMergeCalls: string[][] = [];
  let listedPrs: Array<{ number: number; url: string }> = [];
  let commitCountBefore = 0;

  const mockExecutor: ControlledGitExecutor = {
    git: vi.fn(async () => ({ stdout: "", stderr: "" })),
    gh: vi.fn(async (args: string[]) => {
      ghCalls.push(args);
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify(listedPrs), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.com/test-org/p14-test/pull/42\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      ghMergeCalls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            state: "OPEN",
            merged: false,
            url: "https://github.com/test-org/p14-test/pull/42",
            headRefName: "engineering/p14-test",
            baseRefName: "main",
            headRefOid: "abc123",
          }),
          stderr: "",
        };
      }
      throw new Error("unexpected gh merge call");
    }),
  };

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    ghCalls.length = 0;
    ghMergeCalls.length = 0;
    listedPrs = [];
    setControlledGitExecutorForTests(mockExecutor);
    setControlledGhMergeExecutorForTests(mockGhMergeExecutor);

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-mr-p14-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-mr-p14-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p14-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });
    commitCountBefore = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );

    tmpDb = path.join(os.tmpdir(), `governed-mr-p14-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-mr-p14-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
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

  async function seedWithPullRequest(mode: "create_pr" | "prepare_packet" = "prepare_packet") {
    const task = createTask({
      title: "Governed merge readiness P14",
      description: "Phase 14",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p14 doc",
      allowedFiles: ["docs/p14.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p14.md",
          content: "# p14\n",
          reason: "phase14",
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
      "--- a/docs/p14.md\n+++ b/docs/p14.md\n@@ -0,0 +1,2 @@\n+# p14\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p14.md", changeType: "add", reason: "phase14", allowedByPolicy: true }],
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
      reason: "Ready for merge readiness",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p14 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p14-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p14-test.git"],
      { cwd: repoRoot },
    );

    await createGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Create governed pull request",
      },
      mode,
      baseBranch: "main",
    });

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const mergeReadinessApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Record merge readiness review",
  };

  it("does not merge, deploy, or complete in implementation", () => {
    expect(MERGE_READINESS_SOURCE).not.toContain("mergeGithubPr");
    expect(MERGE_READINESS_SOURCE).not.toContain("executeDeployment");
    expect(MERGE_READINESS_SOURCE).not.toMatch(/\bcompleteRun\b/);
    expect(MERGE_READINESS_SOURCE).not.toContain("git push");
    expect(MERGE_READINESS_SOURCE).not.toContain("--delete-branch");
  });

  it("cannot record merge readiness without PR", async () => {
    const { run } = await seedWithPullRequest();
    const candidate = getLatestCommitCandidateForRun(run.id)!;
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_commit_candidates SET status = 'remote_branch_pushed', pr_evidence_path = NULL WHERE id = ?`,
      )
      .run(candidate.id);

    await expect(
      recordMergeReadinessForRun({
        runId: run.id,
        operatorApproval: mergeReadinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PR_REQUIRED" });
  });

  it("cannot record merge readiness without approved sign-off", async () => {
    const { run } = await seedWithPullRequest();
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "rejected",
      reviewer: "lead",
      reason: "no",
    });
    await expect(
      recordMergeReadinessForRun({
        runId: run.id,
        operatorApproval: mergeReadinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
  });

  it("cannot record merge readiness after rollback", async () => {
    const { run, dispatch } = await seedWithPullRequest();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      recordMergeReadinessForRun({
        runId: run.id,
        operatorApproval: mergeReadinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithPullRequest();
    await expect(
      recordMergeReadinessForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      recordMergeReadinessForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it.each(["ready", "not_ready", "blocked"] as const)(
    "records merge readiness decision %s with evidence",
    async (decision) => {
      const { run, candidate } = await seedWithPullRequest();
      const result = await recordMergeReadinessForRun({
        runId: run.id,
        operatorApproval: mergeReadinessApproval,
        decision,
        notes: `notes for ${decision}`,
      });

      expect(result.status).toBe("merge_readiness_recorded");
      expect(result.decision).toBe(decision);
      expect(result.notMerged).toBe(true);
      expect(result.notDeployed).toBe(true);
      expect(result.notComplete).toBe(true);
      expect(fs.existsSync(result.mergeReadinessPath)).toBe(true);

      const evidence = JSON.parse(fs.readFileSync(result.mergeReadinessPath, "utf8")) as {
        schema: string;
        decision: string;
        prUrl: string | null;
        notMerged: boolean;
        notDeployed: boolean;
        notComplete: boolean;
      };
      expect(evidence.schema).toBe(ENGINEERING_MERGE_READINESS_RESULT_SCHEMA);
      expect(evidence.decision).toBe(decision);
      expect(evidence.notMerged).toBe(true);
      expect(evidence.notDeployed).toBe(true);
      expect(evidence.notComplete).toBe(true);

      const record = getLatestCommitCandidateForRun(run.id);
      expect(record?.status).toBe("merge_readiness_recorded");
      expect(record?.mergeReadinessDecision).toBe(decision);
      expect(record?.mergeReadinessEvidencePath).toBe(result.mergeReadinessPath);

      const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
      expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_MERGE_READINESS_RECORDED);

      expect(getRunById(run.id)?.status).not.toBe("completed");
      void candidate;
    },
  );

  it("does not push additional commits or delete branches", async () => {
    const { run } = await seedWithPullRequest();
    await recordMergeReadinessForRun({
      runId: run.id,
      operatorApproval: mergeReadinessApproval,
      decision: "ready",
    });

    const commitCountAfter = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    expect(commitCountAfter).toBe(commitCountBefore + 1);

    const mergeCall = ghMergeCalls.find((args) => args[1] === "merge");
    expect(mergeCall).toBeUndefined();
    const pushCall = ghCalls.find((args) => args[0] === "push");
    expect(pushCall).toBeUndefined();
    const deleteBranchCall = ghMergeCalls.find((args) =>
      args.some((a) => a.includes("delete-branch") && a !== "--delete-branch=false"),
    );
    expect(deleteBranchCall).toBeUndefined();
  });

  it("bridge summary includes latest merge readiness", async () => {
    const { run } = await seedWithPullRequest();
    await recordMergeReadinessForRun({
      runId: run.id,
      operatorApproval: mergeReadinessApproval,
      decision: "blocked",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestMergeReadiness.mergeReadinessStatus).toBe("merge_readiness_recorded");
    expect(bridge?.latestMergeReadiness.mergeReadinessDecision).toBe("blocked");
    expect(bridge?.mergeReadinessDecision).toBe("blocked");
    expect(bridge?.latestMergeReadiness.notMerged).toBe(true);
  });

  it("Hermes consumer cannot record merge readiness", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/merge-readiness|recordMergeReadiness/);
  });

  it("VeraLux OS cannot record governed merge readiness via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(/merge-readiness|recordMergeReadiness/);
  });
});
