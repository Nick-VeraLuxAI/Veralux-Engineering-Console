import {
  VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
  VERA_RUNTIME_MODEL_POLICY_RUNTIME_ROLES,
  VERA_RUNTIME_MODEL_POLICY_TASK_CLASSES,
  VERA_RUNTIME_MODEL_POLICY_VERSION,
  type VeraRuntimeModelPolicyRuntimeRole,
  type VeraRuntimeModelPolicyTaskClass,
} from "./vera-runtime-policy-handoff-contract";

export {
  VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
  VERA_RUNTIME_MODEL_POLICY_VERSION,
};

export const VERA_RUNTIME_POLICY_ASSIGNMENT_AUDIT_VERSION =
  "vera_runtime_policy_assignment_audit_v1" as const;

export const VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_SCHEMA_VERSION =
  "vera_runtime_policy_assignment_status_route_v1" as const;

export const VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_STATES = [
  "disabled",
  "missing_config",
  "found",
  "not_found",
  "invalid_request",
  "storage_error",
] as const;

export const VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_LOOKUP_MODES = [
  "assignment_id",
  "request_id",
] as const;

export const VERA_RUNTIME_POLICY_ASSIGNMENT_STATUSES = [
  "recorded",
  "blocked",
  "fallback_required",
  "requires_operator_review",
  "invalid",
] as const;

export const VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_AUTHORITY_FLAGS = [
  "runtime_execution_allowed",
  "provider_calls_allowed",
  "model_calls_allowed",
  "runtime_startup_allowed",
  "mutation_allowed",
  "console_mutation_allowed",
  "git_pr_mutation_allowed",
  "main_tree_mutation_allowed",
  "final_integration_allowed",
] as const;

export type VeraRuntimePolicyAssignmentStatusRouteState =
  (typeof VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_STATES)[number];
export type VeraRuntimePolicyAssignmentStatusRouteLookupMode =
  (typeof VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_LOOKUP_MODES)[number];
export type VeraRuntimePolicyAssignmentStatus =
  (typeof VERA_RUNTIME_POLICY_ASSIGNMENT_STATUSES)[number];

export type VeraRuntimePolicyAssignmentStatusSummary = {
  assignment_id: string;
  request_id: string;
  task_class: VeraRuntimeModelPolicyTaskClass;
  runtime_role: VeraRuntimeModelPolicyRuntimeRole;
  selected_runtime_ref: string | null;
  fallback_state: "none" | "available" | "required";
  status: VeraRuntimePolicyAssignmentStatus;
  audit_required: boolean;
  policy_versions: {
    runtime_policy_version: typeof VERA_RUNTIME_MODEL_POLICY_VERSION;
    handoff_policy_version: typeof VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION;
    assignment_audit_version: typeof VERA_RUNTIME_POLICY_ASSIGNMENT_AUDIT_VERSION;
  };
  safe_reasons: readonly string[];
  non_authorizing_context: {
    authorizes_execution: false;
    authorizes_approval: false;
    authorizes_mutation: false;
    authorizes_console_mutation: false;
    authorizes_main_tree_mutation: false;
    model_or_provider_ref_is_authority: false;
    requires_rbac_for_approval: boolean;
    evidence_verification_grants_approval: false;
    mutation_allowed: false;
    final_integration_authority: false;
    runtime_startup_authorized: false;
    provider_call_authorized: false;
    model_call_authorized: false;
    git_pr_mutation_authorized: false;
  };
  metadata_only: true;
  authorizes_execution: false;
  authorizes_approval: false;
  authorizes_final_integration: false;
  authorizes_console_mutation: false;
  authorizes_main_tree_mutation: false;
  authorizes_git_pr_mutation: false;
  authorizes_provider_call: false;
  authorizes_model_call: false;
  authorizes_runtime_startup: false;
};

export type VeraRuntimePolicyAssignmentStatusRouteResponse = {
  ok: boolean;
  schema_version: typeof VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_SCHEMA_VERSION;
  request_id: string;
  state: VeraRuntimePolicyAssignmentStatusRouteState;
  lookup_mode: VeraRuntimePolicyAssignmentStatusRouteLookupMode | "unknown";
  assignment_status?: VeraRuntimePolicyAssignmentStatusSummary;
  assignments?: readonly VeraRuntimePolicyAssignmentStatusSummary[];
  safe_reason: string;
  error_code?: string;
  errors: string[];
  warnings: string[];
  read_only: true;
  metadata_only: true;
  actions_available_from_ui: false;
  runtime_execution_allowed: false;
  provider_calls_allowed: false;
  model_calls_allowed: false;
  runtime_startup_allowed: false;
  mutation_allowed: false;
  console_mutation_allowed: false;
  git_pr_mutation_allowed: false;
  main_tree_mutation_allowed: false;
  final_integration_allowed: false;
};

