import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";
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
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import {
  getLatestPolicyResult,
  parsePolicyEvaluationResult,
  runPolicyEvaluation,
} from "../../governance/policy-results/policy-result-manager";
import { runReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "../../governance/review-stages/review-stage-manager";
import { buildRunEvidenceBundle } from "../../governance/evidence-bundles/build-run-evidence-bundle";
import { authorizeMutation } from "../../security/route-guards";
import { resolveHumanActor } from "../../security/actor-identity";
import type { AuthenticatedOperator } from "../../security/security-types";
import { createOperatorAccount } from "../../security/operator-account-manager";
import { hashPassword } from "../../security/password-hashing";
import { createOperatorSession } from "../../security/session-manager";
import { CSRF_HEADER_NAME } from "../../security/csrf";
import { listDeploymentEnvironments } from "./deployment-environments";
import { evaluateDeploymentReadiness } from "./evaluate-deployment-readiness";
import {
  createDeploymentApproval,
  createDeploymentReadinessCheck,
  listDeploymentApprovalsForRun,
  summarizeDeploymentGatesForRun,
  toPublicDeploymentReadinessCheck,
} from "./deployment-gate-manager";
import { DeploymentGateError } from "./deployment-gate-types";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-deploy-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "deployment-gates-test";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_SESSION_SECRET = "deploy-test-secret";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
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
  const task = createTask({ title: "Deploy task", targetRepoPath: "/tmp/repo" });
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
    rationale: "approved for deploy readiness",
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

function insertMergedMergeRequest(
  runId: string,
  prRequestId: string,
  taskId: string,
  registeredRepoId: string | null,
  options?: { mergeSha?: string | null },
): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_merge_requests
        (id, run_id, pr_request_id, task_id, registered_repo_id,
         pr_url, pr_number, base_branch, head_branch, commit_sha, merge_sha,
         status, readiness_status, readiness_json,
         evidence_bundle_id, evidence_bundle_hash, policy_result_id, replay_verification_id,
         actor_type, actor_label, rationale, created_at, updated_at, completed_at)
       VALUES
        (@id, @run_id, @pr_request_id, @task_id, @registered_repo_id,
         @pr_url, @pr_number, @base_branch, @head_branch, @commit_sha, @merge_sha,
         @status, @readiness_status, @readiness_json,
         @evidence_bundle_id, @evidence_bundle_hash, @policy_result_id, @replay_verification_id,
         @actor_type, @actor_label, @rationale, @created_at, @updated_at, @completed_at)`,
    )
    .run({
      id,
      run_id: runId,
      pr_request_id: prRequestId,
      task_id: taskId,
      registered_repo_id: registeredRepoId,
      pr_url: "https://github.com/org/repo/pull/99",
      pr_number: "99",
      base_branch: "main",
      head_branch: "engineer/test-branch",
      commit_sha: "abc123def456789",
      merge_sha: options?.mergeSha === undefined ? "merge999abc123456" : options.mergeSha,
      status: "merged",
      readiness_status: "passed",
      readiness_json: "{}",
      evidence_bundle_id: null,
      evidence_bundle_hash: null,
      policy_result_id: null,
      replay_verification_id: null,
      actor_type: AUDIT_ACTOR_TYPES.HUMAN,
      actor_label: "admin",
      rationale: null,
      created_at: now,
      updated_at: now,
      completed_at: now,
    });
  return id;
}

function seedDeployReadyRun() {
  return seedApprovedRun().then(async ({ run, task }) => {
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    insertMergedMergeRequest(run.id, prId, task.id, task.registeredRepoId);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    return { run, task, prId, staging };
  });
}

function adminApprovalRequest(cookie: string, csrf: string): Request {
  return new Request("http://localhost/api/engineer-console/runs/x/deployment-approval", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      cookie,
      [CSRF_HEADER_NAME]: csrf,
    },
  });
}

describe("deployment readiness evaluation", () => {
  it("blocks when PR not merged", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("merged merge request"))).toBe(true);
  });

  it("blocks without evidence bundle", async () => {
    const { run } = await seedDeployReadyRun();
    getEngineerConsoleDb()
      .prepare(`DELETE FROM engineer_run_evidence_bundles WHERE run_id = ?`)
      .run(run.id);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("Evidence bundle"))).toBe(true);
  });

  it("blocks on blocked policy", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    const prId = insertPrRequest(
      run.id,
      task.id,
      task.registeredRepoId,
      run.branchName ?? "engineer/test-branch",
    );
    insertMergedMergeRequest(run.id, prId, task.id, task.registeredRepoId);
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
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.status).toBe("blocked");
    expect(
      readiness.blockers.some(
        (b) => b.toLowerCase().includes("policy") || b.includes("quality"),
      ),
    ).toBe(true);
  });

  it("blocks on missing or failing replay verification", async () => {
    const { run, task } = await seedApprovedRun({ approveReviewStages: true });
    const prId = insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    insertMergedMergeRequest(run.id, prId, task.id, null);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("Replay"))).toBe(true);
  });

  it("blocks on pending or rejected review stage", async () => {
    const { run, task } = await seedApprovedRun({ approveReviewStages: false });
    ensureReplayStatusPassed(run.id);
    const prId = insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    insertMergedMergeRequest(run.id, prId, task.id, null);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("review stage"))).toBe(true);
  });

  it("blocks when run is not approved", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    const prId = insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    insertMergedMergeRequest(run.id, prId, task.id, null);
    getEngineerConsoleDb()
      .prepare(`DELETE FROM engineer_decision_records WHERE run_id = ?`)
      .run(run.id);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("approved human decision"))).toBe(true);
  });

  it("blocks when PR does not exist", async () => {
    const { run } = await seedDeployReadyRun();
    getEngineerConsoleDb().prepare(`DELETE FROM engineer_pr_requests WHERE run_id = ?`).run(run.id);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("pull request"))).toBe(true);
  });

  it("blocks when merge SHA is missing", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const prId = insertPrRequest(run.id, task.id, null, "engineer/test-branch");
    insertMergedMergeRequest(run.id, prId, task.id, null, { mergeSha: null });
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("Merge SHA"))).toBe(true);
  });

  it("blocks when deployment environment is inactive", async () => {
    const { run, staging } = await seedDeployReadyRun();
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_deployment_environments SET is_active = 0 WHERE id = ?`)
      .run(staging.id);
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("not active"))).toBe(true);
  });

  it("blocks on protected-path governance blockers", async () => {
    const changedFiles = [".env"];
    const governance = assessChangedFiles(changedFiles);
    const task = createTask({ title: "protected", targetRepoPath: "/tmp/repo" });
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
    await runReplayVerification(run.id, { persist: true, audit: false });
    ensureReplayStatusPassed(run.id);
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
    insertMergedMergeRequest(run.id, prId, task.id, null);
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.blockers.some((b) => b.includes("Protected path"))).toBe(true);
  });

  it("passes after approved run, PR, merge, evidence, policy, replay, and reviews", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const readiness = evaluateDeploymentReadiness(run.id, staging.id);
    expect(readiness.status).toBe("passed");
    expect(readiness.blockers).toHaveLength(0);
    expect(getEvidenceBundleForRun(run.id)).not.toBeNull();
  });
});

