export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_MIRROR_VERSION =
  "vera_final_integration_workflow_smoke_mirror_v1" as const;

export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_SYSTEM_OWNER =
  "Veralux-System" as const;
export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CONSOLE_BOUNDARY =
  "mirror_validator_only" as const;
export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CURRENT_BOUNDARY =
  "manual_operator_v1" as const;
export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_FUTURE_VEHICLE =
  "github_pr_workflow" as const;

export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_VALIDATION_STATUSES = [
  "accepted_metadata_only",
  "rejected_unsafe",
] as const;

export const VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_BLOCKED_STATES = [
  "blocked-default-off",
  "dry-run-default-off",
  "final-integration-default-off",
] as const;

export type VeraFinalIntegrationWorkflowSmokeValidationStatus =
  (typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_VALIDATION_STATUSES)[number];

export type VeraFinalIntegrationWorkflowSmokeBlockedState =
  (typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_BLOCKED_STATES)[number];

export type VeraFinalIntegrationWorkflowSmokeMirror = {
  schema_version: typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_MIRROR_VERSION;
  canonical_owner: typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_SYSTEM_OWNER;
  console_boundary: typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CONSOLE_BOUNDARY;
  console_validation_status: VeraFinalIntegrationWorkflowSmokeValidationStatus;
  non_authoritative: true;
  read_only: true;
  metadata_only: true;
  current_final_integration_boundary: typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CURRENT_BOUNDARY;
  intended_future_vehicle: typeof VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_FUTURE_VEHICLE;
  audit_event_id: string;
  rollback_abort_event_id: string;
  github_pr_transport_design_id: string;
  dry_run_readiness_id: string;
  workflow_dry_run_contract_id: string;
  vera_handoff_id: string;
  candidate_id: string;
  evidence_bundle_metadata: string;
  evidence_verification_status: string;
  runtime_policy_audit_id: string;
  approval_state: string;
  integration_state: VeraFinalIntegrationWorkflowSmokeBlockedState;
  dry_run_blocked_default_off_state: VeraFinalIntegrationWorkflowSmokeBlockedState;
  final_integration_blocked_default_off_state: VeraFinalIntegrationWorkflowSmokeBlockedState;
  unsafe_material_absent: true;
  dry_run_execution_allowed: false;
  mutation_allowed: false;
  git_mutation_allowed: false;
  pr_mutation_allowed: false;
  pr_creation_allowed: false;
  branch_creation_allowed: false;
  commit_creation_allowed: false;
  filesystem_write_allowed: false;
  main_tree_mutation_allowed: false;
  console_mutation_allowed: false;
  rollback_execution_allowed: false;
  abort_execution_allowed: false;
  final_integration_authority: false;
};

export type VeraFinalIntegrationWorkflowSmokeMirrorValidationErrorCode =
  | "invalid_schema"
  | "unsupported_status"
  | "unsupported_boundary"
  | "unsupported_vehicle"
  | "unsafe_metadata"
  | "mutation_authority_rejected"
  | "execution_authority_rejected"
  | "git_pr_authority_rejected"
  | "filesystem_authority_rejected"
  | "rollback_abort_authority_rejected"
  | "final_integration_authority_rejected";

export type VeraFinalIntegrationWorkflowSmokeMirrorValidationError = {
  code: VeraFinalIntegrationWorkflowSmokeMirrorValidationErrorCode;
  field: string;
  message: string;
};

export type VeraFinalIntegrationWorkflowSmokeMirrorValidationResult =
  | {
      ok: true;
      validation_state: "metadata_valid";
      mirror: VeraFinalIntegrationWorkflowSmokeMirror;
      errors: [];
      warnings: string[];
      metadata_only: true;
      authorizes_execution: false;
      authorizes_dry_run: false;
      authorizes_console_mutation: false;
      authorizes_main_tree_mutation: false;
      authorizes_git_pr_mutation: false;
      authorizes_filesystem_write: false;
      authorizes_rollback_execution: false;
      authorizes_abort_execution: false;
      authorizes_final_integration: false;
    }
  | {
      ok: false;
      validation_state: "invalid_metadata";
      mirror?: undefined;
      errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[];
      warnings: string[];
      metadata_only: true;
      authorizes_execution: false;
      authorizes_dry_run: false;
      authorizes_console_mutation: false;
      authorizes_main_tree_mutation: false;
      authorizes_git_pr_mutation: false;
      authorizes_filesystem_write: false;
      authorizes_rollback_execution: false;
      authorizes_abort_execution: false;
      authorizes_final_integration: false;
    };

