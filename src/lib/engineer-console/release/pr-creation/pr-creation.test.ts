import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { buildApprovalReport } from "../../approval/approval-report";
import {
  createRun,
  saveApprovalReport,
  saveQualityGateResults,
  updateRun,
} from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../../governance/governance-engine";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../../governance/audit-ledger/audit-ledger-manager";
import { createDecisionRecord } from "../../governance/decision-records/decision-record-manager";
import { refreshRunEvidenceBundle } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { runPolicyEvaluation } from "../../governance/policy-results/policy-result-manager";
import { runReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "../../governance/review-stages/review-stage-manager";
import { buildPrBody, prBodyExcludesSensitiveContent } from "./build-pr-body";
import { buildCommitMessage } from "./build-commit-message";
import {
  getControlledGitExecutor,
  setControlledGitExecutorForTests,
  type ControlledGitExecutor,
} from "./controlled-git-executor";
import { createControlledGitCommit } from "./create-git-commit";
import { evaluatePrReadiness } from "./evaluate-pr-readiness";
import { PrCreationError } from "./pr-creation-types";
import {
  createPrRequest,
  listPrRequestsForRun,
} from "./pr-request-manager";

let tmpDb: string;
const gitCalls: Array<{ bin: "git" | "gh"; args: string[] }> = [];
let headCommitSha = "abc123def456789";
let remoteBranchSha: string | null = null;
let listedPrs: Array<{ number: number; url: string }> = [];
let failPush = false;
let failPrCreate = false;
let commitCounter = 0;

const mockExecutor: ControlledGitExecutor = {
  git: vi.fn(async (args: string[]) => {
    gitCalls.push({ bin: "git", args });
    if (args[0] === "status" && args[1] === "--porcelain") {
      return { stdout: " M src/a.ts", stderr: "" };
    }
    if (args[0] === "branch" && args[1] === "--show-current") {
      return { stdout: "engineer/test-branch", stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: headCommitSha, stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "--verify") {
      if (remoteBranchSha) {
        return { stdout: remoteBranchSha, stderr: "" };
      }
      throw new Error("missing ref");
    }
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      if (args[2] === headCommitSha) {
        return { stdout: "", stderr: "" };
      }
      throw new Error("not ancestor");
    }
    if (args[0] === "commit") {
      commitCounter += 1;
      headCommitSha = `abc123def45678${commitCounter}`;
      return { stdout: "", stderr: "" };
    }
    if (args[0] === "push") {
      if (failPush) {
        throw new Error("push failed");
      }
      remoteBranchSha = headCommitSha;
      return { stdout: "", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }),
  gh: vi.fn(async (args: string[]) => {
    gitCalls.push({ bin: "gh", args });
    if (args[0] === "pr" && args[1] === "list") {
      return { stdout: JSON.stringify(listedPrs), stderr: "" };
    }
    if (failPrCreate) {
      throw new Error("gh pr create failed");
    }
    return { stdout: "https://github.com/org/repo/pull/42", stderr: "" };
  }),
};

vi.mock("../../workspace/git-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../workspace/git-workspace")>();
  return {
    ...actual,
    getChangedFiles: vi.fn().mockResolvedValue(["src/a.ts"]),
    verifyGitRepo: vi.fn().mockResolvedValue(undefined),
    checkoutBranch: vi.fn().mockResolvedValue(undefined),
  };
});

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-pr-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "pr-creation-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  gitCalls.length = 0;
  headCommitSha = "abc123def456789";
  remoteBranchSha = null;
  listedPrs = [];
  failPush = false;
  failPrCreate = false;
  commitCounter = 0;
  setControlledGitExecutorForTests(mockExecutor);
  vi.mocked(mockExecutor.git).mockClear();
  vi.mocked(mockExecutor.gh).mockClear();
});