export type VeraRuntimePolicyAssignmentStatusValidationErrorCode =
  | "invalid_schema"
  | "unsupported_state"
  | "unsupported_lookup_mode"
  | "unsupported_assignment_status"
  | "unsupported_task_class"
  | "unsupported_runtime_role"
  | "unsupported_capability"
  | "unsupported_binding_state"
  | "unsafe_metadata"
  | "mutation_authority_rejected"
  | "execution_authority_rejected"
  | "provider_authority_rejected"
  | "runtime_startup_rejected"
  | "final_integration_authority_rejected";

export type VeraRuntimePolicyAssignmentStatusValidationError = {
  code: VeraRuntimePolicyAssignmentStatusValidationErrorCode;
  field: string;
  message: string;
};

export type VeraRuntimePolicyAssignmentStatusValidationResult =
  | {
      ok: true;
      validation_state: "metadata_valid";
      response: VeraRuntimePolicyAssignmentStatusRouteResponse;
      errors: [];
      warnings: string[];
      metadata_only: true;
      authorizes_execution: false;
      authorizes_model_call: false;
      authorizes_provider_call: false;
      authorizes_runtime_startup: false;
      authorizes_console_mutation: false;
      authorizes_main_tree_mutation: false;
      authorizes_git_pr_mutation: false;
      authorizes_final_integration: false;
    }
  | {
      ok: false;
      validation_state: "invalid_metadata";
      response?: undefined;
      errors: VeraRuntimePolicyAssignmentStatusValidationError[];
      warnings: string[];
      metadata_only: true;
      authorizes_execution: false;
      authorizes_model_call: false;
      authorizes_provider_call: false;
      authorizes_runtime_startup: false;
      authorizes_console_mutation: false;
      authorizes_main_tree_mutation: false;
      authorizes_git_pr_mutation: false;
      authorizes_final_integration: false;
    };

const TASK_CLASS_SET = new Set<string>(VERA_RUNTIME_MODEL_POLICY_TASK_CLASSES);
const RUNTIME_ROLE_SET = new Set<string>(VERA_RUNTIME_MODEL_POLICY_RUNTIME_ROLES);
const ROUTE_STATE_SET = new Set<string>(VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_STATES);
const LOOKUP_MODE_SET = new Set<string>(VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_LOOKUP_MODES);
const ASSIGNMENT_STATUS_SET = new Set<string>(VERA_RUNTIME_POLICY_ASSIGNMENT_STATUSES);
const SECRET_KEY_PATTERN = /(?:secret|token|credential|password|api[_-]?key|provider[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(?:sk-|pk_|-----BEGIN|bearer\s+[a-z0-9._-]+)/i;
const STORAGE_PATH_KEY_PATTERN =
  /(?:storage_root|storage_root_path|log_path|local_path|absolute_path|filesystem_path|write_path)/i;
const COMMAND_KEY_PATTERN = /(?:startup_command|runtime_start_command|executable_command|shell_command)/i;
const RAW_MODEL_CONFIG_KEY_PATTERN = /(?:raw_model_config|model_config)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function error(
  code: VeraRuntimePolicyAssignmentStatusValidationErrorCode,
  field: string,
  message: string,
): VeraRuntimePolicyAssignmentStatusValidationError {
  return { code, field, message };
}

function invalidResult(
  errors: VeraRuntimePolicyAssignmentStatusValidationError[],
  warnings: string[] = [],
): VeraRuntimePolicyAssignmentStatusValidationResult {
  return {
    ok: false,
    validation_state: "invalid_metadata",
    errors,
    warnings,
    metadata_only: true,
    authorizes_execution: false,
    authorizes_model_call: false,
    authorizes_provider_call: false,
    authorizes_runtime_startup: false,
    authorizes_console_mutation: false,
    authorizes_main_tree_mutation: false,
    authorizes_git_pr_mutation: false,
    authorizes_final_integration: false,
  };
}

function scanUnsafeMetadata(
  value: unknown,
  path = "response",
): VeraRuntimePolicyAssignmentStatusValidationError[] {
  if (!isRecord(value)) return [];
  const errors: VeraRuntimePolicyAssignmentStatusValidationError[] = [];
  for (const [key, item] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "secret or credential field is not allowed."));
    }
    if (STORAGE_PATH_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "storage root/log/path fields are not allowed."));
    }
    if (RAW_MODEL_CONFIG_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "raw model config is not allowed."));
    }
    if (COMMAND_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "executable command fields are not allowed."));
    }
    if (typeof item === "string" && SECRET_VALUE_PATTERN.test(item)) {
      errors.push(error("unsafe_metadata", field, "secret-like value is not allowed."));
    }
    if (isRecord(item)) errors.push(...scanUnsafeMetadata(item, field));
  }
  return errors;
}

