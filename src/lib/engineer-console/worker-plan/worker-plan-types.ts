export const WORKER_OPERATION_TYPES = [
  "create_file",
  "update_file",
  "append_file",
] as const;

export type WorkerOperationType = (typeof WORKER_OPERATION_TYPES)[number];

export interface WorkerPlanOperation {
  type: WorkerOperationType;
  path: string;
  content: string;
  reason: string;
}

export interface WorkerPlan {
  runId: string;
  summary: string;
  allowedFiles: string[];
  operations: WorkerPlanOperation[];
}

export interface WorkerPlanValidationOptions {
  allowPackageLock?: boolean;
  allowMigrations?: boolean;
  /** Relative paths from latest file index; used for non-blocking warnings only. */
  indexedFilePaths?: Set<string>;
}

export interface WorkerPlanValidationError {
  code: string;
  message: string;
  path?: string;
  operationIndex?: number;
}

export interface NormalizedWorkerOperation {
  type: WorkerOperationType;
  path: string;
  content: string;
  reason: string;
  absolutePath: string;
}

export interface WorkerPlanValidationResult {
  valid: boolean;
  errors: WorkerPlanValidationError[];
  warnings: WorkerPlanValidationError[];
  normalizedOperations: NormalizedWorkerOperation[];
}

export interface ExecutedWorkerOperation {
  type: WorkerOperationType;
  path: string;
  reason: string;
  absolutePath: string;
}

export interface SkippedWorkerOperation {
  type: WorkerOperationType;
  path: string;
  reason: string;
  error: string;
}

export interface WorkerPlanExecutionError {
  code: string;
  message: string;
  path?: string;
  operationIndex?: number;
}

export interface WorkerPlanExecutionResult {
  success: boolean;
  executedOperations: ExecutedWorkerOperation[];
  skippedOperations: SkippedWorkerOperation[];
  errors: WorkerPlanExecutionError[];
  changedFiles: string[];
}
