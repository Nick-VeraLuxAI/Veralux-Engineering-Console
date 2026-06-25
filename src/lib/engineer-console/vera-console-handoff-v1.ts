export const VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION =
  "vera_console_handoff_v1" as const;

export const VERA_CONSOLE_HANDOFF_V1_TASK_LANES = [
  "vera_conversational_suggest_plan",
  "work_order_engineering_handoff",
  "prototype_loop_v1",
  "prototype_implementation_planning",
  "prototype_apply_proposal",
  "prototype_controlled_apply",
  "prototype_integration_candidate",
] as const;

export const VERA_CONSOLE_HANDOFF_V1_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "elevated",
] as const;

export const VERA_CONSOLE_HANDOFF_V1_ROLE_IDS = [
  "vera_command",
  "vera_research",
  "vera_intake",
  "vera_memo",
  "vera_build_router",
  "console_default_worker",
  "console_reviewer",
  "console_senior_reviewer",
  "console_utility",
  "observation_analyzer",
  "workflow_capture_classifier",
  "assessment_analyst",
] as const;

export const VERA_CONSOLE_HANDOFF_V1_RUNTIME_POLICY_VERSION =
  "role_runtime_policy_v1.0" as const;

export type VeraConsoleHandoffV1SchemaVersion =
  typeof VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION;
export type VeraConsoleHandoffV1TaskLane =
  (typeof VERA_CONSOLE_HANDOFF_V1_TASK_LANES)[number];
export type VeraConsoleHandoffV1RiskLevel =
  (typeof VERA_CONSOLE_HANDOFF_V1_RISK_LEVELS)[number];
export type VeraConsoleHandoffV1RoleId =
  (typeof VERA_CONSOLE_HANDOFF_V1_ROLE_IDS)[number];
export type VeraConsoleHandoffV1PrivacyLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "sensitive";
export type VeraConsoleHandoffV1EnforcementMode =
  | "off"
  | "shadow"
  | "parity"
  | "enforce";
export type VeraConsoleHandoffV1VerificationState = "claim_unverified";

export type VeraConsoleHandoffV1BuildScope = {
  target_repo?: string;
  allowed_paths: readonly string[];
  disallowed_paths: readonly string[];
  mutation_allowed: false;
};

export type VeraConsoleHandoffV1EvidenceRef = {
  evidence_ref_id: string;
  evidence_type?: string;
  path_or_uri?: string;
  hash?: string;
  hash_algorithm?: "sha256" | "sha512";
  verification_state: VeraConsoleHandoffV1VerificationState;
};

export type VeraConsoleHandoffV1SourceContextRef = {
  source_context_id: string;
  source_type: string;
  ref: string;
  description?: string;
};

export type VeraConsoleHandoffV1RuntimePolicyRequirements = {
  requested_role?: VeraConsoleHandoffV1RoleId;
  policy_version?: string;
  enforcement_mode?: VeraConsoleHandoffV1EnforcementMode;
  risk_level?: VeraConsoleHandoffV1RiskLevel;
  privacy_level?: VeraConsoleHandoffV1PrivacyLevel;
  fallback_allowed?: boolean;
  cloud_allowed?: boolean;
  requires_audit_record?: boolean;
  decision_audit_ref?: string;
  compliance_note?: string;
};

export type VeraConsoleHandoffV1ApprovalPolicy = {
  implementation_requires_approval: true;
  apply_requires_approval: true;
  integration_requires_approval: true;
  main_tree_mutation_allowed: false;
  approver_role_required?: string;
};

export type VeraConsoleHandoffV1 = {
  schema_version: VeraConsoleHandoffV1SchemaVersion;
  request_id: string;
  user_intent: string;
  task_lane: VeraConsoleHandoffV1TaskLane;
  build_scope: VeraConsoleHandoffV1BuildScope;
  acceptance_criteria: readonly string[];
  constraints: readonly string[];
  risk_level: VeraConsoleHandoffV1RiskLevel;
  evidence_refs: readonly VeraConsoleHandoffV1EvidenceRef[];
  source_context_refs: readonly VeraConsoleHandoffV1SourceContextRef[];
  requested_role: VeraConsoleHandoffV1RoleId;
  runtime_policy_requirements: VeraConsoleHandoffV1RuntimePolicyRequirements;
  approval_policy: VeraConsoleHandoffV1ApprovalPolicy;
  created_at: string;
};

export type VeraConsoleHandoffV1ValidationError = {
  field: string;
  message: string;
};