function validateFalseField(
  raw: Record<string, unknown>,
  field: string,
  code: VeraRuntimePolicyAssignmentStatusValidationErrorCode,
  prefix: string,
): VeraRuntimePolicyAssignmentStatusValidationError[] {
  return raw[field] === false ? [] : [error(code, `${prefix}.${field}`, `${field} must be false.`)];
}

function validateNonAuthorizingContext(
  raw: unknown,
  prefix: string,
): VeraRuntimePolicyAssignmentStatusValidationError[] {
  if (!isRecord(raw)) {
    return [error("invalid_schema", `${prefix}.non_authorizing_context`, "non_authorizing_context is required.")];
  }
  const errors: VeraRuntimePolicyAssignmentStatusValidationError[] = [];
  const fieldCodes: Array<[string, VeraRuntimePolicyAssignmentStatusValidationErrorCode]> = [
    ["authorizes_execution", "execution_authority_rejected"],
    ["authorizes_approval", "execution_authority_rejected"],
    ["authorizes_mutation", "mutation_authority_rejected"],
    ["authorizes_console_mutation", "mutation_authority_rejected"],
    ["authorizes_main_tree_mutation", "mutation_authority_rejected"],
    ["model_or_provider_ref_is_authority", "provider_authority_rejected"],
    ["evidence_verification_grants_approval", "execution_authority_rejected"],
    ["mutation_allowed", "mutation_authority_rejected"],
    ["final_integration_authority", "final_integration_authority_rejected"],
    ["runtime_startup_authorized", "runtime_startup_rejected"],
    ["provider_call_authorized", "provider_authority_rejected"],
    ["model_call_authorized", "provider_authority_rejected"],
    ["git_pr_mutation_authorized", "mutation_authority_rejected"],
  ];
  for (const [field, code] of fieldCodes) {
    errors.push(...validateFalseField(raw, field, code, `${prefix}.non_authorizing_context`));
  }
  if (typeof raw.requires_rbac_for_approval !== "boolean") {
    errors.push(
      error(
        "invalid_schema",
        `${prefix}.non_authorizing_context.requires_rbac_for_approval`,
        "requires_rbac_for_approval must be boolean.",
      ),
    );
  }
  return errors;
}