const VALIDATION_STATUS_SET = new Set<string>(
  VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_VALIDATION_STATUSES,
);
const BLOCKED_STATE_SET = new Set<string>(VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_BLOCKED_STATES);
const SECRET_KEY_PATTERN = /(?:secret|token|credential|password|api[_-]?key|ssh[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(?:^sk-|^pk_|ghp_|-----BEGIN|bearer\s+[a-z0-9._-]+)/i;
const PATCH_KEY_PATTERN = /(?:raw_patch|patch_payload|diff_payload)/i;
const COMMAND_KEY_PATTERN = /(?:command|shell|executable|gh_command|git_command)/i;
const PATH_KEY_PATTERN = /(?:unrestricted_local_path|local_path|absolute_path|filesystem_path|write_path)/i;
const PROVIDER_KEY_PATTERN = /(?:provider_credential|provider_credentials)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function error(
  code: VeraFinalIntegrationWorkflowSmokeMirrorValidationErrorCode,
  field: string,
  message: string,
): VeraFinalIntegrationWorkflowSmokeMirrorValidationError {
  return { code, field, message };
}

function invalidResult(
  errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[],
  warnings: string[] = [],
): VeraFinalIntegrationWorkflowSmokeMirrorValidationResult {
  return {
    ok: false,
    validation_state: "invalid_metadata",
    errors,
    warnings,
    metadata_only: true,
    authorizes_execution: false,
    authorizes_dry_run: false,
    authorizes_console_mutation: false,
    authorizes_main_tree_mutation: false,
    authorizes_git_pr_mutation: false,
    authorizes_filesystem_write: false,
    authorizes_rollback_execution: false,
    authorizes_abort_execution: false,
    authorizes_final_integration: false,
  };
}

function authorityError(field: string): VeraFinalIntegrationWorkflowSmokeMirrorValidationError {
  if (field.includes("dry_run") || field.includes("execution")) {
    return error("execution_authority_rejected", field, "execution or dry-run authority is not allowed.");
  }
  if (field.includes("git") || field.includes("pr") || field.includes("branch") || field.includes("commit")) {
    return error("git_pr_authority_rejected", field, "Git/PR authority is not allowed.");
  }
  if (field.includes("filesystem")) {
    return error("filesystem_authority_rejected", field, "filesystem write authority is not allowed.");
  }
  if (field.includes("rollback") || field.includes("abort")) {
    return error("rollback_abort_authority_rejected", field, "rollback/abort execution authority is not allowed.");
  }
  if (field.includes("final_integration")) {
    return error("final_integration_authority_rejected", field, "final integration authority is not allowed.");
  }
  return error("mutation_authority_rejected", field, "mutation authority is not allowed.");
}

function scanUnsafeMetadata(
  value: unknown,
  path = "mirror",
): VeraFinalIntegrationWorkflowSmokeMirrorValidationError[] {
  if (!isRecord(value)) return [];
  const errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[] = [];
  for (const [key, item] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key) || PROVIDER_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "secret, token, credential, or provider credential field is not allowed."));
    }
    if (PATCH_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "raw patch payload fields are not allowed."));
    }
    if (COMMAND_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "executable command fields are not allowed."));
    }
    if (PATH_KEY_PATTERN.test(key)) {
      errors.push(error("unsafe_metadata", field, "unrestricted local path fields are not allowed."));
    }
    if (
      key.startsWith("authorizes_") ||
      key.endsWith("_allowed") ||
      key.endsWith("_authority") ||
      key.endsWith("_authorized") ||
      key === "mutation_allowed"
    ) {
      if (item !== false) errors.push(authorityError(field));
    }
    if (typeof item === "string" && SECRET_VALUE_PATTERN.test(item)) {
      errors.push(error("unsafe_metadata", field, "secret-like value is not allowed."));
    }
    if (isRecord(item)) errors.push(...scanUnsafeMetadata(item, field));
  }
  return errors;
}

