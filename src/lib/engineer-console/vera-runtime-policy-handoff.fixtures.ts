import {
  VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
  VERA_RUNTIME_MODEL_POLICY_VERSION,
} from "./vera-runtime-policy-handoff-contract";

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
  runtime_secret_material_included: false,
  provider_credentials_included: false,
  console_must_use_specific_model: false,
} as const;

export const validPlanningRuntimePolicyHandoffFixture = {
  schema_version: VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
  runtime_policy_version: VERA_RUNTIME_MODEL_POLICY_VERSION,
  request_id: "runtime-policy-handoff-planning",
  requested_task_class: "planning",
  selected_runtime_role: "command",
  required_capabilities: ["reasoning"],
  provider_binding_state: "bound",
  selected_runtime_ref: "runtime-ref-command-local",
  fallback_runtime_ref: null,
  fallback_state: "none",
  decision: "allowed",
  decision_reason: "runtime_policy_allowed",
  audit_required: false,
  non_authorizing_context: nonAuthorizingContext,
} as const;

export const codeGenerationRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-code-generation",
  requested_task_class: "code_generation",
  selected_runtime_role: "executor",
  required_capabilities: ["reasoning", "code", "tool_use"],
  selected_runtime_ref: "runtime-ref-executor-code",
  audit_required: true,
} as const;

export const seniorReviewRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-senior-review",
  requested_task_class: "code_review",
  selected_runtime_role: "senior_reviewer",
  required_capabilities: ["reasoning", "code"],
  selected_runtime_ref: "runtime-ref-senior-reviewer",
  audit_required: true,
} as const;

export const evidenceVerificationRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-evidence-verification",
  requested_task_class: "evidence_verification",
  selected_runtime_role: "utility",
  required_capabilities: ["reasoning", "tool_use"],
  selected_runtime_ref: "runtime-ref-utility",
  audit_required: true,
} as const;

export const approvalReviewRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-approval-review",
  requested_task_class: "approval_review",
  selected_runtime_role: "reviewer",
  selected_runtime_ref: null,
  fallback_runtime_ref: null,
  fallback_state: "none",
  decision: "requires_operator_review",
  decision_reason: "approval_requires_rbac_context",
  audit_required: true,
  non_authorizing_context: {
    ...nonAuthorizingContext,
    requires_rbac_for_approval: true,
  },
} as const;

export const fallbackRequiredRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-fallback-required",
  provider_binding_state: "fallback_required",
  selected_runtime_ref: null,
  fallback_runtime_ref: "runtime-ref-fallback",
  fallback_state: "required",
  decision: "fallback_required",
  decision_reason: "runtime_binding_missing",
  audit_required: true,
} as const;

export const sensitiveLocalOnlyRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-sensitive-local-only",
  requested_task_class: "research",
  selected_runtime_role: "command",
  required_capabilities: ["reasoning", "long_context", "local_only", "sensitive_data_allowed"],
  selected_runtime_ref: "runtime-ref-sensitive-local",
  audit_required: true,
} as const;

export const rejectedMutationRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-rejected-mutation",
  requested_task_class: "operator_handoff",
  selected_runtime_role: "utility",
  required_capabilities: ["reasoning", "mutation_allowed"],
  selected_runtime_ref: null,
  decision: "blocked",
  decision_reason: "mutation_or_final_integration_not_authorized",
  audit_required: true,
} as const;

export const secretBearingRuntimePolicyHandoffFixture = {
  ...validPlanningRuntimePolicyHandoffFixture,
  request_id: "runtime-policy-handoff-secret-bearing",
  provider_api_key: "sk-test-secret",
} as const;
