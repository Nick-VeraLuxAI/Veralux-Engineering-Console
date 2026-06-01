import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA } from "./deploy-readiness-types";

const DEPLOY_READINESS_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/record-deploy-readiness.ts",
  ),
  "utf8",
);
const POST_MERGE_GIT_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/governed-post-merge-git.ts",
  ),
  "utf8",
);

describe("Governed deploy readiness phase 16", () => {
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
        return { stdout: "https://github.com/test-org/p16-test/pull/77\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      ghMergeCalls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        const candidate = getLatestCommitCandidateForRun(
          (globalThis as { __p16RunId?: string }).__p16RunId ?? "",
        );
        const headOid = candidate?.localCommitHash ?? localCommitHash;
        return {
          stdout: JSON.stringify({
            state: prMerged ? "MERGED" : "OPEN",
            merged: prMerged,
            url: "https://github.com/test-org/p16-test/pull/77",
            headRefName: candidate?.remoteBranchName ?? "engineering/p16-test",
            baseRefName: "main",
            headRefOid: headOid,
            mergeCommit: prMerged
              ? { oid: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }
              : null,
          }),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        prMerged = true;
        return { stdout: "Merged pull request #77\n", stderr: "" };
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

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-deploy-p16-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-deploy-p16-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p16-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `governed-deploy-p16-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-deploy-p16-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    delete (globalThis as { __p16RunId?: string }).__p16RunId;
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

  async function seedWithMergedPr() {
    const task = createTask({
      title: "Governed deploy readiness P16",
      description: "Phase 16",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p16RunId?: string }).__p16RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p16 doc",
      allowedFiles: ["docs/p16.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p16.md",
          content: "# p16\n",
          reason: "phase16",
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
      "--- a/docs/p16.md\n+++ b/docs/p16.md\n@@ -0,0 +1,2 @@\n+# p16\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p16.md", changeType: "add", reason: "phase16", allowedByPolicy: true }],
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
      reason: "Ready for deploy readiness",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p16 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    localCommitHash = getLatestCommitCandidateForRun(run.id)?.localCommitHash ?? "";

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p16-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p16-test.git"],
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

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const deployReadinessApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Record deploy readiness review",
  };

  it("uses read-only post-merge git helper without destructive commands", () => {
    expect(POST_MERGE_GIT_SOURCE).toContain("shell: false");
    expect(POST_MERGE_GIT_SOURCE).toContain('"checkout"');
    expect(POST_MERGE_GIT_SOURCE).toContain('"reset"');
    expect(DEPLOY_READINESS_SOURCE).not.toContain("executeDeployment");
    expect(DEPLOY_READINESS_SOURCE).not.toMatch(/\bcompleteRun\b/);
    expect(DEPLOY_READINESS_SOURCE).not.toContain("git push");
  });

  it("cannot record deploy readiness without merge", async () => {
    const task = createTask({ title: "No merge", description: "x", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    await expect(
      recordDeployReadinessForRun({
        runId: run.id,
        operatorApproval: deployReadinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("cannot record deploy readiness without approved sign-off", async () => {
    const { run } = await seedWithMergedPr();
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "rejected",
      reviewer: "lead",
      reason: "no",
    });
    await expect(
      recordDeployReadinessForRun({
        runId: run.id,
        operatorApproval: deployReadinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
  });

  it("cannot record deploy readiness after rollback invalidates workflow", async () => {
    const { run, dispatch } = await seedWithMergedPr();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      recordDeployReadinessForRun({
        runId: run.id,
        operatorApproval: deployReadinessApproval,
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithMergedPr();
    await expect(
      recordDeployReadinessForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      recordDeployReadinessForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
        decision: "ready",
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it.each(["ready", "not_ready", "blocked"] as const)(
    "records deploy readiness decision %s with evidence",
    async (decision) => {
      const { run } = await seedWithMergedPr();
      const result = await recordDeployReadinessForRun({
        runId: run.id,
        operatorApproval: deployReadinessApproval,
        decision,
        notes: `notes for ${decision}`,
      });

      expect(result.status).toBe("deploy_readiness_recorded");
      expect(result.decision).toBe(decision);
      expect(result.notDeployed).toBe(true);
      expect(result.notComplete).toBe(true);
      expect(fs.existsSync(result.deployReadinessPath)).toBe(true);

      const evidence = JSON.parse(fs.readFileSync(result.deployReadinessPath, "utf8")) as {
        schema: string;
        decision: string;
        mergeCommitSha: string;
        notDeployed: boolean;
        notComplete: boolean;
      };
      expect(evidence.schema).toBe(ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA);
      expect(evidence.decision).toBe(decision);
      expect(evidence.notDeployed).toBe(true);
      expect(evidence.notComplete).toBe(true);

      const record = getLatestCommitCandidateForRun(run.id);
      expect(record?.status).toBe("deploy_readiness_recorded");
      expect(record?.deployReadinessDecision).toBe(decision);

      const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
      expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_DEPLOY_READINESS_RECORDED);
      expect(getRunById(run.id)?.status).not.toBe("completed");
    },
  );

  it("does not deploy, complete, or push additional commits", async () => {
    const { run } = await seedWithMergedPr();
    const commitCountBefore = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    await recordDeployReadinessForRun({
      runId: run.id,
      operatorApproval: deployReadinessApproval,
      decision: "ready",
    });
    const commitCountAfter = Number(
      execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repoRoot }).toString().trim(),
    );
    expect(commitCountAfter).toBe(commitCountBefore);
    expect(getRunById(run.id)?.status).not.toBe("completed");
    const mergeAfterReadiness = ghMergeCalls.filter((args) => args[1] === "merge");
    expect(mergeAfterReadiness.length).toBe(1);
  });

  it("bridge summary includes latest deploy readiness", async () => {
    const { run } = await seedWithMergedPr();
    await recordDeployReadinessForRun({
      runId: run.id,
      operatorApproval: deployReadinessApproval,
      decision: "blocked",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestDeployReadiness.deployReadinessStatus).toBe("deploy_readiness_recorded");
    expect(bridge?.deployReadinessDecision).toBe("blocked");
    expect(bridge?.latestDeployReadiness.notDeployed).toBe(true);
  });

  it("Hermes consumer cannot record deploy readiness", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/deploy-readiness|recordDeployReadiness/);
  });

  it("VeraLux OS cannot record deploy readiness via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(/deploy-readiness|recordDeployReadiness/);
  });
});