function validateStatusSummary(
  raw: unknown,
  prefix: string,
): VeraRuntimePolicyAssignmentStatusValidationError[] {
  if (!isRecord(raw)) return [error("invalid_schema", prefix, "assignment status summary must be an object.")];
  const errors: VeraRuntimePolicyAssignmentStatusValidationError[] = [];
  if (!nonEmptyString(raw.assignment_id)) errors.push(error("invalid_schema", `${prefix}.assignment_id`, "assignment_id is required."));
  if (!nonEmptyString(raw.request_id)) errors.push(error("invalid_schema", `${prefix}.request_id`, "request_id is required."));
  if (!TASK_CLASS_SET.has(String(raw.task_class))) {
    errors.push(error("unsupported_task_class", `${prefix}.task_class`, "unsupported task class."));
  }
  if (!RUNTIME_ROLE_SET.has(String(raw.runtime_role))) {
    errors.push(error("unsupported_runtime_role", `${prefix}.runtime_role`, "unsupported runtime role."));
  }
  if (raw.selected_runtime_ref !== null && typeof raw.selected_runtime_ref !== "string") {
    errors.push(error("invalid_schema", `${prefix}.selected_runtime_ref`, "selected_runtime_ref must be string or null."));
  }
  if (!["none", "available", "required"].includes(String(raw.fallback_state))) {
    errors.push(error("invalid_schema", `${prefix}.fallback_state`, "fallback_state is unsupported."));
  }
  if (!ASSIGNMENT_STATUS_SET.has(String(raw.status))) {
    errors.push(error("unsupported_assignment_status", `${prefix}.status`, "unsupported assignment status."));
  }
  if (typeof raw.audit_required !== "boolean") {
    errors.push(error("invalid_schema", `${prefix}.audit_required`, "audit_required must be boolean."));
  }
  if (!Array.isArray(raw.safe_reasons)) {
    errors.push(error("invalid_schema", `${prefix}.safe_reasons`, "safe_reasons must be an array."));
  }
  if (!isRecord(raw.policy_versions)) {
    errors.push(error("invalid_schema", `${prefix}.policy_versions`, "policy_versions are required."));
  } else {
    if (raw.policy_versions.runtime_policy_version !== VERA_RUNTIME_MODEL_POLICY_VERSION) {
      errors.push(error("invalid_schema", `${prefix}.policy_versions.runtime_policy_version`, "runtime policy version is unsupported."));
    }
    if (raw.policy_versions.handoff_policy_version !== VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION) {
      errors.push(error("invalid_schema", `${prefix}.policy_versions.handoff_policy_version`, "handoff policy version is unsupported."));
    }
    if (raw.policy_versions.assignment_audit_version !== VERA_RUNTIME_POLICY_ASSIGNMENT_AUDIT_VERSION) {
      errors.push(error("invalid_schema", `${prefix}.policy_versions.assignment_audit_version`, "assignment audit version is unsupported."));
    }
  }
  errors.push(...validateNonAuthorizingContext(raw.non_authorizing_context, prefix));
  const falseFields: Array<[string, VeraRuntimePolicyAssignmentStatusValidationErrorCode]> = [
    ["authorizes_execution", "execution_authority_rejected"],
    ["authorizes_approval", "execution_authority_rejected"],
    ["authorizes_final_integration", "final_integration_authority_rejected"],
    ["authorizes_console_mutation", "mutation_authority_rejected"],
    ["authorizes_main_tree_mutation", "mutation_authority_rejected"],
    ["authorizes_git_pr_mutation", "mutation_authority_rejected"],
    ["authorizes_provider_call", "provider_authority_rejected"],
    ["authorizes_model_call", "provider_authority_rejected"],
    ["authorizes_runtime_startup", "runtime_startup_rejected"],
  ];
  for (const [field, code] of falseFields) {
    errors.push(...validateFalseField(raw, field, code, prefix));
  }
  if (raw.metadata_only !== true) {
    errors.push(error("invalid_schema", `${prefix}.metadata_only`, "metadata_only must be true."));
  }
  return errors;
}

function normalizeStatusSummary(raw: Record<string, unknown>): VeraRuntimePolicyAssignmentStatusSummary {
  return {
    assignment_id: String(raw.assignment_id),
    request_id: String(raw.request_id),
    task_class: raw.task_class as VeraRuntimeModelPolicyTaskClass,
    runtime_role: raw.runtime_role as VeraRuntimeModelPolicyRuntimeRole,
    selected_runtime_ref: raw.selected_runtime_ref === null ? null : String(raw.selected_runtime_ref),
    fallback_state: raw.fallback_state as "none" | "available" | "required",
    status: raw.status as VeraRuntimePolicyAssignmentStatus,
    audit_required: Boolean(raw.audit_required),
    policy_versions: raw.policy_versions as VeraRuntimePolicyAssignmentStatusSummary["policy_versions"],
    safe_reasons: [...(raw.safe_reasons as string[])],
    non_authorizing_context: raw.non_authorizing_context as VeraRuntimePolicyAssignmentStatusSummary["non_authorizing_context"],
    metadata_only: true,
    authorizes_execution: false,
    authorizes_approval: false,
    authorizes_final_integration: false,
    authorizes_console_mutation: false,
    authorizes_main_tree_mutation: false,
    authorizes_git_pr_mutation: false,
    authorizes_provider_call: false,
    authorizes_model_call: false,
    authorizes_runtime_startup: false,
  };
}

