import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  closeEngineerConsoleDb,
  getEngineerConsoleDb,
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
import { authorizeMutation } from "../../security/route-guards";
import { createOperatorAccount } from "../../security/operator-account-manager";
import { hashPassword } from "../../security/password-hashing";
import { createOperatorSession } from "../../security/session-manager";
import { CSRF_HEADER_NAME } from "../../security/csrf";
import { NextResponse } from "next/server";
import {
  runGhMerge,
  setControlledGhMergeExecutorForTests,
  type ControlledGhMergeExecutor,
} from "./controlled-gh-merge";
import { evaluateMergeReadiness } from "./evaluate-merge-readiness";
import { MergeControlError } from "./merge-control-types";
import {
  createMergeRequest,
  listMergeRequestsForRun,
} from "./merge-request-manager";

let tmpDb: string;
const ghCalls: string[][] = [];
let mergePerformed = false;

const mockGhExecutor: ControlledGhMergeExecutor = {
  gh: vi.fn(async (args: string[]) => {
    ghCalls.push([...args]);
    if (args[1] === "merge") {
      mergePerformed = true;
      return { stdout: "", stderr: "" };
    }
    if (args[1] === "view") {
      return {
        stdout: JSON.stringify({
          state: mergePerformed ? "MERGED" : "OPEN",
          merged: mergePerformed,
          url: "https://github.com/org/repo/pull/99",
          headRefName: "engineer/test-branch",
          baseRefName: "main",
          headRefOid: "abc123def456789",
          mergeCommit: mergePerformed ? { oid: "merge999abc" } : null,
        }),
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  }),
};

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-merge-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "merge-controls-test";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_SESSION_SECRET = "merge-test-secret";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  ghCalls.length = 0;
  mergePerformed = false;
  setControlledGhMergeExecutorForTests(mockGhExecutor);
  vi.mocked(mockGhExecutor.gh).mockClear();
});

afterEach(() => {
  setControlledGhMergeExecutorForTests(null);
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_SESSION_SECRET;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
});

async function seedApprovedRun(options: { approveReviewStages?: boolean } = {}) {
  const approveReviewStages = options.approveReviewStages !== false;
  const changedFiles = ["src/a.ts"];
  const governance = assessChangedFiles(changedFiles);
  const task = createTask({ title: "Merge task", targetRepoPath: "/tmp/repo" });
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
    actorLabel: "admin@example.com",
    rationale: "approved for merge",
  });
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  return { task, run };
}

function ensureReplayStatusPassed(runId: string): void {
  const latest = getEngineerConsoleDb()
    .prepare(
      `SELECT id, result_json FROM engineer_replay_verifications WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as { id: string; result_json: string } | undefined;
  if (!latest) return;
  const parsed = JSON.parse(latest.result_json) as { status?: string };
  if (parsed.status === "passed") return;
  parsed.status = "passed";
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_replay_verifications SET status = 'passed', result_json = @json WHERE id = @id`,
    )
    .run({ id: latest.id, json: JSON.stringify(parsed) });
}

function insertPrRequest(
  runId: string,
  taskId: string,
  registeredRepoId: string | null,
  branchName: string,
): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_pr_requests
        (id, run_id, task_id, registered_repo_id, branch_name, base_branch,
         status, readiness_status, readiness_json, pr_url, pr_number, commit_sha,
         actor_type, actor_label, created_at, updated_at)
       VALUES
        (@id, @run_id, @task_id, @registered_repo_id, @branch_name, @base_branch,
         @status, @readiness_status, @readiness_json, @pr_url, @pr_number, @commit_sha,
         @actor_type, @actor_label, @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: runId,
      task_id: taskId,
      registered_repo_id: registeredRepoId,
      branch_name: branchName,
      base_branch: "main",
      status: "pr_created",
      readiness_status: "passed",
      readiness_json: "{}",
      pr_url: "https://github.com/org/repo/pull/99",
      pr_number: "99",
      commit_sha: "abc123def456789",
      actor_type: AUDIT_ACTOR_TYPES.HUMAN,
      actor_label: "admin",
      created_at: now,
      updated_at: now,
    });
  return id;
}

function mutationRequest(cookie: string, csrf: string): Request {
  return new Request("http://localhost/api/engineer-console/runs/x/merge-requests", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      cookie,
      [CSRF_HEADER_NAME]: csrf,
    },
  });
}