function requireString(
  value: unknown,
  field: string,
  errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[],
): string {
  const normalized = nonEmptyString(value);
  if (!normalized) errors.push(error("invalid_schema", field, `${field} is required.`));
  return normalized ?? "";
}

function requireFalse(
  value: unknown,
  field: string,
  errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[],
): false {
  if (value !== false) errors.push(authorityError(field));
  return false;
}

function requireTrue(
  value: unknown,
  field: string,
  errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[],
): true {
  if (value !== true) errors.push(error("invalid_schema", field, `${field} must be true.`));
  return true;
}

export function validateVeraFinalIntegrationWorkflowSmokeMirror(
  input: unknown,
): VeraFinalIntegrationWorkflowSmokeMirrorValidationResult {
  if (!isRecord(input)) {
    return invalidResult([error("invalid_schema", "mirror", "mirror must be an object.")]);
  }

  const errors: VeraFinalIntegrationWorkflowSmokeMirrorValidationError[] = [
    ...scanUnsafeMetadata(input),
  ];

  if (input.schema_version !== VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_MIRROR_VERSION) {
    errors.push(error("invalid_schema", "mirror.schema_version", "unsupported schema version."));
  }
  if (input.canonical_owner !== VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_SYSTEM_OWNER) {
    errors.push(error("invalid_schema", "mirror.canonical_owner", "System must remain canonical."));
  }
  if (input.console_boundary !== VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CONSOLE_BOUNDARY) {
    errors.push(error("unsupported_boundary", "mirror.console_boundary", "Console boundary must be mirror validator only."));
  }
  if (!VALIDATION_STATUS_SET.has(String(input.console_validation_status))) {
    errors.push(error("unsupported_status", "mirror.console_validation_status", "unsupported Console validation status."));
  }
  if (input.console_validation_status !== "accepted_metadata_only") {
    errors.push(error("unsupported_status", "mirror.console_validation_status", "Console may only accept metadata-only mirrors as valid."));
  }
  if (input.current_final_integration_boundary !== VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CURRENT_BOUNDARY) {
    errors.push(error("unsupported_boundary", "mirror.current_final_integration_boundary", "manual operator boundary is required."));
  }
  if (input.intended_future_vehicle !== VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_FUTURE_VEHICLE) {
    errors.push(error("unsupported_vehicle", "mirror.intended_future_vehicle", "github_pr_workflow must remain future-only."));
  }
  if (!BLOCKED_STATE_SET.has(String(input.integration_state)) || input.integration_state !== "blocked-default-off") {
    errors.push(error("invalid_schema", "mirror.integration_state", "integration must remain blocked/default-off."));
  }
  if (
    !BLOCKED_STATE_SET.has(String(input.dry_run_blocked_default_off_state)) ||
    input.dry_run_blocked_default_off_state !== "dry-run-default-off"
  ) {
    errors.push(error("invalid_schema", "mirror.dry_run_blocked_default_off_state", "dry-run must remain default-off."));
  }
  if (
    !BLOCKED_STATE_SET.has(String(input.final_integration_blocked_default_off_state)) ||
    input.final_integration_blocked_default_off_state !== "final-integration-default-off"
  ) {
    errors.push(error("invalid_schema", "mirror.final_integration_blocked_default_off_state", "final integration must remain default-off."));
  }

  const mirror: VeraFinalIntegrationWorkflowSmokeMirror = {
    schema_version: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_MIRROR_VERSION,
    canonical_owner: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_SYSTEM_OWNER,
    console_boundary: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CONSOLE_BOUNDARY,
    console_validation_status: "accepted_metadata_only",
    non_authoritative: requireTrue(input.non_authoritative, "mirror.non_authoritative", errors),
    read_only: requireTrue(input.read_only, "mirror.read_only", errors),
    metadata_only: requireTrue(input.metadata_only, "mirror.metadata_only", errors),
    current_final_integration_boundary: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_CURRENT_BOUNDARY,
    intended_future_vehicle: VERA_FINAL_INTEGRATION_WORKFLOW_SMOKE_FUTURE_VEHICLE,
    audit_event_id: requireString(input.audit_event_id, "mirror.audit_event_id", errors),
    rollback_abort_event_id: requireString(input.rollback_abort_event_id, "mirror.rollback_abort_event_id", errors),
    github_pr_transport_design_id: requireString(
      input.github_pr_transport_design_id,
      "mirror.github_pr_transport_design_id",
      errors,
    ),
    dry_run_readiness_id: requireString(input.dry_run_readiness_id, "mirror.dry_run_readiness_id", errors),
    workflow_dry_run_contract_id: requireString(
      input.workflow_dry_run_contract_id,
      "mirror.workflow_dry_run_contract_id",
      errors,
    ),
    vera_handoff_id: requireString(input.vera_handoff_id, "mirror.vera_handoff_id", errors),
    candidate_id: requireString(input.candidate_id, "mirror.candidate_id", errors),
    evidence_bundle_metadata: requireString(
      input.evidence_bundle_metadata,
      "mirror.evidence_bundle_metadata",
      errors,
    ),
    evidence_verification_status: requireString(
      input.evidence_verification_status,
      "mirror.evidence_verification_status",
      errors,
    ),
    runtime_policy_audit_id: requireString(input.runtime_policy_audit_id, "mirror.runtime_policy_audit_id", errors),
    approval_state: requireString(input.approval_state, "mirror.approval_state", errors),
    integration_state: "blocked-default-off",
    dry_run_blocked_default_off_state: "dry-run-default-off",
    final_integration_blocked_default_off_state: "final-integration-default-off",
    unsafe_material_absent: requireTrue(input.unsafe_material_absent, "mirror.unsafe_material_absent", errors),
    dry_run_execution_allowed: requireFalse(input.dry_run_execution_allowed, "mirror.dry_run_execution_allowed", errors),
    mutation_allowed: requireFalse(input.mutation_allowed, "mirror.mutation_allowed", errors),
    git_mutation_allowed: requireFalse(input.git_mutation_allowed, "mirror.git_mutation_allowed", errors),
    pr_mutation_allowed: requireFalse(input.pr_mutation_allowed, "mirror.pr_mutation_allowed", errors),
    pr_creation_allowed: requireFalse(input.pr_creation_allowed, "mirror.pr_creation_allowed", errors),
    branch_creation_allowed: requireFalse(input.branch_creation_allowed, "mirror.branch_creation_allowed", errors),
    commit_creation_allowed: requireFalse(input.commit_creation_allowed, "mirror.commit_creation_allowed", errors),
    filesystem_write_allowed: requireFalse(input.filesystem_write_allowed, "mirror.filesystem_write_allowed", errors),
    main_tree_mutation_allowed: requireFalse(input.main_tree_mutation_allowed, "mirror.main_tree_mutation_allowed", errors),
    console_mutation_allowed: requireFalse(input.console_mutation_allowed, "mirror.console_mutation_allowed", errors),
    rollback_execution_allowed: requireFalse(input.rollback_execution_allowed, "mirror.rollback_execution_allowed", errors),
    abort_execution_allowed: requireFalse(input.abort_execution_allowed, "mirror.abort_execution_allowed", errors),
    final_integration_authority: requireFalse(input.final_integration_authority, "mirror.final_integration_authority", errors),
  };

  if (errors.length > 0) return invalidResult(errors);

  return {
    ok: true,
    validation_state: "metadata_valid",
    mirror,
    errors: [],
    warnings: [],
    metadata_only: true,
    authorizes_execution: false,
    authorizes_dry_run: false,
    authorizes_console_mutation: false,
    authorizes_main_tree_mutation: false,
    authorizes_git_pr_mutation: false,
    authorizes_filesystem_write: false,
    authorizes_rollback_execution: false,
    authorizes_abort_execution: false,
    authorizes_final_integration: false,
  };
}
