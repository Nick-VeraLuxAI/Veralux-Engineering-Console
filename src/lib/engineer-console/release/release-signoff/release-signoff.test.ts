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
import { runReleaseChecklistEvaluation } from "../release-checklist/release-checklist-manager";
import {
  createReleaseSignoff,
  listReleaseSignoffsForRun,
  parseReleaseSignoffSnapshot,
  toPublicReleaseSignoff,
} from "./release-signoff-manager";
import { ReleaseSignoffError } from "./release-signoff-types";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-release-signoff-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "release-signoff-test";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_SESSION_SECRET = "release-signoff-secret";
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
  const task = createTask({ title: "Release sign-off", targetRepoPath: "/tmp/repo" });
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
        warnings: [],
        blockers: status === "unhealthy" ? ["unhealthy"] : [],
        recommendedAction: "ok",
        evaluatedAt: now,
        policyVersion: "1.0.0",
        policyHash: "a".repeat(64),
      }),
      created_at: now,
    });
}

async function persistChecklist(
  runId: string,
  taskId: string,
  target: "complete" | "needs_attention" | "blocked",
) {
  if (target === "complete") {
    ensureReplayStatusPassed(runId);
    ensurePolicyStatusPassed(runId);
    const prId = insertPrRequest(runId, taskId);
    insertMergedMerge(runId, prId, taskId);
    const execId = insertSucceededExecution(runId, "staging");
    insertHealthCheck(runId, execId, "healthy", "staging");
    insertHealthPolicyResult(runId, execId, "healthy", "staging");
  } else if (target === "needs_attention") {
    insertPrRequest(runId, taskId);
  } else {
    const row = getEngineerConsoleDb()
      .prepare(
        `SELECT id, result_json FROM engineer_governance_policy_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId) as { id: string; result_json: string };
    const parsed = JSON.parse(row.result_json) as Record<string, unknown>;
    parsed.status = "blocked";
    parsed.blockers = ["Policy blocked for sign-off test."];
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_governance_policy_results SET status = 'blocked', result_json = @json WHERE id = @id`,
      )
      .run({ id: row.id, json: JSON.stringify(parsed) });
  }
  return runReleaseChecklistEvaluation(runId, { persist: true, audit: false });
}

function signoffInput(
  runId: string,
  decision: "completed" | "completed_with_exceptions" | "rejected",
  rationale?: string,
) {
  return {
    runId,
    decision,
    rationale,
    actorType: AUDIT_ACTOR_TYPES.HUMAN as const,
    actorLabel: "admin@example.com",
  };
}

describe("release sign-off decision rules", () => {
  it("allows completed when checklist is complete", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "complete");
    const record = createReleaseSignoff(signoffInput(run.id, "completed"));
    expect(record.decision).toBe("completed");
  });

  it("blocks completed when checklist needs_attention", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "needs_attention");
    expect(() => createReleaseSignoff(signoffInput(run.id, "completed"))).toThrow(
      ReleaseSignoffError,
    );
  });

  it("blocks completed when checklist blocked", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "blocked");
    expect(() => createReleaseSignoff(signoffInput(run.id, "completed"))).toThrow(
      ReleaseSignoffError,
    );
  });

  it("allows completed_with_exceptions for needs_attention with rationale", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "needs_attention");
    const record = createReleaseSignoff(
      signoffInput(run.id, "completed_with_exceptions", "Known gap documented."),
    );
    expect(record.decision).toBe("completed_with_exceptions");
  });

  it("blocks completed_with_exceptions without rationale", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "needs_attention");
    expect(() =>
      createReleaseSignoff(signoffInput(run.id, "completed_with_exceptions")),
    ).toThrow(ReleaseSignoffError);
  });

  it("blocks completed_with_exceptions when checklist blocked", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "blocked");
    expect(() =>
      createReleaseSignoff(
        signoffInput(run.id, "completed_with_exceptions", "Should not apply."),
      ),
    ).toThrow(ReleaseSignoffError);
  });

  it("allows rejected for blocked with rationale", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "blocked");
    const record = createReleaseSignoff(
      signoffInput(run.id, "rejected", "Release blocked by policy."),
    );
    expect(record.decision).toBe("rejected");
  });

  it("blocks rejected without rationale", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "blocked");
    expect(() => createReleaseSignoff(signoffInput(run.id, "rejected"))).toThrow(
      ReleaseSignoffError,
    );
  });

  it("requires persisted checklist before sign-off", async () => {
    const { run } = await seedApprovedRun();
    expect(() => createReleaseSignoff(signoffInput(run.id, "rejected", "No checklist yet."))).toThrow(
      /persisted release checklist/i,
    );
  });

  it("models cannot sign off", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "complete");
    expect(() =>
      createReleaseSignoff({
        runId: run.id,
        decision: "completed",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).toThrow(/Models cannot sign off/i);
  });
});

