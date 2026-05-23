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
import { assessChangedFiles } from "../../governance/governance-engine";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../../governance/audit-ledger/audit-ledger-manager";
import { createDecisionRecord } from "../../governance/decision-records/decision-record-manager";
import { buildRunEvidenceBundle } from "../../governance/evidence-bundles/build-run-evidence-bundle";
import { refreshRunEvidenceBundle } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { runPolicyEvaluation } from "../../governance/policy-results/policy-result-manager";
import { runReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import { buildRedactedReplayPackage } from "../../governance/replay-verification/replay-package-builder";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "../../governance/review-stages/review-stage-manager";
import { createRun, saveApprovalReport, saveQualityGateResults, updateRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { authorizeMutation } from "../../security/route-guards";
import { createOperatorAccount } from "../../security/operator-account-manager";
import { hashPassword } from "../../security/password-hashing";
import { createOperatorSession } from "../../security/session-manager";
import { CSRF_HEADER_NAME } from "../../security/csrf";
import { listDeploymentEnvironments } from "../deployment-gates/deployment-environments";
import { buildReleaseChecklist } from "./build-release-checklist";
import {
  getLatestReleaseChecklistForRun,
  listReleaseChecklistsForRun,
  runReleaseChecklistEvaluation,
  toPublicReleaseChecklist,
} from "./release-checklist-manager";
import { ReleaseChecklistError } from "./release-checklist-types";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-release-checklist-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "release-checklist-test";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_SESSION_SECRET = "release-checklist-secret";
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
  const task = createTask({ title: "Release checklist", targetRepoPath: "/tmp/repo" });
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
    rationale: "approved",
  });
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  return { task, run };
}

function insertPrRequest(runId: string, taskId: string): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_pr_requests
        (id, run_id, task_id, registered_repo_id, branch_name, base_branch, status,
         readiness_status, readiness_json, pr_url, pr_number, commit_sha,
         actor_type, actor_label, created_at, updated_at)
       VALUES
        (@id, @run_id, @task_id, NULL, 'engineer/test', 'main', 'pr_created',
         'passed', '{}', 'https://example.com/pr/1', '1', 'sha',
         'human', 'admin', @created_at, @updated_at)`,
    )
    .run({ id, run_id: runId, task_id: taskId, created_at: now, updated_at: now });
  return id;
}

function insertMergedMerge(runId: string, prId: string, taskId: string): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_merge_requests
        (id, run_id, pr_request_id, task_id, registered_repo_id, pr_url, pr_number,
         base_branch, head_branch, commit_sha, merge_sha, status, readiness_status,
         readiness_json, actor_type, actor_label, created_at, updated_at, completed_at)
       VALUES
        (@id, @run_id, @pr_id, @task_id, NULL, 'https://example.com/pr/1', '1',
         'main', 'engineer/test', 'sha', 'mergesha', 'merged', 'passed', '{}',
         'human', 'admin', @created_at, @updated_at, @completed_at)`,
    )
    .run({
      id,
      run_id: runId,
      pr_id: prId,
      task_id: taskId,
      created_at: now,
      updated_at: now,
      completed_at: now,
    });
  return id;
}

function ensurePolicyStatusPassed(runId: string): void {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT id, result_json FROM engineer_governance_policy_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as { id: string; result_json: string } | undefined;
  if (!row) return;
  const parsed = JSON.parse(row.result_json) as Record<string, unknown>;
  parsed.status = "passed";
  parsed.blockers = [];
  parsed.warnings = [];
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_governance_policy_results SET status = 'passed', result_json = @json WHERE id = @id`,
    )
    .run({ id: row.id, json: JSON.stringify(parsed) });
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

function insertSucceededExecution(runId: string, environmentName: string): string {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const now = new Date().toISOString();
  const readinessId = uuidv4();
  const approvalId = uuidv4();
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_readiness_checks
        (id, run_id, environment_id, status, readiness_json, actor_type, actor_label, created_at)
       VALUES (@id, @run_id, @env_id, 'passed', '{}', 'human', 'admin', @created_at)`,
    )
    .run({ id: readinessId, run_id: runId, env_id: env.id, created_at: now });
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_approvals
        (id, run_id, readiness_check_id, environment_id, decision, actor_type, actor_label, created_at)
       VALUES (@id, @run_id, @readiness_id, @env_id, 'approved', 'human', 'admin', @created_at)`,
    )
    .run({
      id: approvalId,
      run_id: runId,
      readiness_id: readinessId,
      env_id: env.id,
      created_at: now,
    });
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_executions
        (id, run_id, deployment_approval_id, readiness_check_id, environment_id, deployment_profile, status,
         actor_type, actor_label, created_at, updated_at, completed_at, output_hash)
       VALUES
        (@id, @run_id, @approval_id, @readiness_id, @env_id, 'profile', @status,
         'human', 'admin', @created_at, @created_at, @completed_at, 'hash123')`,
    )
    .run({
      id,
      run_id: runId,
      approval_id: approvalId,
      readiness_id: readinessId,
      env_id: env.id,
      status: "succeeded",
      created_at: now,
      completed_at: now,
    });
  return id;
}