export function validateVeraRuntimePolicyAssignmentStatusResponse(
  raw: unknown,
): VeraRuntimePolicyAssignmentStatusValidationResult {
  if (!isRecord(raw)) return invalidResult([error("invalid_schema", "response", "response must be an object.")]);
  const errors = scanUnsafeMetadata(raw);
  if (raw.schema_version !== VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_SCHEMA_VERSION) {
    errors.push(error("invalid_schema", "schema_version", "schema_version is unsupported."));
  }
  if (!nonEmptyString(raw.request_id)) errors.push(error("invalid_schema", "request_id", "request_id is required."));
  if (!ROUTE_STATE_SET.has(String(raw.state))) errors.push(error("unsupported_state", "state", "state is unsupported."));
  if (raw.lookup_mode !== "unknown" && !LOOKUP_MODE_SET.has(String(raw.lookup_mode))) {
    errors.push(error("unsupported_lookup_mode", "lookup_mode", "lookup_mode is unsupported."));
  }
  if (!nonEmptyString(raw.safe_reason)) errors.push(error("invalid_schema", "safe_reason", "safe_reason is required."));
  if (!Array.isArray(raw.errors)) errors.push(error("invalid_schema", "errors", "errors must be an array."));
  if (!Array.isArray(raw.warnings)) errors.push(error("invalid_schema", "warnings", "warnings must be an array."));
  if (raw.read_only !== true) errors.push(error("invalid_schema", "read_only", "read_only must be true."));
  if (raw.metadata_only !== true) errors.push(error("invalid_schema", "metadata_only", "metadata_only must be true."));
  if (raw.actions_available_from_ui !== false) {
    errors.push(error("mutation_authority_rejected", "actions_available_from_ui", "actions_available_from_ui must be false."));
  }
  const topFalseFields: Array<[string, VeraRuntimePolicyAssignmentStatusValidationErrorCode]> = [
    ["runtime_execution_allowed", "execution_authority_rejected"],
    ["provider_calls_allowed", "provider_authority_rejected"],
    ["model_calls_allowed", "provider_authority_rejected"],
    ["runtime_startup_allowed", "runtime_startup_rejected"],
    ["mutation_allowed", "mutation_authority_rejected"],
    ["console_mutation_allowed", "mutation_authority_rejected"],
    ["git_pr_mutation_allowed", "mutation_authority_rejected"],
    ["main_tree_mutation_allowed", "mutation_authority_rejected"],
    ["final_integration_allowed", "final_integration_authority_rejected"],
  ];
  for (const [field, code] of topFalseFields) {
    errors.push(...validateFalseField(raw, field, code, "response"));
  }
  if (raw.assignment_status !== undefined) {
    errors.push(...validateStatusSummary(raw.assignment_status, "assignment_status"));
  }
  if (raw.assignments !== undefined) {
    if (!Array.isArray(raw.assignments)) {
      errors.push(error("invalid_schema", "assignments", "assignments must be an array."));
    } else {
      raw.assignments.forEach((item, index) => {
        errors.push(...validateStatusSummary(item, `assignments.${index}`));
      });
    }
  }
  if (errors.length > 0) return invalidResult(errors);

  const response: VeraRuntimePolicyAssignmentStatusRouteResponse = {
    ok: Boolean(raw.ok),
    schema_version: VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_SCHEMA_VERSION,
    request_id: String(raw.request_id),
    state: raw.state as VeraRuntimePolicyAssignmentStatusRouteState,
    lookup_mode: raw.lookup_mode as VeraRuntimePolicyAssignmentStatusRouteLookupMode | "unknown",
    ...(raw.assignment_status && isRecord(raw.assignment_status)
      ? { assignment_status: normalizeStatusSummary(raw.assignment_status) }
      : {}),
    ...(Array.isArray(raw.assignments)
      ? { assignments: raw.assignments.map(item => normalizeStatusSummary(item as Record<string, unknown>)) }
      : {}),
    safe_reason: String(raw.safe_reason),
    ...(typeof raw.error_code === "string" ? { error_code: raw.error_code } : {}),
    errors: [...(raw.errors as string[])],
    warnings: [...(raw.warnings as string[])],
    read_only: true,
    metadata_only: true,
    actions_available_from_ui: false,
    runtime_execution_allowed: false,
    provider_calls_allowed: false,
    model_calls_allowed: false,
    runtime_startup_allowed: false,
    mutation_allowed: false,
    console_mutation_allowed: false,
    git_pr_mutation_allowed: false,
    main_tree_mutation_allowed: false,
    final_integration_allowed: false,
  };
  return {
    ok: true,
    validation_state: "metadata_valid",
    response,
    errors: [],
    warnings: [],
    metadata_only: true,
    authorizes_execution: false,
    authorizes_model_call: false,
    authorizes_provider_call: false,
    authorizes_runtime_startup: false,
    authorizes_console_mutation: false,
    authorizes_main_tree_mutation: false,
    authorizes_git_pr_mutation: false,
    authorizes_final_integration: false,
  };
}