export type VeraConsoleHandoffV1ValidationResult =
  | {
      ok: true;
      handoff: VeraConsoleHandoffV1;
      evidence_claims_verified: false;
      runtime_policy_metadata_verified: false;
      authorizes_execution: false;
      authorizes_main_tree_mutation: false;
    }
  | {
      ok: false;
      errors: VeraConsoleHandoffV1ValidationError[];
      evidence_claims_verified: false;
      runtime_policy_metadata_verified: false;
      authorizes_execution: false;
      authorizes_main_tree_mutation: false;
    };

const TASK_LANE_SET = new Set<string>(VERA_CONSOLE_HANDOFF_V1_TASK_LANES);
const RISK_LEVEL_SET = new Set<string>(VERA_CONSOLE_HANDOFF_V1_RISK_LEVELS);
const ROLE_ID_SET = new Set<string>(VERA_CONSOLE_HANDOFF_V1_ROLE_IDS);
const ENFORCEMENT_MODE_SET = new Set<string>(["off", "shadow", "parity", "enforce"]);
const PRIVACY_LEVEL_SET = new Set<string>(["none", "low", "medium", "high", "sensitive"]);
const HASH_ALGORITHM_SET = new Set<string>(["sha256", "sha512"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  errors: VeraConsoleHandoffV1ValidationError[],
): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    errors.push({ field, message: `${field} is required.` });
    return "";
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayField(
  record: Record<string, unknown>,
  field: string,
  errors: VeraConsoleHandoffV1ValidationError[],
): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ field, message: `${field} must be a non-empty string array.` });
    return [];
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (normalized.length !== value.length || normalized.length === 0) {
    errors.push({ field, message: `${field} must contain only non-empty strings.` });
  }
  return normalized;
}

function validateBuildScope(
  raw: unknown,
  errors: VeraConsoleHandoffV1ValidationError[],
): VeraConsoleHandoffV1BuildScope {
  if (!isRecord(raw)) {
    errors.push({ field: "build_scope", message: "build_scope must be an object." });
    return { allowed_paths: [], disallowed_paths: [], mutation_allowed: false };
  }
  const allowedPaths = stringArrayField(raw, "allowed_paths", errors);
  const disallowedPaths = stringArrayField(raw, "disallowed_paths", errors);
  if (raw.mutation_allowed !== false) {
    errors.push({
      field: "build_scope.mutation_allowed",
      message: "build_scope.mutation_allowed must be false.",
    });
  }
  return {
    ...(optionalString(raw.target_repo) ? { target_repo: optionalString(raw.target_repo) } : {}),
    allowed_paths: allowedPaths,
    disallowed_paths: disallowedPaths,
    mutation_allowed: false,
  };
}

function validateEvidenceRefs(
  raw: unknown,
  errors: VeraConsoleHandoffV1ValidationError[],
): VeraConsoleHandoffV1EvidenceRef[] {
  if (!Array.isArray(raw)) {
    errors.push({ field: "evidence_refs", message: "evidence_refs must be an array." });
    return [];
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      errors.push({
        field: `evidence_refs.${index}`,
        message: "evidence ref must be an object.",
      });
      return { evidence_ref_id: "", verification_state: "claim_unverified" };
    }
    const evidenceRefId = stringField(item, "evidence_ref_id", errors);
    const hash = optionalString(item.hash);
    const hashAlgorithm = optionalString(item.hash_algorithm);
    if (hashAlgorithm && !HASH_ALGORITHM_SET.has(hashAlgorithm)) {
      errors.push({
        field: `evidence_refs.${index}.hash_algorithm`,
        message: "hash_algorithm must be sha256 or sha512.",
      });
    }
    if (hash && !hashAlgorithm) {
      errors.push({
        field: `evidence_refs.${index}.hash_algorithm`,
        message: "hash_algorithm is required when hash is supplied.",
      });
    }
    if (
      item.verification_state !== undefined &&
      item.verification_state !== "claim_unverified"
    ) {
      errors.push({
        field: `evidence_refs.${index}.verification_state`,
        message: "evidence refs must remain claim_unverified in Phase 4B.",
      });
    }
    return {
      evidence_ref_id: evidenceRefId,
      ...(optionalString(item.evidence_type) ? { evidence_type: optionalString(item.evidence_type) } : {}),
      ...(optionalString(item.path_or_uri) ? { path_or_uri: optionalString(item.path_or_uri) } : {}),
      ...(hash ? { hash } : {}),
      ...(hashAlgorithm && HASH_ALGORITHM_SET.has(hashAlgorithm)
        ? { hash_algorithm: hashAlgorithm as "sha256" | "sha512" }
        : {}),
      verification_state: "claim_unverified",
    };
  });
}