function insertHealthCheck(runId: string, executionId: string, status: string, envName: string): void {
  const env = listDeploymentEnvironments().find((e) => e.name === envName)!;
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_checks
        (id, run_id, deployment_execution_id, environment_id, health_profile, status,
         response_status, response_time_ms, output_summary, output_hash,
         actor_type, actor_label, created_at, completed_at)
       VALUES
        (@id, @run_id, @exec_id, @env_id, 'hp', @status, 200, 50, '[redacted]', 'abc',
         'human', 'op', @created_at, @completed_at)`,
    )
    .run({
      id: uuidv4(),
      run_id: runId,
      exec_id: executionId,
      env_id: env.id,
      status,
      created_at: now,
      completed_at: now,
    });
}

function insertHealthPolicyResult(
  runId: string,
  executionId: string,
  status: string,
  environmentName: string,
): void {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_policy_results
        (id, run_id, deployment_execution_id, environment_id, status, policy_version, policy_hash,
         result_json, actor_type, actor_label, created_at)
       VALUES
        (@id, @run_id, @exec_id, @env_id, @status, '1.0.0', 'abc', @json, 'human', 'op', @created_at)`,
    )
    .run({
      id: uuidv4(),
      run_id: runId,
      exec_id: executionId,
      env_id: env.id,
      status,
      json: JSON.stringify({
        runId,
        status,
        environmentName,
        warnings: environmentName === "production" && status === "needs_attention"
          ? ["Production deployment has no recorded post-deploy health check."]
          : [],
        blockers: status === "unhealthy" ? ["unhealthy"] : [],
        recommendedAction: "ok",
        evaluatedAt: now,
        policyVersion: "1.0.0",
        policyHash: "a".repeat(64),
      }),
      created_at: now,
    });
}

