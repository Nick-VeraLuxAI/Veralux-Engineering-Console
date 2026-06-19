import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import type {
  AttemptFailureRecord,
  AttemptOutcome,
  AttemptStatus,
  FailureCategory,
  QualityBaselineComparisonRecord,
  QualityBaselineRecord,
  RequirementExecutionAttempt,
  RetryStrategy,
  VerificationDecisionRecord,
  WorkerAssignmentRecord,
} from "./requirement-execution-types";

function nowIso(): string {
  return new Date().toISOString();
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface AttemptRow {
  id: string;
  project_id: string;
  requirement_id: string;
  task_id: string;
  run_id: string | null;
  attempt_number: number;
  status: string;
  worker_role: string;
  model_provider: string;
  model_name: string;
  strategy: string;
  started_at: string | null;
  completed_at: string | null;
  outcome: string | null;
  failure_category: string | null;
  failure_fingerprint: string | null;
  failure_summary: string | null;
  retryable: number;
  files_changed_summary: string;
  commands_executed_summary: string;
  test_summary: string;
  quality_gate_summary: string;
  evidence_bundle_id: string | null;
  supersedes_attempt_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AssignmentRow {
  id: string;
  attempt_id: string;
  project_id: string;
  requirement_id: string;
  task_id: string;
  assignment_json: string;
  validation_status: string;
  validation_errors_json: string;
  assignment_hash: string;
  created_at: string;
}

interface FailureRow {
  id: string;
  attempt_id: string;
  project_id: string;
  requirement_id: string;
  run_id: string | null;
  category: string;
  summary: string;
  details_json: string;
  retryable: number;
  fingerprint: string;
  associated_command: string | null;
  affected_files_json: string;
  created_at: string;
}

interface BaselineRow {
  id: string;
  project_id: string;
  repo_path: string | null;
  registered_repo_id: string | null;
  baseline_revision: string;
  baseline_json: string;
  baseline_hash: string;
  status: string;
  approved_by: string;
  approved_at: string;
  created_at: string;
}

interface BaselineComparisonRow {
  id: string;
  attempt_id: string;
  baseline_id: string | null;
  comparison_json: string;
  status: string;
  new_failures_json: string;
  worsened_failures_json: string;
  repaired_failures_json: string;
  created_at: string;
}

interface VerificationRow {
  id: string;
  attempt_id: string;
  project_id: string;
  requirement_id: string;
  verifier: string;
  verifier_model: string | null;
  decision: string;
  reason: string;
  evidence_summary_json: string;
  created_at: string;
}

function mapAttempt(row: AttemptRow): RequirementExecutionAttempt {
  return {
    id: row.id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    taskId: row.task_id,
    runId: row.run_id,
    attemptNumber: row.attempt_number,
    status: row.status as AttemptStatus,
    workerRole: row.worker_role,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    strategy: row.strategy as RetryStrategy,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outcome: row.outcome as AttemptOutcome | null,
    failureCategory: row.failure_category as FailureCategory | null,
    failureFingerprint: row.failure_fingerprint,
    failureSummary: row.failure_summary,
    retryable: row.retryable === 1,
    filesChangedSummary: row.files_changed_summary,
    commandsExecutedSummary: row.commands_executed_summary,
    testSummary: row.test_summary,
    qualityGateSummary: row.quality_gate_summary,
    evidenceBundleId: row.evidence_bundle_id,
    supersedesAttemptId: row.supersedes_attempt_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: AssignmentRow): WorkerAssignmentRecord {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    taskId: row.task_id,
    assignmentJson: row.assignment_json,
    validationStatus: row.validation_status as WorkerAssignmentRecord["validationStatus"],
    validationErrorsJson: row.validation_errors_json,
    assignmentHash: row.assignment_hash,
    createdAt: row.created_at,
  };
}

function mapFailure(row: FailureRow): AttemptFailureRecord {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    runId: row.run_id,
    category: row.category as FailureCategory,
    summary: row.summary,
    detailsJson: row.details_json,
    retryable: row.retryable === 1,
    fingerprint: row.fingerprint,
    associatedCommand: row.associated_command,
    affectedFilesJson: row.affected_files_json,
    createdAt: row.created_at,
  };
}

function mapBaseline(row: BaselineRow): QualityBaselineRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    repoPath: row.repo_path,
    registeredRepoId: row.registered_repo_id,
    baselineRevision: row.baseline_revision,
    baselineJson: row.baseline_json,
    baselineHash: row.baseline_hash,
    status: row.status as QualityBaselineRecord["status"],
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

function mapBaselineComparison(row: BaselineComparisonRow): QualityBaselineComparisonRecord {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    baselineId: row.baseline_id,
    comparisonJson: row.comparison_json,
    status: row.status as QualityBaselineComparisonRecord["status"],
    newFailuresJson: row.new_failures_json,
    worsenedFailuresJson: row.worsened_failures_json,
    repairedFailuresJson: row.repaired_failures_json,
    createdAt: row.created_at,
  };
}

