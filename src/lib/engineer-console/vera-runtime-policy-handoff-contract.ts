export const VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION =
  "vera_console_runtime_policy_handoff_v1" as const;
export const VERA_RUNTIME_MODEL_POLICY_VERSION = "vera_runtime_model_policy_v1.0" as const;

export const VERA_RUNTIME_MODEL_POLICY_TASK_CLASSES = [
  "planning",
  "code_generation",
  "code_review",
  "evidence_verification",
  "approval_review",
  "summarization",
  "research",
  "operator_handoff",
  "unknown",
] as const;

export const VERA_RUNTIME_MODEL_POLICY_RUNTIME_ROLES = [
  "command",
  "executor",
  "reviewer",
  "senior_reviewer",
  "utility",
  "fallback",
  "disabled",
] as const;

export const VERA_RUNTIME_MODEL_POLICY_CAPABILITIES = [
  "reasoning",
  "code",
  "tool_use",
  "long_context",
  "local_only",
  "cloud_allowed",
  "sensitive_data_allowed",
  "mutation_allowed",
] as const;

export const VERA_RUNTIME_MODEL_POLICY_BINDING_STATES = [
  "unbound",
  "bound",
  "disabled",
  "fallback_required",
] as const;

export const VERA_RUNTIME_MODEL_POLICY_DECISIONS = [
  "allowed",
  "blocked",
  "fallback_required",
  "requires_operator_review",
] as const;

export const VERA_CONSOLE_RUNTIME_POLICY_FALLBACK_STATES = [
  "none",
  "available",
  "required",
] as const;

export type VeraRuntimeModelPolicyTaskClass =
  (typeof VERA_RUNTIME_MODEL_POLICY_TASK_CLASSES)[number];
export type VeraRuntimeModelPolicyRuntimeRole =
  (typeof VERA_RUNTIME_MODEL_POLICY_RUNTIME_ROLES)[number];
export type VeraRuntimeModelPolicyCapability =
  (typeof VERA_RUNTIME_MODEL_POLICY_CAPABILITIES)[number];
export type VeraRuntimeModelPolicyBindingState =
  (typeof VERA_RUNTIME_MODEL_POLICY_BINDING_STATES)[number];
export type VeraRuntimeModelPolicyDecision =
  (typeof VERA_RUNTIME_MODEL_POLICY_DECISIONS)[number];
export type VeraConsoleRuntimePolicyFallbackState =
  (typeof VERA_CONSOLE_RUNTIME_POLICY_FALLBACK_STATES)[number];

export type VeraConsoleRuntimePolicyNonAuthorizingContext = {
  authorizes_execution: false;
  authorizes_approval: false;
  authorizes_mutation: false;
  authorizes_console_mutation: false;
  authorizes_main_tree_mutation: false;
  model_or_provider_ref_is_authority: false;
  requires_rbac_for_approval: boolean;
  evidence_verification_grants_approval: false;
  mutation_allowed: false;
  runtime_secret_material_included: false;
  provider_credentials_included: false;
  console_must_use_specific_model: false;
};

export type VeraConsoleRuntimePolicyHandoff = {
  schema_version: typeof VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION;
  runtime_policy_version: typeof VERA_RUNTIME_MODEL_POLICY_VERSION;
  request_id: string;
  requested_task_class: VeraRuntimeModelPolicyTaskClass;
  selected_runtime_role: VeraRuntimeModelPolicyRuntimeRole;
  required_capabilities: readonly VeraRuntimeModelPolicyCapability[];
  provider_binding_state: VeraRuntimeModelPolicyBindingState;
  selected_runtime_ref: string | null;
  fallback_runtime_ref: string | null;
  fallback_state: VeraConsoleRuntimePolicyFallbackState;
  decision: VeraRuntimeModelPolicyDecision;
  decision_reason: string;
  audit_required: boolean;
  non_authorizing_context: VeraConsoleRuntimePolicyNonAuthorizingContext;
};

