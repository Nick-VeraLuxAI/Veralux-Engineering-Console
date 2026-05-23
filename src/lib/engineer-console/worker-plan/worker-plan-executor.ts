import fs from "fs";
import path from "path";
import type {
  NormalizedWorkerOperation,
  WorkerPlanExecutionError,
  WorkerPlanExecutionResult,
} from "./worker-plan-types";
import { WorkerPlanSystemError } from "./worker-plan-errors";
import { resolvePathWithinRepo } from "./path-safety";

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function executeOperation(
  repoRoot: string,
  operation: NormalizedWorkerOperation,
  operationIndex: number,
): { ok: true } | { ok: false; error: WorkerPlanExecutionError } {
  const resolved = resolvePathWithinRepo(repoRoot, operation.path);
  if (!resolved.ok) {
    return {
      ok: false,
      error: { ...resolved.error, operationIndex },
    };
  }

  const absolutePath = resolved.resolved.absolutePath;

  if (absolutePath !== operation.absolutePath) {
    return {
      ok: false,
      error: {
        code: "PATH_MISMATCH",
        message: "Resolved path does not match validated operation path",
        path: operation.path,
        operationIndex,
      },
    };
  }

  try {
    switch (operation.type) {
      case "create_file": {
        if (fs.existsSync(absolutePath)) {
          return {
            ok: false,
            error: {
              code: "FILE_EXISTS",
              message: "create_file failed: file already exists",
              path: operation.path,
              operationIndex,
            },
          };
        }
        ensureParentDir(absolutePath);
        fs.writeFileSync(absolutePath, operation.content, "utf8");
        break;
      }
      case "update_file": {
        if (!fs.existsSync(absolutePath)) {
          return {
            ok: false,
            error: {
              code: "FILE_NOT_FOUND",
              message: "update_file failed: file does not exist",
              path: operation.path,
              operationIndex,
            },
          };
        }
        fs.writeFileSync(absolutePath, operation.content, "utf8");
        break;
      }
      case "append_file": {
        if (!fs.existsSync(absolutePath)) {
          return {
            ok: false,
            error: {
              code: "FILE_NOT_FOUND",
              message: "append_file failed: file does not exist",
              path: operation.path,
              operationIndex,
            },
          };
        }
        fs.appendFileSync(absolutePath, operation.content, "utf8");
        break;
      }
      default: {
        return {
          ok: false,
          error: {
            code: "UNKNOWN_OPERATION",
            message: `Unsupported operation type`,
            path: operation.path,
            operationIndex,
          },
        };
      }
    }
    return { ok: true };
  } catch (error) {
    throw new WorkerPlanSystemError(
      `Failed to execute operation at index ${operationIndex}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function executeWorkerPlanOperations(
  repoRoot: string,
  operations: NormalizedWorkerOperation[],
): WorkerPlanExecutionResult {
  const repoResolved = path.resolve(repoRoot);
  const executedOperations: WorkerPlanExecutionResult["executedOperations"] = [];
  const skippedOperations: WorkerPlanExecutionResult["skippedOperations"] = [];
  const errors: WorkerPlanExecutionError[] = [];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    const result = executeOperation(repoResolved, operation, index);

    if (!result.ok) {
      errors.push(result.error);
      skippedOperations.push({
        type: operation.type,
        path: operation.path,
        reason: operation.reason,
        error: result.error.message,
      });
      continue;
    }

    executedOperations.push({
      type: operation.type,
      path: operation.path,
      reason: operation.reason,
      absolutePath: operation.absolutePath,
    });
  }

  const changedFiles = [...new Set(executedOperations.map((op) => op.path))].sort();

  return {
    success: errors.length === 0,
    executedOperations,
    skippedOperations,
    errors,
    changedFiles,
  };
}