function mapVerification(row: VerificationRow): VerificationDecisionRecord {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    verifier: row.verifier,
    verifierModel: row.verifier_model,
    decision: row.decision as VerificationDecisionRecord["decision"],
    reason: row.reason,
    evidenceSummaryJson: row.evidence_summary_json,
    createdAt: row.created_at,
  };
}

export function createExecutionAttempt(input: {
  projectId: string;
  requirementId: string;
  taskId: string;
  workerRole?: string;
  modelProvider: string;
  modelName: string;
  strategy?: RetryStrategy;
  supersedesAttemptId?: string | null;
}): RequirementExecutionAttempt {
  const db = getEngineerConsoleDb();
  const latest = db
    .prepare(
      `SELECT MAX(attempt_number) AS attempt_number
       FROM engineer_requirement_execution_attempts
       WHERE requirement_id = ?`,
    )
    .get(input.requirementId) as { attempt_number: number | null };
  const id = uuidv4();
  const now = nowIso();
  db.prepare(
    `INSERT INTO engineer_requirement_execution_attempts
      (id, project_id, requirement_id, task_id, attempt_number, status, worker_role,
       model_provider, model_name, strategy, supersedes_attempt_id, created_at, updated_at)
     VALUES
      (@id, @project_id, @requirement_id, @task_id, @attempt_number, 'pending', @worker_role,
       @model_provider, @model_name, @strategy, @supersedes_attempt_id, @created_at, @updated_at)`,
  ).run({
    id,
    project_id: input.projectId,
    requirement_id: input.requirementId,
    task_id: input.taskId,
    attempt_number: (latest.attempt_number ?? 0) + 1,
    worker_role: input.workerRole ?? "coding_worker",
    model_provider: input.modelProvider,
    model_name: input.modelName,
    strategy: input.strategy ?? "initial_implementation",
    supersedes_attempt_id: input.supersedesAttemptId ?? null,
    created_at: now,
    updated_at: now,
  });
  return getExecutionAttemptById(id)!;
}

export function getExecutionAttemptById(id: string): RequirementExecutionAttempt | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_requirement_execution_attempts WHERE id = ?`)
    .get(id) as AttemptRow | undefined;
  return row ? mapAttempt(row) : null;
}

export function getExecutionAttemptByRunId(runId: string): RequirementExecutionAttempt | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_requirement_execution_attempts WHERE run_id = ?`)
    .get(runId) as AttemptRow | undefined;
  return row ? mapAttempt(row) : null;
}