export type VeraConsoleRuntimePolicyHandoffValidationErrorCode =
  | "invalid_schema"
  | "unsupported_policy_version"
  | "unsupported_task_class"
  | "unsupported_runtime_role"
  | "unsupported_capability"
  | "unsupported_binding_state"
  | "unsupported_fallback_state"
  | "unsupported_decision"
  | "unsafe_metadata"
  | "mutation_authority_rejected"
  | "model_provider_authority_rejected";

export type VeraConsoleRuntimePolicyHandoffValidationError = {
  code: VeraConsoleRuntimePolicyHandoffValidationErrorCode;
  field: string;
  message: string;
};

export type VeraConsoleRuntimePolicyHandoffValidationResult =
  | {
      ok: true;
      validation_state: "metadata_valid";
      handoff: VeraConsoleRuntimePolicyHandoff;
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
      handoff?: undefined;
      errors: VeraConsoleRuntimePolicyHandoffValidationError[];
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
const CAPABILITY_SET = new Set<string>(VERA_RUNTIME_MODEL_POLICY_CAPABILITIES);
const BINDING_STATE_SET = new Set<string>(VERA_RUNTIME_MODEL_POLICY_BINDING_STATES);
const DECISION_SET = new Set<string>(VERA_RUNTIME_MODEL_POLICY_DECISIONS);
const FALLBACK_STATE_SET = new Set<string>(VERA_CONSOLE_RUNTIME_POLICY_FALLBACK_STATES);
const SECRET_KEY_PATTERN = /(?:secret|token|credential|password|api[_-]?key|provider[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(?:sk-|pk_|-----BEGIN|bearer\s+[a-z0-9._-]+)/i;
const MODEL_PROVIDER_REQUIREMENT_PATTERN =
  /(?:must_use|mustUse|required_model|requiredModel|required_provider|requiredProvider|provider_name|model_name)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function error(
  code: VeraConsoleRuntimePolicyHandoffValidationErrorCode,
  field: string,
  message: string,
): VeraConsoleRuntimePolicyHandoffValidationError {
  return { code, field, message };
}

function invalidResult(
  errors: VeraConsoleRuntimePolicyHandoffValidationError[],
  warnings: string[] = [],
): VeraConsoleRuntimePolicyHandoffValidationResult {
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

function scanUnsafeMetadata(value: unknown, path = "handoff"): VeraConsoleRuntimePolicyHandoffValidationError[] {
  if (!isRecord(value)) return [];
  const errors: VeraConsoleRuntimePolicyHandoffValidationError[] = [];
  for (const [key, item] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (path !== "handoff.non_authorizing_context") {
      if (SECRET_KEY_PATTERN.test(key)) {
        errors.push(error("unsafe_metadata", field, "secret or credential field is not allowed."));
      }
      if (MODEL_PROVIDER_REQUIREMENT_PATTERN.test(key)) {
        errors.push(
          error(
            "model_provider_authority_rejected",
            field,
            "model/provider requirement fields are not allowed.",
          ),
        );
      }
    }
    if (typeof item === "string" && SECRET_VALUE_PATTERN.test(item)) {
      errors.push(error("unsafe_metadata", field, "secret-like value is not allowed."));
    }
    if (isRecord(item)) errors.push(...scanUnsafeMetadata(item, field));
  }
  return errors;
}

function validateNonAuthorizingContext(
  raw: unknown,
): {
  context: VeraConsoleRuntimePolicyNonAuthorizingContext | null;
  errors: VeraConsoleRuntimePolicyHandoffValidationError[];
} {
  if (!isRecord(raw)) {
    return {
      context: null,
      errors: [
        error(
          "invalid_schema",
          "non_authorizing_context",
          "non_authorizing_context is required.",
        ),
      ],
    };
  }

  const falseFields = [
    "authorizes_execution",
    "authorizes_approval",
    "authorizes_mutation",
    "authorizes_console_mutation",
    "authorizes_main_tree_mutation",
    "model_or_provider_ref_is_authority",
    "evidence_verification_grants_approval",
    "mutation_allowed",
    "runtime_secret_material_included",
    "provider_credentials_included",
    "console_must_use_specific_model",
  ] as const;

  const errors: VeraConsoleRuntimePolicyHandoffValidationError[] = [];
  for (const field of falseFields) {
    if (raw[field] !== false) {
      const code =
        field === "model_or_provider_ref_is_authority" || field === "console_must_use_specific_model"
          ? "model_provider_authority_rejected"
          : "mutation_authority_rejected";
      errors.push(error(code, `non_authorizing_context.${field}`, `${field} must be false.`));
    }
  }

  if (typeof raw.requires_rbac_for_approval !== "boolean") {
    errors.push(
      error(
        "invalid_schema",
        "non_authorizing_context.requires_rbac_for_approval",
        "requires_rbac_for_approval must be boolean.",
      ),
    );
  }

  if (errors.length > 0) return { context: null, errors };

  return {
    context: {
      authorizes_execution: false,
      authorizes_approval: false,
      authorizes_mutation: false,
      authorizes_console_mutation: false,
      authorizes_main_tree_mutation: false,
      model_or_provider_ref_is_authority: false,
      requires_rbac_for_approval: raw.requires_rbac_for_approval,
      evidence_verification_grants_approval: false,
      mutation_allowed: false,
      runtime_secret_material_included: false,
      provider_credentials_included: false,
      console_must_use_specific_model: false,
    },
    errors: [],
  };
}

export function validateVeraRuntimePolicyHandoff(
  raw: unknown,
): VeraConsoleRuntimePolicyHandoffValidationResult {
  if (!isRecord(raw)) {
    return invalidResult([
      error("invalid_schema", "handoff", "runtime policy handoff must be an object."),
    ]);
  }

  const errors: VeraConsoleRuntimePolicyHandoffValidationError[] = [
    ...scanUnsafeMetadata(raw),
  ];

  if (raw.schema_version !== VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION) {
    errors.push(error("invalid_schema", "schema_version", "unsupported handoff schema version."));
  }
  if (raw.runtime_policy_version !== VERA_RUNTIME_MODEL_POLICY_VERSION) {
    errors.push(
      error(
        "unsupported_policy_version",
        "runtime_policy_version",
        "runtime policy version is required and must match the Console mirror.",
      ),
    );
  }

  const requestId = nonEmptyString(raw.request_id);
  if (!requestId) errors.push(error("invalid_schema", "request_id", "request_id is required."));

  const taskClass = nonEmptyString(raw.requested_task_class);
  if (!taskClass) {
    errors.push(
      error("invalid_schema", "requested_task_class", "requested_task_class is required."),
    );
  } else if (!TASK_CLASS_SET.has(taskClass)) {
    errors.push(
      error("unsupported_task_class", "requested_task_class", "unknown task class."),
    );
  }

  const runtimeRole = nonEmptyString(raw.selected_runtime_role);
  if (!runtimeRole) {
    errors.push(
      error("invalid_schema", "selected_runtime_role", "selected_runtime_role is required."),
    );
  } else if (!RUNTIME_ROLE_SET.has(runtimeRole)) {
    errors.push(
      error("unsupported_runtime_role", "selected_runtime_role", "unknown runtime role."),
    );
  }

  const capabilities: VeraRuntimeModelPolicyCapability[] = [];
  if (!Array.isArray(raw.required_capabilities)) {
    errors.push(
      error("invalid_schema", "required_capabilities", "required_capabilities must be an array."),
    );
  } else {
    for (const [index, capability] of raw.required_capabilities.entries()) {
      if (typeof capability !== "string" || !CAPABILITY_SET.has(capability)) {
        errors.push(
          error(
            "unsupported_capability",
            `required_capabilities.${index}`,
            "unknown runtime capability.",
          ),
        );
      } else {
        capabilities.push(capability as VeraRuntimeModelPolicyCapability);
      }
    }
  }

  if (capabilities.includes("mutation_allowed")) {
    errors.push(
      error(
        "mutation_authority_rejected",
        "required_capabilities",
        "Console runtime policy handoff cannot request mutation authority.",
      ),
    );
  }

  const bindingState = nonEmptyString(raw.provider_binding_state);
  if (!bindingState || !BINDING_STATE_SET.has(bindingState)) {
    errors.push(
      error("unsupported_binding_state", "provider_binding_state", "unknown binding state."),
    );
  }

  const fallbackState = nonEmptyString(raw.fallback_state);
  if (!fallbackState || !FALLBACK_STATE_SET.has(fallbackState)) {
    errors.push(
      error("unsupported_fallback_state", "fallback_state", "unknown fallback state."),
    );
  }

  const decision = nonEmptyString(raw.decision);
  if (!decision || !DECISION_SET.has(decision)) {
    errors.push(error("unsupported_decision", "decision", "unknown policy decision."));
  }

  const decisionReason = nonEmptyString(raw.decision_reason);
  if (!decisionReason) {
    errors.push(error("invalid_schema", "decision_reason", "decision_reason is required."));
  }

  if (typeof raw.audit_required !== "boolean") {
    errors.push(error("invalid_schema", "audit_required", "audit_required must be boolean."));
  }

  const selectedRuntimeRef =
    raw.selected_runtime_ref === null ? null : nonEmptyString(raw.selected_runtime_ref);
  if (raw.selected_runtime_ref !== null && !selectedRuntimeRef) {
    errors.push(
      error(
        "invalid_schema",
        "selected_runtime_ref",
        "selected_runtime_ref must be string or null.",
      ),
    );
  }

  const fallbackRuntimeRef =
    raw.fallback_runtime_ref === null ? null : nonEmptyString(raw.fallback_runtime_ref);
  if (raw.fallback_runtime_ref !== null && !fallbackRuntimeRef) {
    errors.push(
      error(
        "invalid_schema",
        "fallback_runtime_ref",
        "fallback_runtime_ref must be string or null.",
      ),
    );
  }

  if (fallbackState === "required" && raw.audit_required !== true) {
    errors.push(
      error("invalid_schema", "audit_required", "fallback-required handoff must require audit."),
    );
  }
  if (fallbackState === "required" && selectedRuntimeRef !== null) {
    errors.push(
      error(
        "invalid_schema",
        "selected_runtime_ref",
        "selected_runtime_ref must be null when fallback is required.",
      ),
    );
  }

  const contextResult = validateNonAuthorizingContext(raw.non_authorizing_context);
  errors.push(...contextResult.errors);

  if (taskClass === "operator_handoff" && capabilities.includes("mutation_allowed")) {
    errors.push(
      error(
        "mutation_authority_rejected",
        "required_capabilities",
        "final integration mutation authority is rejected.",
      ),
    );
  }

  if (errors.length > 0 || !contextResult.context) return invalidResult(errors);

  return {
    ok: true,
    validation_state: "metadata_valid",
    handoff: {
      schema_version: VERA_CONSOLE_RUNTIME_POLICY_HANDOFF_VERSION,
      runtime_policy_version: VERA_RUNTIME_MODEL_POLICY_VERSION,
      request_id: requestId,
      requested_task_class: taskClass as VeraRuntimeModelPolicyTaskClass,
      selected_runtime_role: runtimeRole as VeraRuntimeModelPolicyRuntimeRole,
      required_capabilities: capabilities,
      provider_binding_state: bindingState as VeraRuntimeModelPolicyBindingState,
      selected_runtime_ref: selectedRuntimeRef,
      fallback_runtime_ref: fallbackRuntimeRef,
      fallback_state: fallbackState as VeraConsoleRuntimePolicyFallbackState,
      decision: decision as VeraRuntimeModelPolicyDecision,
      decision_reason: decisionReason,
      audit_required: raw.audit_required,
      non_authorizing_context: contextResult.context,
    },
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
