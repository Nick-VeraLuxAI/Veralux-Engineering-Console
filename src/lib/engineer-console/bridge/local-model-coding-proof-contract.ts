import path from "node:path";
import {
  VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
  VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
  validateVeraPlaceholderModuleCardHandoff,
  type VeraPlaceholderModuleCardHandoff,
} from "./placeholder-module-card-contract";
import type { CustomBoundedCodingTask } from "./local-model-coding-task";

export const VERA_LOCAL_MODEL_CODING_PROOF_SCHEMA_VERSION =
  "vera_builder_loop_local_model_coding_proof_v1" as const;

export const VERA_LOCAL_MODEL_CODING_TASK_ID =
  "format_builder_loop_decision_label_v1" as const;

export const VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID =
  "builder_loop_run_history_v1" as const;

export type VeraLocalModelCodingProofHandoff = VeraPlaceholderModuleCardHandoff & {
  coding_task_id: string;
  builder_loop_mode?: "preview_only" | "code_in_sandbox";
  coding_task?: CustomBoundedCodingTask;
  code_source_repo_root?: string;
};

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function validateCustomCodingTask(raw: unknown): { ok: true; task: CustomBoundedCodingTask } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["coding_task must be an object."] };
  }
  const record = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (record.task_kind !== "custom_bounded_code_task_v1") {
    errors.push("coding_task.task_kind must be custom_bounded_code_task_v1.");
  }
  const codingTaskId = typeof record.coding_task_id === "string" ? record.coding_task_id.trim() : "";
  if (!codingTaskId) errors.push("coding_task.coding_task_id is required.");
  const taskTitle = typeof record.task_title === "string" ? record.task_title.trim() : "";
  if (!taskTitle) errors.push("coding_task.task_title is required.");
  const allowed = normalizeList(record.allowed_file_patterns);
  if (allowed.length === 0) errors.push("coding_task.allowed_file_patterns is required.");
  const tests = normalizeList(record.test_expectations);
  if (tests.length === 0) errors.push("coding_task.test_expectations is required.");
  if (record.integration_intent !== "candidate_only") {
    errors.push("coding_task.integration_intent must be candidate_only.");
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    task: {
      task_kind: "custom_bounded_code_task_v1",
      coding_task_id: codingTaskId,
      task_title: taskTitle,
      requested_change: typeof record.requested_change === "string" ? record.requested_change.trim() : "",
      target_area: typeof record.target_area === "string" ? record.target_area.trim() : "",
      acceptance_criteria: normalizeList(record.acceptance_criteria),
      expected_files: normalizeList(record.expected_files),
      allowed_file_patterns: allowed,
      blocked_file_patterns: normalizeList(record.blocked_file_patterns),
      test_expectations: tests,
      constraints: normalizeList(record.constraints),
      integration_intent: "candidate_only",
    },
  };
}

export function validateVeraLocalModelCodingProofHandoff(raw: unknown): {
  ok: boolean;
  errors: string[];
  warnings: string[];
  handoff?: VeraLocalModelCodingProofHandoff;
} {
  const validation = validateVeraPlaceholderModuleCardHandoff(raw);
  if (!validation.ok || !validation.placeholder_artifact) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const handoff = raw as VeraPlaceholderModuleCardHandoff;
  const errors = [...validation.errors];
  const record = raw as Record<string, unknown>;
  const codingTaskId = typeof record.coding_task_id === "string"
    ? String(record.coding_task_id).trim()
    : "";
  if (!codingTaskId) {
    errors.push("coding_task_id is required.");
  }

  let codingTask: CustomBoundedCodingTask | undefined;
  if (codingTaskId === VERA_LOCAL_MODEL_CODING_TASK_ID) {
    if (record.coding_task !== undefined) {
      errors.push("coding_task must not be sent with the legacy format_builder_loop_decision_label_v1 task.");
    }
  } else {
    const taskValidation = validateCustomCodingTask(record.coding_task);
    if (!taskValidation.ok) {
      errors.push(...taskValidation.errors);
    } else if (taskValidation.task.coding_task_id !== codingTaskId) {
      errors.push("coding_task.coding_task_id must match coding_task_id.");
    } else {
      codingTask = taskValidation.task;
    }
  }

  const codeSourceRepoRoot = typeof record.code_source_repo_root === "string"
    ? record.code_source_repo_root.trim()
    : undefined;
  if (codeSourceRepoRoot && !path.isAbsolute(codeSourceRepoRoot)) {
    errors.push("code_source_repo_root must be an absolute path when provided.");
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings: validation.warnings };
  }

  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    handoff: {
      ...handoff,
      schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
      coding_task_id: codingTaskId,
      ...(typeof record.builder_loop_mode === "string"
        ? { builder_loop_mode: record.builder_loop_mode as "preview_only" | "code_in_sandbox" }
        : {}),
      ...(codingTask ? { coding_task: codingTask } : {}),
      ...(codeSourceRepoRoot ? { code_source_repo_root: codeSourceRepoRoot } : {}),
    },
  };
}
