/**
 * Deterministic SQLite fixtures for browser E2E.
 * Writes to ENGINEER_CONSOLE_DB_PATH (shared with the running Next.js server).
 * Does not invoke git, gh, deployment profiles, or health HTTP.
 */
import { v4 as uuidv4 } from "uuid";
import { buildApprovalReport } from "../../src/lib/engineer-console/approval/approval-report";
import { AUDIT_ACTOR_TYPES } from "../../src/lib/engineer-console/governance/audit-ledger/audit-event-types";
import { createDecisionRecord } from "../../src/lib/engineer-console/governance/decision-records/decision-record-manager";
import { assessChangedFiles } from "../../src/lib/engineer-console/governance/governance-engine";
import { runPolicyEvaluation } from "../../src/lib/engineer-console/governance/policy-results/policy-result-manager";
import { runReplayVerification } from "../../src/lib/engineer-console/governance/replay-verification/replay-verification-manager";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "../../src/lib/engineer-console/governance/review-stages/review-stage-manager";
import { closeEngineerConsoleDb, getEngineerConsoleDb } from "../../src/lib/engineer-console/db/client";
import { initializeEngineerConsoleDatabase } from "../../src/lib/engineer-console/db/init";
import { getRunById, saveApprovalReport, saveQualityGateResults, updateRun } from "../../src/lib/engineer-console/run-manager/run-manager";
import { getTaskById } from "../../src/lib/engineer-console/task-manager/task-manager";
import { listDeploymentEnvironments } from "../../src/lib/engineer-console/release/deployment-gates/deployment-environments";
import { runReleaseChecklistEvaluation } from "../../src/lib/engineer-console/release/release-checklist/release-checklist-manager";
import { createReleaseSignoff } from "../../src/lib/engineer-console/release/release-signoff/release-signoff-manager";
import {
  E2E_AUTH_AUDIT_SCOPE,
  E2E_GATES_AUDIT_SCOPE,
  E2E_LOCAL_AUDIT_SCOPE,
  E2E_LOCAL_DB_PATH,
} from "./env";

let activeDbPath: string | null = null;

function auditScopeForDbPath(dbPath: string): string {
  if (dbPath.includes("e2e-gates")) return E2E_GATES_AUDIT_SCOPE;
  if (dbPath.includes("e2e-auth")) return E2E_AUTH_AUDIT_SCOPE;
  return E2E_LOCAL_AUDIT_SCOPE;
}

export function ensureE2eDatabaseReady(dbPath: string = E2E_LOCAL_DB_PATH): void {
  process.env.ENGINEER_CONSOLE_DB_PATH = dbPath;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = auditScopeForDbPath(dbPath);
  if (activeDbPath !== dbPath) {
    closeEngineerConsoleDb();
    initializeEngineerConsoleDatabase();
    activeDbPath = dbPath;
  }
}

function insertStubEvidenceBundle(runId: string, taskId: string): void {
  const id = uuidv4();
  const now = nowIso();
  const bundle = {
    bundleVersion: "engineer_run_evidence_bundle_v1",
    runId,
    taskId,
    runStatus: "completed",
    changedFileCount: 1,
    qualityGates: [],
    governance: { riskLevel: "low", canApprove: true, issueCount: 0, blockedFileCount: 0, issuesPreview: [] },
    approval: { canApprove: true, recommendedNextAction: "approve", riskLevel: "low" },
  };
  const bundleJson = JSON.stringify(bundle);
  const bundleHash = "e".repeat(64);
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_run_evidence_bundles
        (id, run_id, task_id, registered_repo_id, bundle_hash, bundle_json,
         redaction_version, created_at, updated_at)
       VALUES
        (@id, @run_id, @task_id, NULL, @bundle_hash, @bundle_json,
         'engineer-evidence-v1', @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: runId,
      task_id: taskId,
      bundle_hash: bundleHash,
      bundle_json: bundleJson,
      created_at: now,
      updated_at: now,
    });
}

