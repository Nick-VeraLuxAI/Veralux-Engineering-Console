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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA } from "./governed-pr-merge-types";

const MERGE_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/merge-governed-pull-request.ts",
  ),
  "utf8",
);
const GH_MERGE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/engineer-console/release/merge-controls/controlled-gh-merge.ts"),
  "utf8",
);

describe("Governed pull request merge phase 15", () => {
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
        return { stdout: "https://github.com/test-org/p15-test/pull/55\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  const mockGhMergeExecutor: ControlledGhMergeExecutor = {
    gh: vi.fn(async (args: string[], _repoPath: string) => {
      ghMergeCalls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        const candidate = getLatestCommitCandidateForRun(
          (globalThis as { __p15RunId?: string }).__p15RunId ?? "",
        );
        const headOid = candidate?.localCommitHash ?? localCommitHash;
        return {
          stdout: JSON.stringify({
            state: prMerged ? "MERGED" : "OPEN",
            merged: prMerged,
            url: "https://github.com/test-org/p15-test/pull/55",
            headRefName: candidate?.remoteBranchName ?? "engineering/p15-test",
            baseRefName: "main",
            headRefOid: headOid,
            mergeCommit: prMerged ? { oid: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" } : null,
          }),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "merge") {
        prMerged = true;
        return { stdout: "Merged pull request #55\n", stderr: "" };
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

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-merge-p15-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-merge-p15-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p15-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `governed-merge-p15-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-merge-p15-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    delete (globalThis as { __p15RunId?: string }).__p15RunId;
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

  async function seedWithMergeReadinessReady() {
    const task = createTask({
      title: "Governed PR merge P15",
      description: "Phase 15",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p15RunId?: string }).__p15RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p15 doc",
      allowedFiles: ["docs/p15.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p15.md",
          content: "# p15\n",
          reason: "phase15",
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
      "--- a/docs/p15.md\n+++ b/docs/p15.md\n@@ -0,0 +1,2 @@\n+# p15\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p15.md", changeType: "add", reason: "phase15", allowedByPolicy: true }],
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
      reason: "Ready for merge",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p15 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    localCommitHash = getLatestCommitCandidateForRun(run.id)?.localCommitHash ?? "";

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p15-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p15-test.git"],
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

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const mergeApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Approve governed PR merge",
  };

  it("uses bounded gh merge helper without shell or forbidden flags", () => {
    expect(GH_MERGE_SOURCE).toContain("execFile");
    expect(GH_MERGE_SOURCE).not.toContain("shell: true");
    expect(GH_MERGE_SOURCE).toContain("--delete-branch=false");
    expect(GH_MERGE_SOURCE).toContain('a === "--auto"');
    expect(MERGE_SOURCE).toContain("mergeGithubPr");
    expect(MERGE_SOURCE).not.toContain("executeDeployment");
    expect(MERGE_SOURCE).not.toMatch(/\bcompleteRun\b/);
    expect(MERGE_SOURCE).not.toContain("git push");
  });

  it("cannot merge without PR", async () => {
    const task = createTask({ title: "No PR", description: "x", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    await expect(
      mergeGovernedPullRequestForRun({ runId: run.id, operatorApproval: mergeApproval }),
    ).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("cannot merge without merge readiness ready", async () => {
    const { run, dispatch } = await seedWithMergeReadyPartial();
    void dispatch;
    await expect(
      mergeGovernedPullRequestForRun({ runId: run.id, operatorApproval: mergeApproval }),
    ).rejects.toMatchObject({ code: "MERGE_READINESS_REQUIRED" });
  });

  it("cannot merge without approved sign-off", async () => {
    const { run } = await seedWithMergeReadinessReady();
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "rejected",
      reviewer: "lead",
      reason: "no",
    });
    await expect(
      mergeGovernedPullRequestForRun({ runId: run.id, operatorApproval: mergeApproval }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
  });

  it("cannot merge after rollback", async () => {
    const { run, dispatch } = await seedWithMergeReadinessReady();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      mergeGovernedPullRequestForRun({ runId: run.id, operatorApproval: mergeApproval }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithMergeReadinessReady();
    await expect(
      mergeGovernedPullRequestForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      mergeGovernedPullRequestForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("validates merge method", async () => {
    const { run } = await seedWithMergeReadinessReady();
    await expect(
      mergeGovernedPullRequestForRun({
        runId: run.id,
        operatorApproval: mergeApproval,
        mergeMethod: "fast-forward" as "squash",
      }),
    ).rejects.toMatchObject({ code: "INVALID_MERGE_METHOD" });
  });

  it("merges PR via bounded gh and records evidence", async () => {
    const { run } = await seedWithMergeReadinessReady();
    const result = await mergeGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: mergeApproval,
      mergeMethod: "squash",
    });

    expect(result.status).toBe("pull_request_merged");
    expect(result.pullRequestNumber).toBe(55);
    expect(result.notDeployed).toBe(true);
    expect(result.notComplete).toBe(true);
    expect(fs.existsSync(result.mergeEvidencePath)).toBe(true);

    const evidence = JSON.parse(fs.readFileSync(result.mergeEvidencePath, "utf8")) as {
      schema: string;
      mergeMethod: string;
      notDeployed: boolean;
      notComplete: boolean;
    };
    expect(evidence.schema).toBe(ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA);
    expect(evidence.mergeMethod).toBe("squash");
    expect(evidence.notDeployed).toBe(true);
    expect(evidence.notComplete).toBe(true);

    const mergeCall = ghMergeCalls.find((args) => args[1] === "merge");
    expect(mergeCall).toBeDefined();
    expect(mergeCall).toContain("--squash");
    expect(mergeCall).toContain("--delete-branch=false");
    expect(mergeCall?.some((arg) => arg === "--auto")).toBe(false);
    expect(mergeCall?.some((arg) => arg.includes("delete-branch") && arg !== "--delete-branch=false")).toBe(false);

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("pull_request_merged");
    expect(record?.notMerged).toBe(false);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("does not deploy, complete, delete branch, or enable auto-merge", async () => {
    const { run } = await seedWithMergeReadinessReady();
    await mergeGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: mergeApproval,
    });
    expect(getRunById(run.id)?.status).not.toBe("completed");
    const deleteBranchCall = ghMergeCalls.find((args) =>
      args.some((a) => a === "--delete-branch" || a === "--delete-branch=true"),
    );
    expect(deleteBranchCall).toBeUndefined();
    const autoCall = ghMergeCalls.find((args) => args.includes("--auto"));
    expect(autoCall).toBeUndefined();
  });

  it("bridge summary includes pull request merge", async () => {
    const { run } = await seedWithMergeReadinessReady();
    await mergeGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: mergeApproval,
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestPullRequestMerge.mergeStatus).toBe("pull_request_merged");
    expect(bridge?.mergeMethod).toBe("squash");
    expect(bridge?.latestPullRequestMerge.notDeployed).toBe(true);
  });

  it("Hermes consumer cannot merge governed PR", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/merge-pr|mergeGovernedPullRequest/);
  });

  it("VeraLux OS cannot merge governed PR via bridge", () => {
    const bridgeClient = path.join(
      process.cwd(),
      "../Veralux-System/src/services/engineering-console/engineering-console-bridge-client.ts",
    );
    if (!fs.existsSync(bridgeClient)) return;
    const source = fs.readFileSync(bridgeClient, "utf8");
    expect(source).not.toMatch(/merge-pr|mergeGovernedPullRequest/);
  });

  async function seedWithMergeReadyPartial() {
    const task = createTask({
      title: "Partial P15",
      description: "Phase 15 partial",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    (globalThis as { __p15RunId?: string }).__p15RunId = run.id;

    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p15 doc",
      allowedFiles: ["docs/p15.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p15.md",
          content: "# p15\n",
          reason: "phase15",
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
      "--- a/docs/p15.md\n+++ b/docs/p15.md\n@@ -0,0 +1,2 @@\n+# p15\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p15.md", changeType: "add", reason: "phase15", allowedByPolicy: true }],
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
      reason: "Ready",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p15 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p15-test.git"],
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
      ["remote", "set-url", "origin", "https://github.com/test-org/p15-test.git"],
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

    return { run, dispatch };
  }
});