describe("buildReleaseChecklist", () => {
  it("returns not_started when no PR or deployment lifecycle exists", async () => {
    const task = createTask({ title: "RC", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.status).toBe("not_started");
  });

  it("blocks when evidence bundle is missing", async () => {
    const { run } = await seedApprovedRun();
    getEngineerConsoleDb()
      .prepare(`DELETE FROM engineer_run_evidence_bundles WHERE run_id = ?`)
      .run(run.id);
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "evidence_bundle")?.status).toBe("blocked");
    expect(checklist.status).toBe("blocked");
  });

  it("blocks when governance policy is blocked", async () => {
    const { run } = await seedApprovedRun();
    const row = getEngineerConsoleDb()
      .prepare(
        `SELECT id, result_json FROM engineer_governance_policy_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(run.id) as { id: string; result_json: string };
    const parsed = JSON.parse(row.result_json) as Record<string, unknown>;
    parsed.status = "blocked";
    parsed.blockers = ["Policy blocked for test."];
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_governance_policy_results SET status = 'blocked', result_json = @json WHERE id = @id`,
      )
      .run({ id: row.id, json: JSON.stringify(parsed) });
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "policy_result")?.status).toBe("blocked");
    expect(checklist.status).toBe("blocked");
  });

  it("blocks when required review stage is pending", async () => {
    const { run } = await seedApprovedRun({ approveReviewStages: false });
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "review_stages")?.status).toBe("blocked");
    expect(checklist.status).toBe("blocked");
  });

  it("needs_attention when PR created but not merged", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrRequest(run.id, task.id);
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "pr_merged")?.status).toBe("needs_attention");
    expect(["needs_attention", "blocked"]).toContain(checklist.status);
  });

  it("needs_attention when merged but deployment not approved", async () => {
    const { run, task } = await seedApprovedRun();
    const prId = insertPrRequest(run.id, task.id);
    insertMergedMerge(run.id, prId, task.id);
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "deployment_approved")?.status).toBe(
      "needs_attention",
    );
  });

  it("blocks when deployment execution failed", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    const prId = insertPrRequest(run.id, task.id);
    insertMergedMerge(run.id, prId, task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_deployment_executions SET status = 'failed' WHERE id = ?`)
      .run(execId);
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "deployment_succeeded")?.status).toBe("blocked");
    expect(checklist.status).toBe("blocked");
  });

  it("needs_attention when health policy is unhealthy", async () => {
    const { run, task } = await seedApprovedRun();
    const prId = insertPrRequest(run.id, task.id);
    insertMergedMerge(run.id, prId, task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "unhealthy", "staging");
    insertHealthPolicyResult(run.id, execId, "unhealthy", "staging");
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "health_policy")?.status).toBe(
      "needs_attention",
    );
    expect(checklist.status).toBe("needs_attention");
  });

  it("needs_attention when production health policy needs_attention", async () => {
    const { run, task } = await seedApprovedRun();
    const prId = insertPrRequest(run.id, task.id);
    insertMergedMerge(run.id, prId, task.id);
    const execId = insertSucceededExecution(run.id, "production");
    insertHealthPolicyResult(run.id, execId, "needs_attention", "production");
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.items.find((i) => i.id === "health_policy")?.status).toBe(
      "needs_attention",
    );
    expect(checklist.status).toBe("needs_attention");
  });

  it("returns complete when lifecycle items and health policy are satisfied", async () => {
    const { run, task } = await seedApprovedRun();
    ensureReplayStatusPassed(run.id);
    ensurePolicyStatusPassed(run.id);
    const prId = insertPrRequest(run.id, task.id);
    insertMergedMerge(run.id, prId, task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "healthy", "staging");
    insertHealthPolicyResult(run.id, execId, "healthy", "staging");
    const checklist = buildReleaseChecklist(run.id);
    expect(checklist.status).toBe("complete");
  });

  it("does not use fetch or shell in builder source", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "build-release-checklist.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/child_process|exec\(|spawn\(|shell/);
  });
});

describe("release checklist manager", () => {
  it("persists append-only checklist history", async () => {
    const { run } = await seedApprovedRun();
    await runReleaseChecklistEvaluation(run.id, { persist: true, audit: false });
    await runReleaseChecklistEvaluation(run.id, { persist: true, audit: false });
    expect(listReleaseChecklistsForRun(run.id).length).toBe(2);
  });

  it("emits audit event on evaluation", async () => {
    const { run } = await seedApprovedRun();
    await runReleaseChecklistEvaluation(run.id, {
      persist: true,
      audit: true,
      actorLabel: "op@example.com",
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.RELEASE_CHECKLIST_EVALUATED);
    const payloads = JSON.stringify(listAuditEventsForRun(run.id).map((e) => e.payload));
    expect(payloads).not.toMatch(/password|secret|token=/i);
  });

  it("public checklist excludes secrets and full logs", async () => {
    const { run } = await seedApprovedRun();
    const evaluation = await runReleaseChecklistEvaluation(run.id, {
      persist: true,
      audit: false,
    });
    const record = getLatestReleaseChecklistForRun(run.id)!;
    const pub = toPublicReleaseChecklist(evaluation, {
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    const json = JSON.stringify(pub);
    expect(json).not.toContain("stdout");
    expect(json).not.toContain("output_summary");
    expect(pub.items.length).toBeGreaterThan(0);
  });

  it("models cannot evaluate checklist", async () => {
    const { run } = await seedApprovedRun();
    await expect(
      runReleaseChecklistEvaluation(run.id, {
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).rejects.toThrow(ReleaseChecklistError);
  });

  it("includes checklist summary in evidence and replay package", async () => {
    const { run, task } = await seedApprovedRun();
    const prId = insertPrRequest(run.id, task.id);
    insertMergedMerge(run.id, prId, task.id);
    await runReleaseChecklistEvaluation(run.id, { persist: true, audit: false });
    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.releaseChecklist?.latestStatus).toBeTruthy();
    const replay = buildRedactedReplayPackage(run.id);
    expect(replay.releaseChecklist?.latestStatus).toBeTruthy();
    expect(JSON.stringify(replay.releaseChecklist)).not.toContain("stdout");
  });
});

describe("release checklist authorization", () => {
  it("allows operator for checklist mutation", async () => {
    const hash = await hashPassword("pass");
    const operator = createOperatorAccount({
      email: "op-rc@example.com",
      displayName: "Operator",
      passwordHash: hash,
      role: "operator",
    });
    const session = createOperatorSession(operator.id);
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
    expect(result).not.toBeInstanceOf(NextResponse);
  });

  it("rejects viewer for operator-only checklist mutation", async () => {
    const hash = await hashPassword("pass");
    const viewer = createOperatorAccount({
      email: "viewer-rc@example.com",
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
});
