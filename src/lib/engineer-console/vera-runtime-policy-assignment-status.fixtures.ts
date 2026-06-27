import {
  VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
  VERA_RUNTIME_MODEL_POLICY_VERSION,
  VERA_RUNTIME_POLICY_ASSIGNMENT_AUDIT_VERSION,
  VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_SCHEMA_VERSION,
} from "./vera-runtime-policy-assignment-status-contract";

const nonAuthorizingContext = {
  authorizes_execution: false,
  authorizes_approval: false,
  authorizes_mutation: false,
  authorizes_console_mutation: false,
  authorizes_main_tree_mutation: false,
  model_or_provider_ref_is_authority: false,
  requires_rbac_for_approval: false,
  evidence_verification_grants_approval: false,
  mutation_allowed: false,
  final_integration_authority: false,
  runtime_startup_authorized: false,
  provider_call_authorized: false,
  model_call_authorized: false,
  git_pr_mutation_authorized: false,
} as const;

const policyVersions = {
  runtime_policy_version: VERA_RUNTIME_MODEL_POLICY_VERSION,
  handoff_policy_version: VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
  assignment_audit_version: VERA_RUNTIME_POLICY_ASSIGNMENT_AUDIT_VERSION,
} as const;

const baseStatusSummary = {
  assignment_id: "runtime-assignment-1",
  request_id: "runtime-request-1",
  task_class: "planning",
  runtime_role: "command",
  selected_runtime_ref: "runtime-ref-command-local",
  fallback_state: "none",
  status: "recorded",
  audit_required: false,
  policy_versions: policyVersions,
  safe_reasons: ["allowed"],
  non_authorizing_context: nonAuthorizingContext,
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
} as const;

const baseResponse = {
  ok: true,
  schema_version: VERA_RUNTIME_POLICY_ASSIGNMENT_STATUS_ROUTE_SCHEMA_VERSION,
  request_id: "runtime-status-route-request-1",
  state: "found",
  lookup_mode: "assignment_id",
  safe_reason: "Assignment status found.",
  errors: [],
  warnings: [],
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
} as const;

export const validSingleAssignmentStatusResponseFixture = {
  ...baseResponse,
  assignment_status: baseStatusSummary,
} as const;

export const validRequestAssignmentListStatusResponseFixture = {
  ...baseResponse,
  lookup_mode: "request_id",
  safe_reason: "Assignments found.",
  assignments: [
    baseStatusSummary,
    {
      ...baseStatusSummary,
      assignment_id: "runtime-assignment-2",
      request_id: "runtime-request-1",
      task_class: "code_review",
      runtime_role: "reviewer",
      selected_runtime_ref: "runtime-ref-reviewer",
      audit_required: true,
    },
  ],
} as const;

export const disabledAssignmentStatusResponseFixture = {
  ...baseResponse,
  ok: false,
  state: "disabled",
  lookup_mode: "unknown",
  safe_reason: "Runtime policy assignment status route is disabled.",
  error_code: "route_disabled",
  errors: ["Runtime policy assignment status route is disabled."],
} as const;

export const missingConfigAssignmentStatusResponseFixture = {
  ...baseResponse,
  ok: false,
  state: "missing_config",
  safe_reason: "Runtime policy assignment storage config is missing.",
  error_code: "missing_storage_config",
  errors: ["Runtime policy assignment storage config is missing."],
} as const;

export const notFoundAssignmentStatusResponseFixture = {
  ...baseResponse,
  ok: false,
  state: "not_found",
  safe_reason: "Assignment was not found.",
  error_code: "assignment_not_found",
  errors: ["Assignment was not found."],
} as const;

export const invalidRequestAssignmentStatusResponseFixture = {
  ...baseResponse,
  ok: false,
  state: "invalid_request",
  lookup_mode: "unknown",
  safe_reason: "Exactly one of assignment_id or request_id is required.",
  error_code: "invalid_query",
  errors: ["Exactly one of assignment_id or request_id is required."],
} as const;

export const storageErrorAssignmentStatusResponseFixture = {
  ...baseResponse,
  ok: false,
  state: "storage_error",
  safe_reason: "Assignment status storage read failed.",
  error_code: "storage_error",
  errors: ["Assignment status storage read failed."],
} as const;

export const fallbackRequiredAssignmentStatusResponseFixture = {
  ...baseResponse,
  assignment_status: {
    ...baseStatusSummary,
    assignment_id: "runtime-assignment-fallback",
    selected_runtime_ref: null,
    fallback_state: "required",
    status: "fallback_required",
    audit_required: true,
    safe_reasons: ["runtime_binding_missing"],
  },
} as const;

export const blockedAssignmentStatusResponseFixture = {
  ...baseResponse,
  assignment_status: {
    ...baseStatusSummary,
    assignment_id: "runtime-assignment-blocked",
    selected_runtime_ref: null,
    status: "blocked",
    audit_required: true,
    safe_reasons: ["runtime_disabled"],
  },
} as const;

export const requiresOperatorReviewAssignmentStatusResponseFixture = {
  ...baseResponse,
  assignment_status: {
    ...baseStatusSummary,
    assignment_id: "runtime-assignment-operator-review",
    selected_runtime_ref: null,
    status: "requires_operator_review",
    audit_required: true,
    safe_reasons: ["approval_requires_rbac_context"],
    non_authorizing_context: {
      ...nonAuthorizingContext,
      requires_rbac_for_approval: true,
    },
  },
} as const;

export const invalidAssignmentStatusResponseFixture = {
  ...baseResponse,
  ok: false,
  state: "invalid_request",
  safe_reason: "Assignment status is invalid metadata.",
  error_code: "invalid_assignment_status",
  errors: ["Assignment status is invalid metadata."],
  assignment_status: {
    ...baseStatusSummary,
    assignment_id: "runtime-assignment-invalid",
    selected_runtime_ref: null,
    status: "invalid",
    audit_required: true,
    safe_reasons: ["invalid_task_class"],
  },
} as const;

export const secretBearingAssignmentStatusResponseFixture = {
  ...validSingleAssignmentStatusResponseFixture,
  provider_api_key: "sk-test-secret",
} as const;

export const mutationAuthorityAssignmentStatusResponseFixture = {
  ...validSingleAssignmentStatusResponseFixture,
  mutation_allowed: true,
} as const;

export const storageRootLeakAssignmentStatusResponseFixture = {
  ...validSingleAssignmentStatusResponseFixture,
  storage_root_path: "/var/lib/veralux/runtime-policy",
} as const;