/** Avoid closing the DB handle during E2E — closing can disrupt the Next.js server's SQLite WAL reader. */
export function releaseE2eDbWriter(): void {
  // no-op
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertFixtureRunTaskExist(params: {
  runId: string;
  taskId?: string;
  fixtureName: string;
}): { runTaskId: string } {
  const run = getRunById(params.runId);
  if (!run) {
    const dbPath = process.env.ENGINEER_CONSOLE_DB_PATH ?? "<unset>";
    throw new Error(
      `[${params.fixtureName}] Run not found: ${params.runId}. ` +
        `DB path: ${dbPath}. This usually indicates shared-DB fixture reset or mismatched E2E DB path configuration.`,
    );
  }
  if (params.taskId && run.taskId !== params.taskId) {
    throw new Error(
      `[${params.fixtureName}] Run/task mismatch: run ${params.runId} belongs to task ${run.taskId}, not ${params.taskId}.`,
    );
  }
  const task = getTaskById(params.taskId ?? run.taskId);
  if (!task) {
    throw new Error(
      `[${params.fixtureName}] Task not found: ${params.taskId ?? run.taskId} for run ${params.runId}.`,
    );
  }
  return { runTaskId: run.taskId };
}

export function ensurePolicyStatusPassed(runId: string): void {
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

export function ensureReplayStatusPassed(runId: string): void {
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

export function blockPolicyForRun(runId: string): void {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT id, result_json FROM engineer_governance_policy_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as { id: string; result_json: string } | undefined;
  if (!row) return;
  const parsed = JSON.parse(row.result_json) as Record<string, unknown>;
  parsed.status = "blocked";
  parsed.blockers = ["E2E fixture: policy blocked for hard gate smoke."];
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_governance_policy_results SET status = 'blocked', result_json = @json WHERE id = @id`,
    )
    .run({ id: row.id, json: JSON.stringify(parsed) });
}

export function insertPrRequest(runId: string, taskId: string): string {
  assertFixtureRunTaskExist({ runId, taskId, fixtureName: "insertPrRequest" });
  const id = uuidv4();
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_pr_requests
        (id, run_id, task_id, registered_repo_id, branch_name, base_branch, status,
         readiness_status, readiness_json, pr_url, pr_number, commit_sha,
         actor_type, actor_label, created_at, updated_at)
       VALUES
        (@id, @run_id, @task_id, NULL, 'engineer/e2e-branch', 'main', 'pr_created',
         'passed', '{}', 'https://example.com/pr/e2e', '42', 'sha-e2e',
         'human', 'e2e-fixture', @created_at, @updated_at)`,
    )
    .run({ id, run_id: runId, task_id: taskId, created_at: now, updated_at: now });
  return id;
}

export function insertMergedMerge(runId: string, prId: string, taskId: string): string {
  const id = uuidv4();
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_merge_requests
        (id, run_id, pr_request_id, task_id, registered_repo_id, pr_url, pr_number,
         base_branch, head_branch, commit_sha, merge_sha, status, readiness_status,
         readiness_json, actor_type, actor_label, created_at, updated_at, completed_at)
       VALUES
        (@id, @run_id, @pr_id, @task_id, NULL, 'https://example.com/pr/e2e', '42',
         'main', 'engineer/e2e-branch', 'sha-e2e', 'merge-sha-e2e', 'merged', 'passed', '{}',
         'human', 'e2e-fixture', @created_at, @updated_at, @completed_at)`,
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

export function insertSucceededExecution(runId: string, environmentName: string): string {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const now = nowIso();
  const readinessId = uuidv4();
  const approvalId = uuidv4();
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_readiness_checks
        (id, run_id, environment_id, status, readiness_json, actor_type, actor_label, created_at)
       VALUES (@id, @run_id, @env_id, 'passed', '{}', 'human', 'e2e-fixture', @created_at)`,
    )
    .run({ id: readinessId, run_id: runId, env_id: env.id, created_at: now });
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_approvals
        (id, run_id, readiness_check_id, environment_id, decision, actor_type, actor_label, created_at)
       VALUES (@id, @run_id, @readiness_id, @env_id, 'approved', 'human', 'e2e-fixture', @created_at)`,
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
        (@id, @run_id, @approval_id, @readiness_id, @env_id, 'e2e-stub-profile', @status,
         'human', 'e2e-fixture', @created_at, @created_at, @completed_at, 'hash-e2e')`,
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

export function insertHealthCheck(
  runId: string,
  executionId: string,
  status: string,
  envName: string,
): void {
  const env = listDeploymentEnvironments().find((e) => e.name === envName)!;
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_checks
        (id, run_id, deployment_execution_id, environment_id, health_profile, status,
         response_status, response_time_ms, output_summary, output_hash,
         actor_type, actor_label, created_at, completed_at)
       VALUES
        (@id, @run_id, @exec_id, @env_id, 'e2e-health-profile', @status, 200, 42, '[redacted]', 'abc',
         'human', 'e2e-fixture', @created_at, @completed_at)`,
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

export function insertHealthPolicyResult(
  runId: string,
  executionId: string,
  status: string,
  environmentName: string,
): void {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_policy_results
        (id, run_id, deployment_execution_id, environment_id, status, policy_version, policy_hash,
         result_json, actor_type, actor_label, created_at)
       VALUES
        (@id, @run_id, @exec_id, @env_id, @status, '1.0.0', 'abc', @json, 'human', 'e2e-fixture', @created_at)`,
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
        blockers: status === "unhealthy" ? ["E2E unhealthy fixture"] : [],
        recommendedAction: "ok",
        evaluatedAt: now,
        policyVersion: "1.0.0",
        policyHash: "a".repeat(64),
      }),
      created_at: now,
    });
}