function validateSourceContextRefs(
  raw: unknown,
  errors: VeraConsoleHandoffV1ValidationError[],
): VeraConsoleHandoffV1SourceContextRef[] {
  if (!Array.isArray(raw)) {
    errors.push({
      field: "source_context_refs",
      message: "source_context_refs must be an array.",
    });
    return [];
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      errors.push({
        field: `source_context_refs.${index}`,
        message: "source context ref must be an object.",
      });
      return { source_context_id: "", source_type: "", ref: "" };
    }
    return {
      source_context_id: stringField(item, "source_context_id", errors),
      source_type: stringField(item, "source_type", errors),
      ref: stringField(item, "ref", errors),
      ...(optionalString(item.description) ? { description: optionalString(item.description) } : {}),
    };
  });
}

function validateRuntimePolicyRequirements(
  raw: unknown,
  requestedRole: string,
  riskLevel: string,
  errors: VeraConsoleHandoffV1ValidationError[],
): VeraConsoleHandoffV1RuntimePolicyRequirements {
  if (!isRecord(raw)) {
    errors.push({
      field: "runtime_policy_requirements",
      message: "runtime_policy_requirements must be an object.",
    });
    return {};
  }
  const runtimeRole = optionalString(raw.requested_role);
  if (runtimeRole && runtimeRole !== requestedRole) {
    errors.push({
      field: "runtime_policy_requirements.requested_role",
      message: "runtime_policy_requirements.requested_role must match requested_role.",
    });
  }
  if (runtimeRole && !ROLE_ID_SET.has(runtimeRole)) {
    errors.push({
      field: "runtime_policy_requirements.requested_role",
      message: "runtime policy requested_role is not recognized.",
    });
  }
  const policyVersion = optionalString(raw.policy_version);
  if (policyVersion && policyVersion !== VERA_CONSOLE_HANDOFF_V1_RUNTIME_POLICY_VERSION) {
    errors.push({
      field: "runtime_policy_requirements.policy_version",
      message: "runtime policy version is unsupported.",
    });
  }
  const enforcementMode = optionalString(raw.enforcement_mode);
  if (enforcementMode && !ENFORCEMENT_MODE_SET.has(enforcementMode)) {
    errors.push({
      field: "runtime_policy_requirements.enforcement_mode",
      message: "runtime policy enforcement_mode is unsupported.",
    });
  }
  const runtimeRisk = optionalString(raw.risk_level);
  if (runtimeRisk && runtimeRisk !== riskLevel) {
    errors.push({
      field: "runtime_policy_requirements.risk_level",
      message: "runtime policy risk_level must match handoff risk_level.",
    });
  }
  const privacyLevel = optionalString(raw.privacy_level);
  if (privacyLevel && !PRIVACY_LEVEL_SET.has(privacyLevel)) {
    errors.push({
      field: "runtime_policy_requirements.privacy_level",
      message: "runtime policy privacy_level is unsupported.",
    });
  }
  for (const field of [
    "fallback_allowed",
    "cloud_allowed",
    "requires_audit_record",
  ] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== "boolean") {
      errors.push({
        field: `runtime_policy_requirements.${field}`,
        message: `${field} must be boolean when supplied.`,
      });
    }
  }
  return {
    ...(runtimeRole && ROLE_ID_SET.has(runtimeRole)
      ? { requested_role: runtimeRole as VeraConsoleHandoffV1RoleId }
      : {}),
    ...(policyVersion ? { policy_version: policyVersion } : {}),
    ...(enforcementMode && ENFORCEMENT_MODE_SET.has(enforcementMode)
      ? { enforcement_mode: enforcementMode as VeraConsoleHandoffV1EnforcementMode }
      : {}),
    ...(runtimeRisk && RISK_LEVEL_SET.has(runtimeRisk)
      ? { risk_level: runtimeRisk as VeraConsoleHandoffV1RiskLevel }
      : {}),
    ...(privacyLevel && PRIVACY_LEVEL_SET.has(privacyLevel)
      ? { privacy_level: privacyLevel as VeraConsoleHandoffV1PrivacyLevel }
      : {}),
    ...(typeof raw.fallback_allowed === "boolean"
      ? { fallback_allowed: raw.fallback_allowed }
      : {}),
    ...(typeof raw.cloud_allowed === "boolean" ? { cloud_allowed: raw.cloud_allowed } : {}),
    ...(typeof raw.requires_audit_record === "boolean"
      ? { requires_audit_record: raw.requires_audit_record }
      : {}),
    ...(optionalString(raw.decision_audit_ref)
      ? { decision_audit_ref: optionalString(raw.decision_audit_ref) }
      : {}),
    ...(optionalString(raw.compliance_note)
      ? { compliance_note: optionalString(raw.compliance_note) }
      : {}),
  };
}