describe("merge readiness", () => {
  it("blocks when no PR exists", async () => {
    const { run } = await seedApprovedRun();
    const readiness = await evaluateMergeReadiness(run.id, null, { inspectGithub: false });
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("PR request"))).toBe(true);
  });

  it("blocks when run not approved", async () => {
    const task = createTask({ title: "t", targetRepoPath: "/tmp/repo" });
    const run = createRun(task.id);
    updateRun(run.id, { status: "waiting_for_approval", branchName: "engineer/test-branch" });
    const prId = insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    const readiness = await evaluateMergeReadiness(run.id, prId, { inspectGithub: false });
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("approved human decision"))).toBe(true);
  });

  it("blocks when policy blocked", async () => {
    const { run, task } = await seedApprovedRun();
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    saveQualityGateResults(run.id, [
      {
        id: "g-fail",
        runId: run.id,
        command: "npm test",
        stdout: "",
        stderr: "x",
        exitCode: 1,
        durationMs: 1,
        status: "failed",
        createdAt: new Date().toISOString(),
      },
    ]);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const readiness = await evaluateMergeReadiness(run.id, prId, { inspectGithub: false });
    expect(readiness.status).toBe("blocked");
    expect(
      readiness.blockers.some(
        (b) => b.toLowerCase().includes("policy") || b.includes("quality"),
      ),
    ).toBe(true);
  });

  it("blocks when replay missing or failing", async () => {
    const changedFiles = ["src/a.ts"];
    const governance = assessChangedFiles(changedFiles);
    const task = createTask({ title: "t", targetRepoPath: "/tmp/repo" });
    const run = createRun(task.id);
    updateRun(run.id, {
      status: "completed",
      branchName: "engineer/test-branch",
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
        durationMs: 1,
        status: "passed",
        createdAt: new Date().toISOString(),
      },
    ]);
    const report = buildApprovalReport({
      task,
      run: { ...run, status: "completed", branchName: "engineer/test-branch" },
      changedFiles,
      diffSummary: "1",
      governance,
      qualityGateResults: [],
    });
    saveApprovalReport(run.id, JSON.stringify(report));
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    reconcileReviewStagesForRun(run.id, { audit: false });
    await refreshRunEvidenceBundle({ runId: run.id, changedFiles });
    for (const stage of listReviewStagesForRun(run.id).filter((s) => s.required)) {
      completeReviewStageAction({
        stageId: stage.id,
        action: "approve",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "reviewer",
      });
    }
    createDecisionRecord({
      runId: run.id,
      decision: "approved",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin",
      rationale: "ok",
    });
    const prId = insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    const readiness = await evaluateMergeReadiness(run.id, prId, { inspectGithub: false });
    expect(readiness.blockers.some((b) => b.includes("Replay"))).toBe(true);
  });

  it("blocks when required review stage pending", async () => {
    const { run, task } = await seedApprovedRun({ approveReviewStages: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    const readiness = await evaluateMergeReadiness(run.id, prId, { inspectGithub: false });
    expect(readiness.blockers.some((b) => b.includes("review stage"))).toBe(true);
  });

  it("passes with approved run, PR, evidence, policy, replay, and reviews", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    const readiness = await evaluateMergeReadiness(run.id, prId, { inspectGithub: false });
    expect(readiness.status).toBe("passed");
    expect(readiness.blockers).toHaveLength(0);
  });
});

describe("merge authorization and execution", () => {
  it("rejects operator role for admin-only mutation", async () => {
    const hash = await hashPassword("pass");
    const account = createOperatorAccount({
      email: "op@example.com",
      displayName: "Op",
      passwordHash: hash,
      role: "operator",
    });
    const session = createOperatorSession(account.id);
    const req = mutationRequest(
      `ec_session=${encodeURIComponent(session.sessionToken)}`,
      session.csrfToken,
    );
    const result = await authorizeMutation(req, { minRole: "admin" });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("allows admin mutation with valid session", async () => {
    const hash = await hashPassword("pass");
    const account = createOperatorAccount({
      email: "admin@example.com",
      displayName: "Admin",
      passwordHash: hash,
      role: "admin",
    });
    const session = createOperatorSession(account.id);
    const req = mutationRequest(
      `ec_session=${encodeURIComponent(session.sessionToken)}`,
      session.csrfToken,
    );
    const result = await authorizeMutation(req, { minRole: "admin" });
    expect(result).not.toBeInstanceOf(NextResponse);
  });

  it("blocked readiness prevents merge command execution", async () => {
    const { run, task } = await seedApprovedRun({ approveReviewStages: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    const mergeCallsBefore = ghCalls.filter((a) => a[1] === "merge").length;
    await expect(
      createMergeRequest({
        runId: run.id,
        prRequestId: prId,
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin@example.com",
      }),
    ).rejects.toThrow(MergeControlError);
    const mergeCallsAfter = ghCalls.filter((a) => a[1] === "merge").length;
    expect(mergeCallsAfter).toBe(mergeCallsBefore);
    expect(listMergeRequestsForRun(run.id)).toHaveLength(0);
  });

  it("admin can merge when ready using controlled gh args", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    const record = await createMergeRequest({
      runId: run.id,
      prRequestId: prId,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
      mergeMethod: "squash",
    });
    expect(record.status).toBe("merged");
    expect(record.mergeSha).toBeTruthy();
    const mergeCall = ghCalls.find((a) => a[1] === "merge");
    expect(mergeCall).toEqual(["pr", "merge", "99", "--squash", "--delete-branch=false"]);
    expect(mergeCall?.join(" ")).not.toMatch(/[;|&`]/);
  });

  it("persists merge attempt history", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    await createMergeRequest({
      runId: run.id,
      prRequestId: prId,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const history = listMergeRequestsForRun(run.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]!.status).toBe("merged");
  });

  it("emits merge audit lifecycle events", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    await createMergeRequest({
      runId: run.id,
      prRequestId: prId,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.MERGE_READINESS_EVALUATED);
    expect(types).toContain(AUDIT_EVENT_TYPES.MERGE_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.MERGE_COMPLETED);
  });

  it("rejects disallowed gh command shapes", async () => {
    setControlledGhMergeExecutorForTests(null);
    await expect(
      runGhMerge(["pr", "create", "99", "--title", "x"], "/tmp/repo"),
    ).rejects.toThrow(MergeControlError);
    setControlledGhMergeExecutorForTests(mockGhExecutor);
  });

  it("public merge record shape excludes command logs", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    const record = await createMergeRequest({
      runId: run.id,
      prRequestId: prId,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const json = JSON.stringify(record);
    expect(json).not.toContain("gh pr merge");
    expect(json).not.toMatch(/stderr|stdout/i);
  });
});
