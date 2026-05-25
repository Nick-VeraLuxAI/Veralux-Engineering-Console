import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import type { GetChangedFilesOptions } from "../workspace/git-workspace";
import { normalizeRelativePath } from "./path-safety";
import type { WorkerPlan } from "./worker-plan-types";
import type {
  WorkerPlanExecutionResult,
  WorkerPlanValidationError,
  WorkerPlanValidationResult,
} from "./worker-plan-types";

function nowIso(): string {
  return new Date().toISOString();
}

export interface WorkerPlanRecord {
  id: string;
  runId: string;
  planJson: string;
  summary: string;
  validationStatus: "pending" | "valid" | "invalid";
  validationErrorsJson: string;
  validationWarningsJson: string;
  executionStatus: "pending" | "executed" | "failed" | "skipped";
  executionErrorsJson: string;
  executedOperationsJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerOperationRecord {
  id: string;
  workerPlanId: string;
  operationIndex: number;
  operationType: string;
  path: string;
  reason: string;
  status: "pending" | "executed" | "skipped" | "failed";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkerPlanRow {
  id: string;
  run_id: string;
  plan_json: string;
  summary: string;
  validation_status: string;
  validation_errors_json: string;
  validation_warnings_json: string;
  execution_status: string;
  execution_errors_json: string;
  executed_operations_json: string;
  created_at: string;
  updated_at: string;
}

interface WorkerOperationRow {
  id: string;
  worker_plan_id: string;
  operation_index: number;
  operation_type: string;
  path: string;
  reason: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function mapWorkerPlanRow(row: WorkerPlanRow): WorkerPlanRecord {
  return {
    id: row.id,
    runId: row.run_id,
    planJson: row.plan_json,
    summary: row.summary,
    validationStatus: row.validation_status as WorkerPlanRecord["validationStatus"],
    validationErrorsJson: row.validation_errors_json,
    validationWarningsJson: row.validation_warnings_json,
    executionStatus: row.execution_status as WorkerPlanRecord["executionStatus"],
    executionErrorsJson: row.execution_errors_json,
    executedOperationsJson: row.executed_operations_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkerOperationRow(row: WorkerOperationRow): WorkerOperationRecord {
  return {
    id: row.id,
    workerPlanId: row.worker_plan_id,
    operationIndex: row.operation_index,
    operationType: row.operation_type,
    path: row.path,
    reason: row.reason,
    status: row.status as WorkerOperationRecord["status"],
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createWorkerPlanRecord(runId: string, plan: WorkerPlan): WorkerPlanRecord {
  const db = getEngineerConsoleDb();
  const now = nowIso();
  const record: WorkerPlanRecord = {
    id: uuidv4(),
    runId,
    planJson: JSON.stringify(plan),
    summary: plan.summary,
    validationStatus: "pending",
    validationErrorsJson: "[]",
    validationWarningsJson: "[]",
    executionStatus: "pending",
    executionErrorsJson: "[]",
    executedOperationsJson: "[]",
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO engineer_worker_plans
      (id, run_id, plan_json, summary, validation_status, validation_errors_json,
       validation_warnings_json, execution_status, execution_errors_json,
       executed_operations_json, created_at, updated_at)
     VALUES
      (@id, @run_id, @plan_json, @summary, @validation_status, @validation_errors_json,
       @validation_warnings_json, @execution_status, @execution_errors_json,
       @executed_operations_json, @created_at, @updated_at)`,
  ).run({
    id: record.id,
    run_id: record.runId,
    plan_json: record.planJson,
    summary: record.summary,
    validation_status: record.validationStatus,
    validation_errors_json: record.validationErrorsJson,
    validation_warnings_json: record.validationWarningsJson,
    execution_status: record.executionStatus,
    execution_errors_json: record.executionErrorsJson,
    executed_operations_json: record.executedOperationsJson,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  });

  const insertOp = db.prepare(
    `INSERT INTO engineer_worker_operations
      (id, worker_plan_id, operation_index, operation_type, path, reason, status,
       error_message, created_at, updated_at)
     VALUES
      (@id, @worker_plan_id, @operation_index, @operation_type, @path, @reason, @status,
       @error_message, @created_at, @updated_at)`,
  );

  for (let i = 0; i < plan.operations.length; i++) {
    const operation = plan.operations[i];
    insertOp.run({
      id: uuidv4(),
      worker_plan_id: record.id,
      operation_index: i,
      operation_type: operation.type,
      path: operation.path,
      reason: operation.reason,
      status: "pending",
      error_message: null,
      created_at: now,
      updated_at: now,
    });
  }

  return record;
}

export function updateWorkerPlanValidation(
  workerPlanId: string,
  validation: WorkerPlanValidationResult,
): void {
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_worker_plans SET
        validation_status = @validation_status,
        validation_errors_json = @validation_errors_json,
        validation_warnings_json = @validation_warnings_json,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id: workerPlanId,
      validation_status: validation.valid ? "valid" : "invalid",
      validation_errors_json: JSON.stringify(validation.errors),
      validation_warnings_json: JSON.stringify(validation.warnings),
      updated_at: now,
    });
}

export function updateWorkerPlanExecution(
  workerPlanId: string,
  execution: WorkerPlanExecutionResult,
): void {
  const db = getEngineerConsoleDb();
  const now = nowIso();

  db.prepare(
    `UPDATE engineer_worker_plans SET
      execution_status = @execution_status,
      execution_errors_json = @execution_errors_json,
      executed_operations_json = @executed_operations_json,
      updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id: workerPlanId,
    execution_status: execution.success ? "executed" : "failed",
    execution_errors_json: JSON.stringify(execution.errors),
    executed_operations_json: JSON.stringify(execution.executedOperations),
    updated_at: now,
  });

  const operations = listWorkerOperations(workerPlanId);
  const executedByPath = new Map(
    execution.executedOperations.map((op) => [op.path, op]),
  );
  const skippedByPath = new Map(
    execution.skippedOperations.map((op) => [op.path, op]),
  );

  const updateOp = db.prepare(
    `UPDATE engineer_worker_operations SET
      status = @status,
      error_message = @error_message,
      updated_at = @updated_at
     WHERE id = @id`,
  );

  for (const row of operations) {
    const normalizedPath = normalizeRelativePath(row.path);
    if (executedByPath.has(normalizedPath) || executedByPath.has(row.path)) {
      updateOp.run({
        id: row.id,
        status: "executed",
        error_message: null,
        updated_at: now,
      });
    } else if (skippedByPath.has(normalizedPath) || skippedByPath.has(row.path)) {
      const skipped = skippedByPath.get(normalizedPath) ?? skippedByPath.get(row.path);
      updateOp.run({
        id: row.id,
        status: "skipped",
        error_message: skipped?.error ?? "Skipped",
        updated_at: now,
      });
    } else if (!execution.success) {
      updateOp.run({
        id: row.id,
        status: "failed",
        error_message: "Execution halted before this operation",
        updated_at: now,
      });
    }
  }
}

export function markWorkerPlanExecutionSkipped(workerPlanId: string): void {
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_worker_plans SET
        execution_status = 'skipped',
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({ id: workerPlanId, updated_at: now });
}

export function getLatestWorkerPlanForRun(runId: string): WorkerPlanRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_worker_plans WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as WorkerPlanRow | undefined;
  return row ? mapWorkerPlanRow(row) : null;
}

export function getWorkerPlanById(id: string): WorkerPlanRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_worker_plans WHERE id = ?`)
    .get(id) as WorkerPlanRow | undefined;
  return row ? mapWorkerPlanRow(row) : null;
}

export function listWorkerPlansForRun(runId: string): WorkerPlanRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_worker_plans WHERE run_id = ? ORDER BY created_at DESC`)
    .all(runId) as WorkerPlanRow[];
  return rows.map(mapWorkerPlanRow);
}

export function listWorkerOperations(workerPlanId: string): WorkerOperationRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_worker_operations WHERE worker_plan_id = ? ORDER BY operation_index ASC`,
    )
    .all(workerPlanId) as WorkerOperationRow[];
  return rows.map(mapWorkerOperationRow);
}

export function parseValidationErrors(json: string): WorkerPlanValidationError[] {
  try {
    return JSON.parse(json) as WorkerPlanValidationError[];
  } catch {
    return [];
  }
}

/** Scope untracked-file detection to worker-plan outputs for executed plans. */
export function getWorkerPlanChangedFilesScope(
  runId: string,
): GetChangedFilesOptions | undefined {
  const plan = getLatestWorkerPlanForRun(runId);
  if (!plan || plan.executionStatus !== "executed") {
    return undefined;
  }

  try {
    const ops = JSON.parse(plan.executedOperationsJson) as Array<{ path?: string }>;
    const workerPlanPaths = [
      ...new Set(
        ops
          .map((op) => (op.path ? normalizeRelativePath(op.path) : ""))
          .filter((p) => p.length > 0),
      ),
    ];
    return { workerPlanPaths };
  } catch {
    return { workerPlanPaths: [] };
  }
}