describe("deployment approval authorization", () => {
  it("rejects viewer role for operator-only readiness mutation", async () => {
    const hash = await hashPassword("pass");
    const viewer = createOperatorAccount({
      email: "viewer@example.com",
      displayName: "Viewer",
      passwordHash: hash,
      role: "viewer",
    });
    const session = createOperatorSession(viewer.id);
    const result = await authorizeMutation(
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          cookie: `ec_session=${encodeURIComponent(session.sessionToken)}`,
          [CSRF_HEADER_NAME]: session.csrfToken,
        },
      }),
      { minRole: "operator" },
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("operator can evaluate readiness but admin required for approval mutation", async () => {
    const hash = await hashPassword("pass");
    const op = createOperatorAccount({
      email: "op@example.com",
      displayName: "Op",
      passwordHash: hash,
      role: "operator",
    });
    const opSession = createOperatorSession(op.id);
    const evalAuth = await authorizeMutation(
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          cookie: `ec_session=${encodeURIComponent(opSession.sessionToken)}`,
          [CSRF_HEADER_NAME]: opSession.csrfToken,
        },
      }),
      { minRole: "operator" },
    );
    expect(evalAuth).not.toBeInstanceOf(NextResponse);

    const approvalAuth = await authorizeMutation(
      adminApprovalRequest(
        `ec_session=${encodeURIComponent(opSession.sessionToken)}`,
        opSession.csrfToken,
      ),
      { minRole: "admin" },
    );
    expect(approvalAuth).toBeInstanceOf(NextResponse);
    expect((approvalAuth as NextResponse).status).toBe(403);
  });

  it("production environment requires rationale for approval", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator@example.com",
    });
    const production = listDeploymentEnvironments().find((e) => e.name === "production")!;
    const prodCheck = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: production.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator@example.com",
    });
    expect(prodCheck.status).toBe("requires_review");
    await expect(
      createDeploymentApproval({
        runId: run.id,
        readinessCheckId: prodCheck.id,
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin@example.com",
      }),
    ).rejects.toThrow(DeploymentGateError);

    const approval = await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: prodCheck.id,
      decision: "approved",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
      rationale: "Production release approved after merge verification.",
    });
    expect(approval.decision).toBe("approved");
    expect(check.id).not.toBe(prodCheck.id);
  });

  it("admin can approve deployment readiness when passed", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const approval = await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: check.id,
      decision: "approved",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(approval.decision).toBe("approved");
  });

  it("requires_review readiness requires admin rationale on approval", async () => {
    const { run, staging } = await seedDeployReadyRun();
    runPolicyEvaluation(run.id, { persist: true, audit: false });
    const latestPolicy = getLatestPolicyResult(run.id);
    if (latestPolicy) {
      const parsed = parsePolicyEvaluationResult(latestPolicy);
      parsed.status = "requires_review";
      getEngineerConsoleDb()
        .prepare(
          `UPDATE engineer_governance_policy_results
           SET status = @status, result_json = @json WHERE id = @id`,
        )
        .run({
          id: latestPolicy.id,
          status: "requires_review",
          json: JSON.stringify(parsed),
        });
    }
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(check.status).toBe("requires_review");
    await expect(
      createDeploymentApproval({
        runId: run.id,
        readinessCheckId: check.id,
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin@example.com",
      }),
    ).rejects.toThrow(DeploymentGateError);
  });

  it("re-evaluates readiness at approval time and blocks stale passed checks", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(check.status).toBe("passed");
    getEngineerConsoleDb()
      .prepare(`DELETE FROM engineer_run_evidence_bundles WHERE run_id = ?`)
      .run(run.id);
    await expect(
      createDeploymentApproval({
        runId: run.id,
        readinessCheckId: check.id,
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin@example.com",
        rationale: "Should fail re-eval",
      }),
    ).rejects.toThrow(DeploymentGateError);
  });

  it("rejected deployment approval persists", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: check.id,
      decision: "rejected",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
      rationale: "Hold for additional review.",
    });
    const approvals = listDeploymentApprovalsForRun(run.id);
    expect(approvals[0]!.decision).toBe("rejected");
    expect(approvals[0]!.rationale).toContain("Hold");
  });

  it("blocked readiness prevents deployment approval", async () => {
    const { run } = await seedApprovedRun({ approveReviewStages: false });
    const staging = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(check.status).toBe("blocked");
    await expect(
      createDeploymentApproval({
        runId: run.id,
        readinessCheckId: check.id,
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin@example.com",
        rationale: "Should not pass",
      }),
    ).rejects.toThrow(DeploymentGateError);
  });

  it("models cannot evaluate readiness or approve deployment", async () => {
    expect(() =>
      createDeploymentReadinessCheck({
        runId: "run-id",
        environmentId: "env-id",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).toThrow(DeploymentGateError);
    await expect(
      createDeploymentApproval({
        runId: "run-id",
        readinessCheckId: "check-id",
        decision: "approved",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).rejects.toThrow(DeploymentGateError);
  });

  it("resolveHumanActor ignores client actorLabel when auth enabled", () => {
    const operator: AuthenticatedOperator = {
      id: "op-1",
      email: "real@example.com",
      displayName: "Real Operator",
      role: "operator",
    };
    const actor = resolveHumanActor(operator, "spoofed@evil.com");
    expect(actor.actorLabel).toBe("Real Operator");
    expect(actor.actorLabel).not.toBe("spoofed@evil.com");
  });

  it("readiness audit uses human actor label from evaluation", async () => {
    const { run, staging } = await seedDeployReadyRun();
    createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const event = listAuditEventsForRun(run.id).find(
      (e) => e.eventType === AUDIT_EVENT_TYPES.DEPLOYMENT_READINESS_EVALUATED,
    );
    expect(event?.actorType).toBe(AUDIT_ACTOR_TYPES.HUMAN);
    expect(event?.actorLabel).toBe("admin@example.com");
  });

  it("approval updates evidence bundle deployment summary", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: check.id,
      decision: "approved",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const summary = summarizeDeploymentGatesForRun(run.id);
    expect(summary.readinessCheckCount).toBeGreaterThan(0);
    expect(summary.latestApprovalDecision).toBe("approved");
    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.deploymentGates?.latestApprovalDecision).toBe("approved");
  });

  it("emits audit events for readiness, approval, and rejection", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: check.id,
      decision: "approved",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_READINESS_EVALUATED);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_APPROVED);

    const check2 = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: check2.id,
      decision: "rejected",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const typesAfter = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(typesAfter).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_REJECTED);
  });

  it("public readiness shape excludes secrets and command logs", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const json = JSON.stringify(toPublicDeploymentReadinessCheck(check));
    expect(json).not.toMatch(/password|secret|api[_-]?key/i);
    expect(json).not.toMatch(/stderr|stdout/i);
    expect(json).not.toMatch(/kubectl|terraform apply|npm run deploy/i);
  });

  it("does not execute deployment commands", async () => {
    const { run, staging } = await seedDeployReadyRun();
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: staging.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const approval = await createDeploymentApproval({
      runId: run.id,
      readinessCheckId: check.id,
      decision: "approved",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
      rationale: "Record only",
    });
    const serialized = JSON.stringify(approval);
    expect(serialized).not.toMatch(/deploy\s+--|kubectl|gh workflow run/i);
  });
});