describe("release sign-off authorization", () => {
  it("rejects viewer for admin-only sign-off mutation", async () => {
    const hash = await hashPassword("pass");
    const viewer = createOperatorAccount({
      email: "viewer-rs@example.com",
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
      { minRole: "admin" },
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("rejects operator for admin-only sign-off mutation", async () => {
    const hash = await hashPassword("pass");
    const operator = createOperatorAccount({
      email: "op-rs@example.com",
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
      { minRole: "admin" },
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("allows admin for sign-off mutation", async () => {
    const hash = await hashPassword("pass");
    const admin = createOperatorAccount({
      email: "admin-rs@example.com",
      displayName: "Admin",
      passwordHash: hash,
      role: "admin",
    });
    const session = createOperatorSession(admin.id);
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
      { minRole: "admin" },
    );
    expect(result).not.toBeInstanceOf(NextResponse);
  });
});

describe("release sign-off audit and evidence", () => {
  it("emits RELEASE_SIGNOFF_COMPLETED audit event", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "complete");
    createReleaseSignoff(signoffInput(run.id, "completed"));
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_COMPLETED);
    const payloads = JSON.stringify(listAuditEventsForRun(run.id).map((e) => e.payload));
    expect(payloads).not.toMatch(/password|secret|token=/i);
  });

  it("emits RELEASE_SIGNOFF_COMPLETED_WITH_EXCEPTIONS audit event", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "needs_attention");
    createReleaseSignoff(
      signoffInput(run.id, "completed_with_exceptions", "Documented exception."),
    );
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_COMPLETED_WITH_EXCEPTIONS);
  });

  it("emits RELEASE_SIGNOFF_REJECTED audit event", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "blocked");
    createReleaseSignoff(signoffInput(run.id, "rejected", "Blocked release."));
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_REJECTED);
  });

  it("snapshot excludes logs, diffs, prompts, and secrets", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "complete");
    createReleaseSignoff(signoffInput(run.id, "completed"));
    const record = listReleaseSignoffsForRun(run.id)[0]!;
    const snapshot = parseReleaseSignoffSnapshot(record.signoffSnapshotJson);
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("stdout");
    expect(json).not.toContain("stderr");
    expect(json).not.toContain("diffSummary");
    expect(json).not.toContain("rawResponse");
    expect(json).not.toContain("systemPrompt");
    expect(json).not.toContain("api_key=");
  });

  it("public sign-off API shape is redacted", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "complete");
    createReleaseSignoff(signoffInput(run.id, "completed"));
    const pub = toPublicReleaseSignoff(listReleaseSignoffsForRun(run.id)[0]!);
    const json = JSON.stringify(pub);
    expect(pub.evidenceBundleHashPrefix).toBeTruthy();
    expect(json).not.toContain("signoffSnapshotJson");
    expect(json).not.toContain("stdout");
    expect(json.length).toBeLessThan(8000);
  });

  it("includes sign-off summary in evidence and replay package", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "complete");
    createReleaseSignoff(signoffInput(run.id, "completed"));
    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.releaseSignoff?.latestDecision).toBe("completed");
    const replay = buildRedactedReplayPackage(run.id);
    expect(replay.releaseSignoff?.latestDecision).toBe("completed");
    expect(JSON.stringify(replay.releaseSignoff)).not.toContain("rationale");
    expect(JSON.stringify(bundle.releaseSignoff)).not.toContain("signoff_snapshot");
  });

  it("append-only sign-off history", async () => {
    const { run, task } = await seedApprovedRun();
    await persistChecklist(run.id, task.id, "needs_attention");
    createReleaseSignoff(
      signoffInput(run.id, "completed_with_exceptions", "First exception."),
    );
    await persistChecklist(run.id, task.id, "needs_attention");
    createReleaseSignoff(signoffInput(run.id, "rejected", "Later rejection."));
    expect(listReleaseSignoffsForRun(run.id).length).toBe(2);
  });
});

describe("release sign-off module safety", () => {
  it("does not use fetch, shell, or deployment triggers in sign-off sources", () => {
    const dir = __dirname;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/child_process|exec\(|spawn\(/);
      expect(source).not.toMatch(/createDeploymentExecution|rollback/i);
    }
  });
});
