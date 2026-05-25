import type {
  WorkerPlan,
  WorkerPlanOperation,
  WorkerPlanValidationError,
  WorkerPlanValidationOptions,
  WorkerPlanValidationResult,
} from "./worker-plan-types";
import { WORKER_OPERATION_TYPES } from "./worker-plan-types";
import { isProtectedWorkerPath, resolvePathWithinRepo } from "./path-safety";

const FORBIDDEN_OPERATION_TYPES = new Set([
  "delete_file",
  "remove_file",
  "delete",
  "rm",
  "exec",
  "shell",
  "run_command",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperation(
  raw: unknown,
  index: number,
): { operation?: WorkerPlanOperation; errors: WorkerPlanValidationError[] } {
  const errors: WorkerPlanValidationError[] = [];

  if (!isRecord(raw)) {
    errors.push({
      code: "INVALID_OPERATION",
      message: "Operation must be an object",
      operationIndex: index,
    });
    return { errors };
  }

  const type = raw.type;
  if (typeof type !== "string") {
    errors.push({
      code: "MISSING_OPERATION_TYPE",
      message: "Operation type is required",
      operationIndex: index,
    });
    return { errors };
  }

  if (FORBIDDEN_OPERATION_TYPES.has(type)) {
    errors.push({
      code: "FORBIDDEN_OPERATION",
      message: `Operation type "${type}" is not allowed (file deletion and shell execution are blocked)`,
      operationIndex: index,
    });
    return { errors };
  }

  if (!WORKER_OPERATION_TYPES.includes(type as WorkerPlanOperation["type"])) {
    errors.push({
      code: "UNKNOWN_OPERATION_TYPE",
      message: `Unknown operation type: ${type}`,
      operationIndex: index,
    });
    return { errors };
  }

  const opPath = raw.path;
  if (typeof opPath !== "string" || !opPath.trim()) {
    errors.push({
      code: "EMPTY_PATH",
      message: "Operation path must not be empty",
      operationIndex: index,
    });
    return { errors };
  }

  const content = raw.content;
  if (typeof content !== "string" || content.length === 0) {
    errors.push({
      code: "EMPTY_CONTENT",
      message: "Operation content must not be empty",
      path: opPath,
      operationIndex: index,
    });
    return { errors };
  }

  const reason = typeof raw.reason === "string" ? raw.reason : "";

  return {
    operation: {
      type: type as WorkerPlanOperation["type"],
      path: opPath,
      content,
      reason,
    },
    errors,
  };
}

export function parseWorkerPlanJson(raw: unknown): {
  plan?: WorkerPlan;
  errors: WorkerPlanValidationError[];
} {
  const errors: WorkerPlanValidationError[] = [];

  if (!isRecord(raw)) {
    return {
      errors: [{ code: "INVALID_JSON", message: "Worker plan must be a JSON object" }],
    };
  }

  const runId = raw.runId;
  if (typeof runId !== "string" || !runId.trim()) {
    errors.push({ code: "MISSING_RUN_ID", message: "runId is required" });
  }

  const summary = raw.summary;
  if (typeof summary !== "string") {
    errors.push({ code: "MISSING_SUMMARY", message: "summary must be a string" });
  }

  if (!Array.isArray(raw.allowedFiles)) {
    errors.push({
      code: "INVALID_ALLOWED_FILES",
      message: "allowedFiles must be an array of strings",
    });
  }

  if (!Array.isArray(raw.operations)) {
    errors.push({
      code: "INVALID_OPERATIONS",
      message: "operations must be an array",
    });
  }

  if (errors.length > 0) {
    return { errors };
  }

  const allowedFilesRaw = raw.allowedFiles as unknown[];
  const allowedErrors: WorkerPlanValidationError[] = [];
  const allowedFiles: string[] = [];

  for (let i = 0; i < allowedFilesRaw.length; i++) {
    const entry = allowedFilesRaw[i];
    if (typeof entry !== "string" || !entry.trim()) {
      allowedErrors.push({
        code: "INVALID_ALLOWED_FILE",
        message: `allowedFiles[${i}] must be a non-empty string`,
      });
    } else {
      allowedFiles.push(entry);
    }
  }

  const operations: WorkerPlanOperation[] = [];
  const operationErrors: WorkerPlanValidationError[] = [];

  for (let i = 0; i < (raw.operations as unknown[]).length; i++) {
    const parsed = parseOperation((raw.operations as unknown[])[i], i);
    operationErrors.push(...parsed.errors);
    if (parsed.operation) {
      operations.push(parsed.operation);
    }
  }

  const allErrors = [...errors, ...allowedErrors, ...operationErrors];
  if (allErrors.length > 0) {
    return { errors: allErrors };
  }

  return {
    plan: {
      runId: (runId as string).trim(),
      summary: summary as string,
      allowedFiles,
      operations,
    },
    errors: [],
  };
}

export function validateWorkerPlan(
  plan: WorkerPlan,
  repoRoot: string,
  expectedRunId: string,
  options: WorkerPlanValidationOptions = {},
): WorkerPlanValidationResult {
  const errors: WorkerPlanValidationError[] = [];
  const warnings: WorkerPlanValidationError[] = [];

  if (plan.runId !== expectedRunId) {
    errors.push({
      code: "RUN_ID_MISMATCH",
      message: `Worker plan runId (${plan.runId}) does not match run (${expectedRunId})`,
    });
  }

  if (plan.operations.length === 0) {
    errors.push({
      code: "NO_OPERATIONS",
      message: "Worker plan must include at least one operation",
    });
  }

  const allowedSet = new Set<string>();

  for (let i = 0; i < plan.allowedFiles.length; i++) {
    const resolved = resolvePathWithinRepo(repoRoot, plan.allowedFiles[i]);
    if (!resolved.ok) {
      errors.push({ ...resolved.error, operationIndex: undefined });
      continue;
    }
    const protectedError = isProtectedWorkerPath(resolved.resolved.relativePath, options);
    if (protectedError) {
      errors.push({ ...protectedError });
      continue;
    }
    allowedSet.add(resolved.resolved.relativePath);
  }

  const normalizedOperations: WorkerPlanValidationResult["normalizedOperations"] = [];

  for (let index = 0; index < plan.operations.length; index++) {
    const op = plan.operations[index];
    const resolved = resolvePathWithinRepo(repoRoot, op.path);
    if (!resolved.ok) {
      errors.push({ ...resolved.error, operationIndex: index });
      continue;
    }

    const relativePath = resolved.resolved.relativePath;

    const protectedError = isProtectedWorkerPath(relativePath, options);
    if (protectedError) {
      errors.push({ ...protectedError, operationIndex: index });
      continue;
    }

    if (!allowedSet.has(relativePath)) {
      errors.push({
        code: "NOT_IN_ALLOWED_FILES",
        message: `Path is not listed in allowedFiles: ${relativePath}`,
        path: relativePath,
        operationIndex: index,
      });
      continue;
    }

    if (
      options.indexedFilePaths &&
      options.indexedFilePaths.size > 0 &&
      (op.type === "update_file" || op.type === "append_file") &&
      !options.indexedFilePaths.has(relativePath)
    ) {
      warnings.push({
        code: "FILE_NOT_IN_INDEX",
        message: "Worker plan references file not present in latest index",
        path: relativePath,
        operationIndex: index,
      });
    }

    if (op.type === "create_file" && op.content.length === 0) {
      errors.push({
        code: "EMPTY_CONTENT",
        message: "create_file content must not be empty",
        path: relativePath,
        operationIndex: index,
      });
      continue;
    }

    normalizedOperations.push({
      type: op.type,
      path: relativePath,
      content: op.content,
      reason: op.reason,
      absolutePath: resolved.resolved.absolutePath,
    });
  }

  const duplicatePaths = new Set<string>();
  for (const op of normalizedOperations) {
    if (duplicatePaths.has(op.path)) {
      warnings.push({
        code: "DUPLICATE_PATH",
        message: `Multiple operations target the same path: ${op.path}`,
        path: op.path,
      });
    }
    duplicatePaths.add(op.path);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedOperations,
  };
}

export function validateWorkerPlanPayload(
  raw: unknown,
  repoRoot: string,
  expectedRunId: string,
  options?: WorkerPlanValidationOptions,
): WorkerPlanValidationResult {
  const parsed = parseWorkerPlanJson(raw);
  if (!parsed.plan) {
    return {
      valid: false,
      errors: parsed.errors,
      warnings: [],
      normalizedOperations: [],
    };
  }

  const structural = validateWorkerPlan(parsed.plan, repoRoot, expectedRunId, options);
  if (parsed.errors.length > 0) {
    return {
      valid: false,
      errors: [...parsed.errors, ...structural.errors],
      warnings: structural.warnings,
      normalizedOperations: [],
    };
  }

  return structural;
}