export function getActiveAttemptForRequirement(
  requirementId: string,
): RequirementExecutionAttempt | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_execution_attempts
       WHERE requirement_id = ?
         AND status IN ('pending', 'assigned', 'dispatched', 'running', 'evaluating', 'verification', 'retry_scheduled')
       ORDER BY attempt_number DESC
       LIMIT 1`,
    )
    .get(requirementId) as AttemptRow | undefined;
  return row ? mapAttempt(row) : null;
}

export function listAttemptsForRequirement(requirementId: string): RequirementExecutionAttempt[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_execution_attempts
       WHERE requirement_id = ?
       ORDER BY attempt_number ASC`,
    )
    .all(requirementId) as AttemptRow[];
  return rows.map(mapAttempt);
}

export function listAttemptsForProject(projectId: string): RequirementExecutionAttempt[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_execution_attempts
       WHERE project_id = ?
       ORDER BY updated_at DESC, attempt_number DESC`,
    )
    .all(projectId) as AttemptRow[];
  return rows.map(mapAttempt);
}

export function listTransientAttemptsForProject(projectId: string): RequirementExecutionAttempt[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_execution_attempts
       WHERE project_id = ?
         AND status IN ('assigned', 'dispatched', 'running', 'evaluating', 'verification', 'retry_scheduled')
       ORDER BY updated_at ASC`,
    )
    .all(projectId) as AttemptRow[];
  return rows.map(mapAttempt);
}

export function updateExecutionAttempt(
  id: string,
  input: Partial<{
    runId: string | null;
    status: AttemptStatus;
    modelProvider: string;
    modelName: string;
    startedAt: string | null;
    completedAt: string | null;
    outcome: AttemptOutcome | null;
    failureCategory: FailureCategory | null;
    failureFingerprint: string | null;
    failureSummary: string | null;
    retryable: boolean;
    filesChangedSummary: string;
    commandsExecutedSummary: string;
    testSummary: string;
    qualityGateSummary: string;
    evidenceBundleId: string | null;
    strategy: RetryStrategy;
  }>,
): RequirementExecutionAttempt | null {
  const existing = getExecutionAttemptById(id);
  if (!existing) return null;
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_requirement_execution_attempts SET
        run_id = @run_id,
        status = @status,
        started_at = @started_at,
        completed_at = @completed_at,
        outcome = @outcome,
        failure_category = @failure_category,
        failure_fingerprint = @failure_fingerprint,
        failure_summary = @failure_summary,
        retryable = @retryable,
        files_changed_summary = @files_changed_summary,
        commands_executed_summary = @commands_executed_summary,
        test_summary = @test_summary,
        quality_gate_summary = @quality_gate_summary,
        evidence_bundle_id = @evidence_bundle_id,
        strategy = @strategy,
        model_provider = @model_provider,
        model_name = @model_name,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      run_id: input.runId !== undefined ? input.runId : existing.runId,
      status: input.status ?? existing.status,
      model_provider: input.modelProvider ?? existing.modelProvider,
      model_name: input.modelName ?? existing.modelName,
      started_at: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
      completed_at: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
      outcome: input.outcome !== undefined ? input.outcome : existing.outcome,
      failure_category:
        input.failureCategory !== undefined ? input.failureCategory : existing.failureCategory,
      failure_fingerprint:
        input.failureFingerprint !== undefined
          ? input.failureFingerprint
          : existing.failureFingerprint,
      failure_summary:
        input.failureSummary !== undefined ? input.failureSummary : existing.failureSummary,
      retryable: input.retryable !== undefined ? (input.retryable ? 1 : 0) : existing.retryable ? 1 : 0,
      files_changed_summary: input.filesChangedSummary ?? existing.filesChangedSummary,
      commands_executed_summary: input.commandsExecutedSummary ?? existing.commandsExecutedSummary,
      test_summary: input.testSummary ?? existing.testSummary,
      quality_gate_summary: input.qualityGateSummary ?? existing.qualityGateSummary,
      evidence_bundle_id:
        input.evidenceBundleId !== undefined ? input.evidenceBundleId : existing.evidenceBundleId,
      strategy: input.strategy ?? existing.strategy,
      updated_at: nowIso(),
    });
  return getExecutionAttemptById(id);
}