function validateApprovalPolicy(
  raw: unknown,
  errors: VeraConsoleHandoffV1ValidationError[],
): VeraConsoleHandoffV1ApprovalPolicy {
  if (!isRecord(raw)) {
    errors.push({ field: "approval_policy", message: "approval_policy must be an object." });
    return {
      implementation_requires_approval: true,
      apply_requires_approval: true,
      integration_requires_approval: true,
      main_tree_mutation_allowed: false,
    };
  }
  const requiredTrueFields = [
    "implementation_requires_approval",
    "apply_requires_approval",
    "integration_requires_approval",
  ] as const;
  for (const field of requiredTrueFields) {
    if (raw[field] !== true) {
      errors.push({
        field: `approval_policy.${field}`,
        message: `${field} must be true.`,
      });
    }
  }
  if (raw.main_tree_mutation_allowed !== false) {
    errors.push({
      field: "approval_policy.main_tree_mutation_allowed",
      message: "main_tree_mutation_allowed must be false.",
    });
  }
  return {
    implementation_requires_approval: true,
    apply_requires_approval: true,
    integration_requires_approval: true,
    main_tree_mutation_allowed: false,
    ...(optionalString(raw.approver_role_required)
      ? { approver_role_required: optionalString(raw.approver_role_required) }
      : {}),
  };
}

export function validateVeraConsoleHandoffV1(
  raw: unknown,
): VeraConsoleHandoffV1ValidationResult {
  const errors: VeraConsoleHandoffV1ValidationError[] = [];
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [{ field: "handoff", message: "handoff must be an object." }],
      evidence_claims_verified: false,
      runtime_policy_metadata_verified: false,
      authorizes_execution: false,
      authorizes_main_tree_mutation: false,
    };
  }

  const schemaVersion = stringField(raw, "schema_version", errors);
  if (schemaVersion && schemaVersion !== VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION) {
    errors.push({
      field: "schema_version",
      message: "schema_version is unsupported.",
    });
  }
  const requestId = stringField(raw, "request_id", errors);
  const userIntent = stringField(raw, "user_intent", errors);
  const taskLane = stringField(raw, "task_lane", errors);
  if (taskLane && !TASK_LANE_SET.has(taskLane)) {
    errors.push({ field: "task_lane", message: "task_lane is unsupported." });
  }
  const acceptanceCriteria = stringArrayField(raw, "acceptance_criteria", errors);
  const constraints = stringArrayField(raw, "constraints", errors);
  const riskLevel = stringField(raw, "risk_level", errors);
  if (riskLevel && !RISK_LEVEL_SET.has(riskLevel)) {
    errors.push({ field: "risk_level", message: "risk_level is unsupported." });
  }
  const requestedRole = stringField(raw, "requested_role", errors);
  if (requestedRole && !ROLE_ID_SET.has(requestedRole)) {
    errors.push({ field: "requested_role", message: "requested_role is unsupported." });
  }
  const createdAt = stringField(raw, "created_at", errors);
  if (createdAt && Number.isNaN(Date.parse(createdAt))) {
    errors.push({ field: "created_at", message: "created_at must be an ISO timestamp." });
  }

  const buildScope = validateBuildScope(raw.build_scope, errors);
  const evidenceRefs = validateEvidenceRefs(raw.evidence_refs, errors);
  const sourceContextRefs = validateSourceContextRefs(raw.source_context_refs, errors);
  const runtimePolicyRequirements = validateRuntimePolicyRequirements(
    raw.runtime_policy_requirements,
    requestedRole,
    riskLevel,
    errors,
  );
  const approvalPolicy = validateApprovalPolicy(raw.approval_policy, errors);

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      evidence_claims_verified: false,
      runtime_policy_metadata_verified: false,
      authorizes_execution: false,
      authorizes_main_tree_mutation: false,
    };
  }

  return {
    ok: true,
    handoff: {
      schema_version: VERA_CONSOLE_HANDOFF_V1_SCHEMA_VERSION,
      request_id: requestId,
      user_intent: userIntent,
      task_lane: taskLane as VeraConsoleHandoffV1TaskLane,
      build_scope: buildScope,
      acceptance_criteria: acceptanceCriteria,
      constraints,
      risk_level: riskLevel as VeraConsoleHandoffV1RiskLevel,
      evidence_refs: evidenceRefs,
      source_context_refs: sourceContextRefs,
      requested_role: requestedRole as VeraConsoleHandoffV1RoleId,
      runtime_policy_requirements: runtimePolicyRequirements,
      approval_policy: approvalPolicy,
      created_at: createdAt,
    },
    evidence_claims_verified: false,
    runtime_policy_metadata_verified: false,
    authorizes_execution: false,
    authorizes_main_tree_mutation: false,
  };
}