export async function seedApprovedGovernanceForRun(
  runId: string,
  options: { approveReviewStages?: boolean } = {},
): Promise<void> {
  const approveReviewStages = options.approveReviewStages !== false;
  const run = getRunById(runId);
  if (!run) {
    const dbPath = process.env.ENGINEER_CONSOLE_DB_PATH ?? "<unset>";
    throw new Error(
      `[seedApprovedGovernanceForRun] Run not found: ${runId}. ` +
        `DB path: ${dbPath}. Likely shared SQLite fixture race or mismatched E2E DB path.`,
    );
  }
  const task = getTaskById(run.taskId);
  if (!task) throw new Error(`Task not found: ${run.taskId}`);

  const changedFiles = ["src/e2e-fixture.ts"];
  const governance = assessChangedFiles(changedFiles);
  updateRun(run.id, {
    status: "completed",
    branchName: "engineer/e2e-branch",
    riskLevel: governance.riskLevel,
    governanceNotes: JSON.stringify(governance),
    completedAt: nowIso(),
  });
  saveQualityGateResults(run.id, [
    {
      command: "npm test",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      status: "passed",
    },
  ]);
  const report = buildApprovalReport({
    task,
    run: { ...run, status: "completed", branchName: "engineer/e2e-branch" },
    changedFiles,
    diffSummary: "1 file",
    governance,
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  reconcileReviewStagesForRun(run.id, { audit: false });
  insertStubEvidenceBundle(run.id, run.taskId);
  await runReplayVerification(run.id, { persist: true, audit: false });
  if (approveReviewStages) {
    for (const stage of listReviewStagesForRun(run.id).filter((s) => s.required)) {
      completeReviewStageAction({
        stageId: stage.id,
        action: "approve",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "e2e-reviewer",
      });
    }
  }
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  createDecisionRecord({
    runId: run.id,
    decision: "approved",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "e2e-admin@local.test",
    rationale: "E2E fixture approval",
  });
  runPolicyEvaluation(run.id, { persist: true, audit: false });
}

export async function seedReleaseLifecycleRecordsOnly(
  runId: string,
  taskId: string,
): Promise<void> {
  assertFixtureRunTaskExist({
    runId,
    taskId,
    fixtureName: "seedReleaseLifecycleRecordsOnly",
  });
  const prId = insertPrRequest(runId, taskId);
  insertMergedMerge(runId, prId, taskId);
}

export async function seedFullReleaseLifecycleFixture(
  runId: string,
  taskId: string,
): Promise<void> {
  await seedApprovedGovernanceForRun(runId);
  ensurePolicyStatusPassed(runId);
  ensureReplayStatusPassed(runId);
  await seedReleaseLifecycleRecordsOnly(runId, taskId);
  createReleaseSignoff({
    runId,
    decision: "completed",
    rationale: "E2E fixture sign-off",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "e2e-admin@local.test",
  });
}

export async function seedHardGateBlockedFixture(runId: string, taskId: string): Promise<void> {
  await seedReleaseLifecycleRecordsOnly(runId, taskId);
  runPolicyEvaluation(runId, { persist: true, audit: false });
  blockPolicyForRun(runId);
  await runReleaseChecklistEvaluation(runId, { persist: true, audit: false });
}

export async function seedPrOnlyFixture(runId: string, taskId: string): Promise<void> {
  await seedApprovedGovernanceForRun(runId);
  insertPrRequest(runId, taskId);
}