export function createWorkerAssignment(input: {
  attemptId: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  assignmentJson: string;
  validationStatus?: "valid" | "invalid";
  validationErrors?: string[];
}): WorkerAssignmentRecord {
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT OR REPLACE INTO engineer_worker_assignments
        (id, attempt_id, project_id, requirement_id, task_id, assignment_json,
         validation_status, validation_errors_json, assignment_hash, created_at)
       VALUES
        (@id, @attempt_id, @project_id, @requirement_id, @task_id, @assignment_json,
         @validation_status, @validation_errors_json, @assignment_hash, @created_at)`,
    )
    .run({
      id,
      attempt_id: input.attemptId,
      project_id: input.projectId,
      requirement_id: input.requirementId,
      task_id: input.taskId,
      assignment_json: input.assignmentJson,
      validation_status: input.validationStatus ?? "valid",
      validation_errors_json: JSON.stringify(input.validationErrors ?? []),
      assignment_hash: stableHash(input.assignmentJson),
      created_at: nowIso(),
    });
  return getWorkerAssignmentForAttempt(input.attemptId)!;
}

export function getWorkerAssignmentForAttempt(attemptId: string): WorkerAssignmentRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_worker_assignments WHERE attempt_id = ?`)
    .get(attemptId) as AssignmentRow | undefined;
  return row ? mapAssignment(row) : null;
}

export function createAttemptFailure(input: {
  attemptId: string;
  projectId: string;
  requirementId: string;
  runId?: string | null;
  category: FailureCategory;
  summary: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  fingerprint: string;
  associatedCommand?: string | null;
  affectedFiles?: string[];
}): AttemptFailureRecord {
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_requirement_attempt_failures
        (id, attempt_id, project_id, requirement_id, run_id, category, summary,
         details_json, retryable, fingerprint, associated_command, affected_files_json, created_at)
       VALUES
        (@id, @attempt_id, @project_id, @requirement_id, @run_id, @category, @summary,
         @details_json, @retryable, @fingerprint, @associated_command, @affected_files_json, @created_at)`,
    )
    .run({
      id,
      attempt_id: input.attemptId,
      project_id: input.projectId,
      requirement_id: input.requirementId,
      run_id: input.runId ?? null,
      category: input.category,
      summary: input.summary,
      details_json: JSON.stringify(input.details ?? {}),
      retryable: input.retryable ? 1 : 0,
      fingerprint: input.fingerprint,
      associated_command: input.associatedCommand ?? null,
      affected_files_json: JSON.stringify(input.affectedFiles ?? []),
      created_at: nowIso(),
    });
  return listAttemptFailures(input.attemptId).find((failure) => failure.id === id)!;
}

export function listAttemptFailures(attemptId: string): AttemptFailureRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_attempt_failures
       WHERE attempt_id = ?
       ORDER BY created_at ASC`,
    )
    .all(attemptId) as FailureRow[];
  return rows.map(mapFailure);
}

export function listFailuresForRequirement(requirementId: string): AttemptFailureRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_attempt_failures
       WHERE requirement_id = ?
       ORDER BY created_at ASC`,
    )
    .all(requirementId) as FailureRow[];
  return rows.map(mapFailure);
}

export function createQualityBaseline(input: {
  projectId: string;
  repoPath?: string | null;
  registeredRepoId?: string | null;
  baselineRevision: string;
  baselineJson: string;
  approvedBy?: string;
}): QualityBaselineRecord {
  const id = uuidv4();
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_quality_baselines
        (id, project_id, repo_path, registered_repo_id, baseline_revision,
         baseline_json, baseline_hash, status, approved_by, approved_at, created_at)
       VALUES
        (@id, @project_id, @repo_path, @registered_repo_id, @baseline_revision,
         @baseline_json, @baseline_hash, 'approved', @approved_by, @approved_at, @created_at)`,
    )
    .run({
      id,
      project_id: input.projectId,
      repo_path: input.repoPath ?? null,
      registered_repo_id: input.registeredRepoId ?? null,
      baseline_revision: input.baselineRevision,
      baseline_json: input.baselineJson,
      baseline_hash: stableHash(input.baselineJson),
      approved_by: input.approvedBy ?? "operator",
      approved_at: now,
      created_at: now,
    });
  return getQualityBaselineById(id)!;
}

