import {
  pathMatchesAnyPattern,
  type CustomBoundedCodingTask,
  type ResolvedCodingTaskSpec,
} from "./local-model-coding-task";
import type { VeraLocalModelCodingProofHandoff } from "./local-model-coding-proof-contract";

export type GeneratedFileRecord = {
  relativePath: string;
  content: string;
};

export type GeneratedFileValidationSuccess = {
  ok: true;
  files: GeneratedFileRecord[];
  allowed_paths: string[];
};

export type GeneratedFileValidationFailure = {
  ok: false;
  errors: string[];
  rejected_paths: string[];
  allowed_paths: string[];
  extra_paths: string[];
};

export type GeneratedFileValidationResult =
  | GeneratedFileValidationSuccess
  | GeneratedFileValidationFailure;

function pathIsUnsafe(relativePath: string): boolean {
  const trimmed = relativePath.trim();
  if (!trimmed) return true;
  if (trimmed !== relativePath) return true;
  if (trimmed === "...") return true;
  if (trimmed.includes("..")) return true;
  if (trimmed.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  return false;
}

export function listAllowedPathsForTask(
  handoff: VeraLocalModelCodingProofHandoff,
  taskSpec: ResolvedCodingTaskSpec,
): string[] {
  if (handoff.coding_task?.expected_files?.length) {
    return [...handoff.coding_task.expected_files];
  }
  if (handoff.coding_task) {
    return handoff.coding_task.allowed_file_patterns.filter((pattern) => !pattern.includes("*"));
  }
  return [...taskSpec.allowedRelativePaths];
}

function validateLegacyFilePath(relativePath: string, taskSpec: ResolvedCodingTaskSpec): string | null {
  if (pathIsUnsafe(relativePath)) {
    return `Unsafe generated path: ${relativePath}`;
  }
  if (!taskSpec.allowedRelativePaths.has(relativePath)) {
    return `Generated file path is not allowed: ${relativePath}`;
  }
  return null;
}

function validateCustomFilePath(
  relativePath: string,
  task: CustomBoundedCodingTask,
): string | null {
  if (pathIsUnsafe(relativePath)) {
    return `Unsafe generated path: ${relativePath}`;
  }
  if (pathMatchesAnyPattern(relativePath, task.blocked_file_patterns)) {
    return `Generated file path is blocked: ${relativePath}`;
  }
  if (!pathMatchesAnyPattern(relativePath, task.allowed_file_patterns)) {
    return `Generated file path is not allowed: ${relativePath}`;
  }
  return null;
}

export function validateGeneratedFilesForTask(
  files: GeneratedFileRecord[],
  taskSpec: ResolvedCodingTaskSpec,
  handoff: VeraLocalModelCodingProofHandoff,
): GeneratedFileValidationResult {
  const allowed_paths = listAllowedPathsForTask(handoff, taskSpec);
  const allowedExact = handoff.coding_task?.expected_files?.length
    ? new Set(handoff.coding_task.expected_files)
    : null;
  const errors: string[] = [];
  const rejected_paths: string[] = [];
  const extra_paths: string[] = [];
  const validated: GeneratedFileRecord[] = [];

  if (files.length === 0) {
    return {
      ok: false,
      errors: ["Model output did not include any valid files."],
      rejected_paths,
      allowed_paths,
      extra_paths,
    };
  }

  for (const file of files) {
    const relativePath = file.relativePath.trim();
    const pathError = handoff.coding_task
      ? validateCustomFilePath(relativePath, handoff.coding_task)
      : validateLegacyFilePath(relativePath, taskSpec);

    if (pathError) {
      errors.push(pathError);
      rejected_paths.push(relativePath);
      continue;
    }

    if (allowedExact && !allowedExact.has(relativePath)) {
      errors.push(`Extra generated file is not allowed: ${relativePath}`);
      rejected_paths.push(relativePath);
      extra_paths.push(relativePath);
      continue;
    }

    if (!file.content.trim()) {
      errors.push(`Generated file content is empty: ${relativePath}`);
      rejected_paths.push(relativePath);
      continue;
    }

    validated.push({ relativePath, content: file.content });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      rejected_paths,
      allowed_paths,
      extra_paths,
    };
  }

  return {
    ok: true,
    files: validated,
    allowed_paths,
  };
}
