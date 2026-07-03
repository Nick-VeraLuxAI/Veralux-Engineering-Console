import {
  pathMatchesAnyPattern,
  type CustomBoundedCodingTask,
  type ResolvedCodingTaskSpec,
} from "./local-model-coding-task";
import type { VeraLocalModelCodingProofHandoff } from "./local-model-coding-proof-contract";
import {
  isScaffoldFirstTask,
  resolveModelEditablePaths,
} from "./local-model-coding-scaffold";

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

function contentIsPlaceholder(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed === "...") return true;
  if (/^\.{3,}$/.test(trimmed)) return true;
  if (/^<[^>]+>$/.test(trimmed)) return true;
  if (/^<complete-/i.test(trimmed)) return true;
  return false;
}

const FORBIDDEN_CONTENT_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\blog\.(warn|info|error|debug)\b/, message: "Do not use log.*; return warnings instead." },
  { pattern: /\bfrom\s+["']@\/[^"']+["']/, message: "Do not use @/ path aliases." },
  { pattern: /\bbetter-sqlite3\b/, message: "Do not import SQLite." },
  { pattern: /\bfrom\s+["']next\//, message: "Do not import Next.js modules." },
  { pattern: /\bfrom\s+["']react["']/, message: "Do not import React." },
  { pattern: /\bvera-work-order-runner\b/, message: "Do not import Vera work-order services." },
];

function validateFileContent(relativePath: string, content: string): string | null {
  if (contentIsPlaceholder(content)) {
    return `Generated file content is placeholder or empty: ${relativePath}`;
  }
  for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
    if (rule.pattern.test(content)) {
      return `${relativePath}: ${rule.message}`;
    }
  }
  return null;
}

export function listAllowedPathsForTask(
  handoff: VeraLocalModelCodingProofHandoff,
  taskSpec: ResolvedCodingTaskSpec,
): string[] {
  if (handoff.coding_task && isScaffoldFirstTask(handoff.coding_task)) {
    return [...taskSpec.modelEditableRelativePaths];
  }
  if (handoff.coding_task?.expected_files?.length) {
    return [...handoff.coding_task.expected_files];
  }
  if (handoff.coding_task) {
    return handoff.coding_task.allowed_file_patterns.filter((pattern) => !pattern.includes("*"));
  }
  return [...taskSpec.allowedRelativePaths];
}

export function listEvidencePathsForTask(
  handoff: VeraLocalModelCodingProofHandoff,
  taskSpec: ResolvedCodingTaskSpec,
): string[] {
  if (handoff.coding_task?.expected_files?.length) {
    return [...handoff.coding_task.expected_files];
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
  const modelEditable = handoff.coding_task && isScaffoldFirstTask(handoff.coding_task)
    ? new Set(resolveModelEditablePaths(handoff.coding_task))
    : handoff.coding_task?.expected_files?.length
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

    if (taskSpec.scaffoldedRelativePaths.has(relativePath)) {
      errors.push(`Preset scaffold file must not be generated by the model: ${relativePath}`);
      rejected_paths.push(relativePath);
      extra_paths.push(relativePath);
      continue;
    }

    if (modelEditable && !modelEditable.has(relativePath)) {
      errors.push(`Extra generated file is not allowed: ${relativePath}`);
      rejected_paths.push(relativePath);
      extra_paths.push(relativePath);
      continue;
    }

    if (!taskSpec.modelEditableRelativePaths.has(relativePath)
      && !taskSpec.allowedRelativePaths.has(relativePath)) {
      errors.push(`Generated file path is not allowed: ${relativePath}`);
      rejected_paths.push(relativePath);
      continue;
    }

    if (!file.content.trim()) {
      errors.push(`Generated file content is empty: ${relativePath}`);
      rejected_paths.push(relativePath);
      continue;
    }

    const contentError = validateFileContent(relativePath, file.content);
    if (contentError) {
      errors.push(contentError);
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