export function getQualityBaselineById(id: string): QualityBaselineRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_quality_baselines WHERE id = ?`)
    .get(id) as BaselineRow | undefined;
  return row ? mapBaseline(row) : null;
}

export function getLatestApprovedQualityBaseline(
  projectId: string,
): QualityBaselineRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_quality_baselines
       WHERE project_id = ? AND status = 'approved'
       ORDER BY approved_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(projectId) as BaselineRow | undefined;
  return row ? mapBaseline(row) : null;
}

export function createQualityBaselineComparison(input: {
  attemptId: string;
  baselineId?: string | null;
  comparisonJson: string;
  status: QualityBaselineComparisonRecord["status"];
  newFailures?: string[];
  worsenedFailures?: string[];
  repairedFailures?: string[];
}): QualityBaselineComparisonRecord {
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_quality_baseline_comparisons
        (id, attempt_id, baseline_id, comparison_json, status, new_failures_json,
         worsened_failures_json, repaired_failures_json, created_at)
       VALUES
        (@id, @attempt_id, @baseline_id, @comparison_json, @status, @new_failures_json,
         @worsened_failures_json, @repaired_failures_json, @created_at)`,
    )
    .run({
      id,
      attempt_id: input.attemptId,
      baseline_id: input.baselineId ?? null,
      comparison_json: input.comparisonJson,
      status: input.status,
      new_failures_json: JSON.stringify(input.newFailures ?? []),
      worsened_failures_json: JSON.stringify(input.worsenedFailures ?? []),
      repaired_failures_json: JSON.stringify(input.repairedFailures ?? []),
      created_at: nowIso(),
    });
  return getQualityBaselineComparisonForAttempt(input.attemptId)!;
}

export function getQualityBaselineComparisonForAttempt(
  attemptId: string,
): QualityBaselineComparisonRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_quality_baseline_comparisons WHERE attempt_id = ?`)
    .get(attemptId) as BaselineComparisonRow | undefined;
  return row ? mapBaselineComparison(row) : null;
}

export function createVerificationDecision(input: {
  attemptId: string;
  projectId: string;
  requirementId: string;
  verifier?: string;
  verifierModel?: string | null;
  decision: VerificationDecisionRecord["decision"];
  reason: string;
  evidenceSummary?: Record<string, unknown>;
}): VerificationDecisionRecord {
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_requirement_verification_decisions
        (id, attempt_id, project_id, requirement_id, verifier, verifier_model,
         decision, reason, evidence_summary_json, created_at)
       VALUES
        (@id, @attempt_id, @project_id, @requirement_id, @verifier, @verifier_model,
         @decision, @reason, @evidence_summary_json, @created_at)`,
    )
    .run({
      id,
      attempt_id: input.attemptId,
      project_id: input.projectId,
      requirement_id: input.requirementId,
      verifier: input.verifier ?? "vera_verifier",
      verifier_model: input.verifierModel ?? null,
      decision: input.decision,
      reason: input.reason,
      evidence_summary_json: JSON.stringify(input.evidenceSummary ?? {}),
      created_at: nowIso(),
    });
  return listVerificationDecisionsForRequirement(input.requirementId).find(
    (decision) => decision.id === id,
  )!;
}

export function listVerificationDecisionsForRequirement(
  requirementId: string,
): VerificationDecisionRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_requirement_verification_decisions
       WHERE requirement_id = ?
       ORDER BY created_at DESC`,
    )
    .all(requirementId) as VerificationRow[];
  return rows.map(mapVerification);
}