afterEach(() => {
  setControlledGitExecutorForTests(null);
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

async function seedApprovedRun(
  changedFiles = ["src/a.ts"],
  options: { approveReviewStages?: boolean } = {},
) {
  const approveReviewStages = options.approveReviewStages !== false;
  const governance = assessChangedFiles(changedFiles);
  const task = createTask({ title: "PR task", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  updateRun(run.id, {
    status: "completed",
    branchName: "engineer/test-branch",
    riskLevel: governance.riskLevel,
    governanceNotes: JSON.stringify(governance),
    completedAt: new Date().toISOString(),
  });
  saveQualityGateResults(run.id, [
    {
      id: "g1",
      runId: run.id,
      command: "npm test",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      status: "passed",
      createdAt: new Date().toISOString(),
    },
  ]);
  const report = buildApprovalReport({
    task,
    run: { ...run, status: "completed", branchName: "engineer/test-branch" },
    changedFiles,
    diffSummary: "1 file",
    governance,
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  reconcileReviewStagesForRun(run.id, { audit: false });
  await refreshRunEvidenceBundle({ runId: run.id, changedFiles });
  await runReplayVerification(run.id, { persist: true, audit: false });
  if (approveReviewStages) {
    for (const stage of listReviewStagesForRun(run.id).filter((s) => s.required)) {
      completeReviewStageAction({
        stageId: stage.id,
        action: "approve",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "reviewer",
      });
    }
  }
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  createDecisionRecord({
    runId: run.id,
    decision: "approved",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "operator",
    rationale: "approved for release",
  });
  return { task, run };
}

describe("PR creation", () => {
  it("blocks readiness when run not approved", async () => {
    const governance = assessChangedFiles(["src/a.ts"]);
    const task = createTask({ title: "t", targetRepoPath: "/tmp/repo" });
    const run = createRun(task.id);
    updateRun(run.id, {
      status: "waiting_for_approval",
      branchName: "engineer/test-branch",
      governanceNotes: JSON.stringify(governance),
    });
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("approved human decision"))).toBe(true);
  });

  it("blocks readiness without evidence bundle", async () => {
    const task = createTask({ title: "t", targetRepoPath: "/tmp/repo" });
    const run = createRun(task.id);
    updateRun(run.id, { status: "completed", branchName: "engineer/test-branch" });
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("Evidence bundle"))).toBe(true);
  });

  it("blocks readiness on blocked policy", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    saveQualityGateResults(run.id, [
      {
        id: "g2",
        runId: run.id,
        command: "npm test",
        stdout: "",
        stderr: "fail",
        exitCode: 1,
        durationMs: 10,
        status: "failed",
        createdAt: new Date().toISOString(),
      },
    ]);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.toLowerCase().includes("policy") || b.includes("quality"))).toBe(
      true,
    );
  });

  it("blocks readiness on pending required review stage", async () => {
    const { run } = await seedApprovedRun(["package-lock.json"], { approveReviewStages: false });
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("review stage"))).toBe(true);
  });

  it("blocks readiness with no changed files", async () => {
    const { getChangedFiles } = await import("../../workspace/git-workspace");
    const { run } = await seedApprovedRun(["src/a.ts"]);
    vi.mocked(getChangedFiles).mockResolvedValue([]);
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.blockers.some((b) => b.includes("No changed files"))).toBe(true);
    vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);
  });

  it("passes readiness after approval, evidence, policy, reviews, and replay", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.blockers.length).toBe(0);
    expect(["passed", "requires_review"]).toContain(readiness.status);
  });

  it("commit refuses protected files", async () => {
    const { getChangedFiles } = await import("../../workspace/git-workspace");
    vi.mocked(getChangedFiles).mockResolvedValueOnce([".env"]);
    await expect(createControlledGitCommit("/tmp/repo", "run-id")).rejects.toThrow(PrCreationError);
  });

  it("commit uses controlled git args only", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    await createControlledGitCommit("/tmp/repo", run.id);
    const addCall = gitCalls.find((c) => c.bin === "git" && c.args[0] === "add");
    expect(addCall).toBeTruthy();
    expect(addCall!.args).not.toContain("-A");
    const commitCall = gitCalls.find((c) => c.bin === "git" && c.args[0] === "commit");
    expect(commitCall?.args).toEqual(["commit", "-m", expect.stringContaining("VeraLux Engineering Console")]);
  });

  it("PR body excludes raw prompt, model output, logs, and secrets", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    const body = buildPrBody({ runId: run.id, rationale: "ship it" });
    expect(body).toContain("VeraLux Engineering Console");
    expect(body).not.toMatch(/rawResponse|promptHash|stdout|stderr/i);
    expect(prBodyExcludesSensitiveContent(body)).toBe(true);
  });

  it("persists PR request status and history", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    const record = await createPrRequest({
      runId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      draft: true,
      rationale: "Ready to open PR",
    });
    expect(record.status).toBe("pr_created");
    expect(record.prUrl).toContain("github.com");
    const history = listPrRequestsForRun(run.id);
    expect(history.length).toBe(1);
    expect(history[0]!.commitSha).toBeTruthy();
  });

  it("reuses the existing commit after a push failure and does not create a duplicate commit", async () => {
    const { getChangedFiles } = await import("../../workspace/git-workspace");
    const { run } = await seedApprovedRun(["README.md"]);
    failPush = true;

    await expect(
      createPrRequest({
        runId: run.id,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "operator",
        draft: true,
        rationale: "open draft PR",
      }),
    ).rejects.toThrow(/push failed/i);

    const failedAttempt = listPrRequestsForRun(run.id)[0]!;
    expect(failedAttempt.status).toBe("failed");
    expect(failedAttempt.commitSha).toBeTruthy();

    failPush = false;
    vi.mocked(getChangedFiles).mockResolvedValue([]);
    const retried = await createPrRequest({
      runId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      draft: true,
      rationale: "retry PR creation",
    });

    const commitCalls = gitCalls.filter((c) => c.bin === "git" && c.args[0] === "commit");
    expect(commitCalls).toHaveLength(1);
    expect(retried.status).toBe("pr_created");
    expect(retried.commitSha).toBe(failedAttempt.commitSha);
    expect(listPrRequestsForRun(run.id)).toHaveLength(1);
    vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);
  });

  it("skips redundant push when the run branch is already on origin", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    failPrCreate = true;

    await expect(
      createPrRequest({
        runId: run.id,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "operator",
        rationale: "seed pushed branch",
      }),
    ).rejects.toThrow(/gh pr create failed/i);

    failPrCreate = false;
    gitCalls.length = 0;

    const record = await createPrRequest({
      runId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      rationale: "branch already pushed",
    });

    expect(record.status).toBe("pr_created");
    expect(gitCalls.some((c) => c.bin === "git" && c.args[0] === "push")).toBe(false);
  });

  it("records an existing PR instead of creating a duplicate", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    failPrCreate = true;

    await expect(
      createPrRequest({
        runId: run.id,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "operator",
        rationale: "seed pushed branch",
      }),
    ).rejects.toThrow(/gh pr create failed/i);

    failPrCreate = false;
    listedPrs = [{ number: 77, url: "https://github.com/org/repo/pull/77" }];
    gitCalls.length = 0;

    const record = await createPrRequest({
      runId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      rationale: "reuse existing PR",
    });

    expect(record.status).toBe("pr_created");
    expect(record.prUrl).toBe("https://github.com/org/repo/pull/77");
    expect(gitCalls.some((c) => c.bin === "gh" && c.args[0] === "pr" && c.args[1] === "create")).toBe(false);
  });

  it("fails clean-tree retries clearly when no prior commit is recorded", async () => {
    const { getChangedFiles } = await import("../../workspace/git-workspace");
    const { run } = await seedApprovedRun(["src/a.ts"]);
    vi.mocked(getChangedFiles).mockResolvedValue([]);

    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.blockers.some((b) => b.includes("no reusable run commit"))).toBe(true);

    await expect(
      createPrRequest({
        runId: run.id,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "operator",
      }),
    ).rejects.toThrow(/no reusable run commit/i);

    vi.mocked(getChangedFiles).mockResolvedValue(["src/a.ts"]);
  });

  it("emits audit events for readiness, commit, and PR", async () => {
    const { run } = await seedApprovedRun(["src/a.ts"]);
    await evaluatePrReadiness(run.id);
    await createPrRequest({
      runId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      rationale: "Ready to open PR",
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.PR_READINESS_EVALUATED);
    expect(types).toContain(AUDIT_EVENT_TYPES.COMMIT_CREATED);
    expect(types).toContain(AUDIT_EVENT_TYPES.PR_CREATED);
  });

  it("emits audit events when retry reuses commit, remote branch, and existing PR state", async () => {
    const { run } = await seedApprovedRun(["README.md"]);
    failPush = true;

    await expect(
      createPrRequest({
        runId: run.id,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "operator",
        rationale: "first attempt",
      }),
    ).rejects.toThrow(/push failed/i);

    failPush = false;
    remoteBranchSha = headCommitSha;
    listedPrs = [{ number: 88, url: "https://github.com/org/repo/pull/88" }];

    await createPrRequest({
      runId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      rationale: "retry",
    });

    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.PR_CREATION_RESUMED);
    expect(types).toContain(AUDIT_EVENT_TYPES.PR_EXISTING_COMMIT_REUSED);
    expect(types).toContain(AUDIT_EVENT_TYPES.PR_EXISTING_REMOTE_BRANCH_REUSED);
    expect(types).toContain(AUDIT_EVENT_TYPES.PR_EXISTING_PR_DETECTED);
  });

  it("create PR route logic blocks when readiness blocked", async () => {
    const task = createTask({ title: "t", targetRepoPath: "/tmp/repo" });
    const run = createRun(task.id);
    updateRun(run.id, { status: "waiting_for_approval", branchName: "engineer/b" });
    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.status).toBe("blocked");
    await expect(
      createPrRequest({
        runId: run.id,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "operator",
      }),
    ).rejects.toThrow(/blocked/i);
  });

  it("rejects disallowed git commands", async () => {
    setControlledGitExecutorForTests(null);
    await expect(getControlledGitExecutor().git(["clean", "-fd"], "/tmp/repo")).rejects.toThrow(
      /not allowed/i,
    );
    setControlledGitExecutorForTests(mockExecutor);
  });

  it("buildCommitMessage includes run id suffix and product name", () => {
    const task = createTask({ title: "Fix bug", targetRepoPath: "/tmp/repo" });
    const run = createRun(task.id);
    updateRun(run.id, { branchName: "engineer/b" });
    const message = buildCommitMessage(run.id);
    expect(message).toContain("Fix bug");
    expect(message).toContain("VeraLux Engineering Console");
    expect(message).toMatch(/\[run:/);
  });
});
