import { createHash } from "node:crypto";

export const VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION =
  "vera_builder_loop_placeholder_module_card_v1" as const;
export const VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE =
  "placeholder_module_card" as const;
export const VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE =
  "metadata_only" as const;
export const VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE =
  "blocked_manual_only" as const;
export const VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY =
  "mirror_validator_only" as const;
export const VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER =
  "Veralux-System" as const;

export type VeraPlaceholderModuleCardRequest = {
  module_card_name: string;
  purpose: string;
  scope: string[];
  constraints: string[];
  risks: string[];
  acceptance_criteria: string[];
  requested_artifact_type: typeof VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE;
  integration_status: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
};

export type VeraPlaceholderModuleCardHandoff = {
  schema_version: typeof VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION;
  source: "veralux-system";
  requested_by: string;
  artifact_type: typeof VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE;
  execution_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE;
  integration_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
  final_integration_authorized: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  system_source_of_truth: true;
  console_metadata_authoritative: false;
  request: VeraPlaceholderModuleCardRequest;
};

export type VeraPlaceholderModuleCardEvidence = {
  evidence_id: string;
  evidence_type: "operator_readable_placeholder_module_card_evidence";
  summary: string;
  acceptance_criteria: string[];
  warnings: string[];
  blockers: string[];
  safety_boundaries: string[];
  metadata_only: true;
  read_only: true;
};

export type VeraPlaceholderModuleCardValidationResult = {
  ok: boolean;
  status: "validated_metadata_only" | "rejected";
  schema_version: typeof VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION;
  canonical_owner: typeof VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER;
  console_boundary: typeof VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY;
  non_authoritative: true;
  metadata_only: true;
  read_only: true;
  errors: string[];
  warnings: string[];
  placeholder_artifact?: VeraPlaceholderModuleCardRequest;
  evidence?: VeraPlaceholderModuleCardEvidence;
  final_integration_blocked_state: "final-integration-default-off";
  execution_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE;
  integration_mode: typeof VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE;
  final_integration_authorized: false;
  repo_mutation_authorized: false;
  branch_creation_authorized: false;
  commit_creation_authorized: false;
  pr_creation_authorized: false;
  deploy_authorized: false;
  merge_authorized: false;
  arbitrary_execution_authorized: false;
  arbitrary_filesystem_path_authorized: false;
  console_metadata_authoritative: false;
};

const FORBIDDEN_KEY_PATTERN =
  /(?:repo(?:sitory)?[_-]?path|target[_-]?repo|worktree|branch(?:[_-]?name)?|commit(?:[_-]?intent)?|pr(?:[_-]?intent)?|pull[_-]?request|deploy(?:[_-]?intent)?|merge|final[_-]?integration(?:[_-]?intent)?|command|commands|shell|executable|filesystem[_-]?path|absolute[_-]?path|arbitrary[_-]?path|write[_-]?path|allowed[_-]?paths|allowed[_-]?commands)/i;
const AUTHORITY_KEY_PATTERN =
  /(?:authorized|authority|allowed|intent|mutation|creation|deploy|merge|integration)$/i;
const SECRET_KEY_PATTERN = /(?:secret|token|credential|password|api[_-]?key|ssh[_-]?key)/i;
const SECRET_VALUE_PATTERN = /(?:^sk-|ghp_|-----BEGIN|bearer\s+[a-z0-9._-]+)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function scanUnsafeMetadata(value: unknown, path = "handoff"): string[] {
  if (!isRecord(value)) return [];
  const errors: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (FORBIDDEN_KEY_PATTERN.test(key) && item !== false) {
      errors.push(`${field} is not allowed on metadata-only placeholder handoffs.`);
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      errors.push(`${field} must not contain secrets or credentials.`);
    }
    if (typeof item === "string" && SECRET_VALUE_PATTERN.test(item.trim())) {
      errors.push(`${field} looks like a secret or credential.`);
    }
    if (AUTHORITY_KEY_PATTERN.test(key) && item === true) {
      errors.push(`${field} cannot grant authority in metadata-only mode.`);
    }
    errors.push(...scanUnsafeMetadata(item, field));
  }
  return errors;
}

function invalid(errors: string[], warnings: string[] = []): VeraPlaceholderModuleCardValidationResult {
  return {
    ok: false,
    status: "rejected",
    schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    canonical_owner: VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER,
    console_boundary: VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY,
    non_authoritative: true,
    metadata_only: true,
    read_only: true,
    errors,
    warnings,
    final_integration_blocked_state: "final-integration-default-off",
    execution_mode: VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
    integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    final_integration_authorized: false,
    repo_mutation_authorized: false,
    branch_creation_authorized: false,
    commit_creation_authorized: false,
    pr_creation_authorized: false,
    deploy_authorized: false,
    merge_authorized: false,
    arbitrary_execution_authorized: false,
    arbitrary_filesystem_path_authorized: false,
    console_metadata_authoritative: false,
  };
}

function evidenceFor(handoff: VeraPlaceholderModuleCardHandoff): VeraPlaceholderModuleCardEvidence {
  const basis = JSON.stringify({
    schema_version: handoff.schema_version,
    requested_by: handoff.requested_by,
    request: handoff.request,
  });
  const evidenceId = `placeholder-card-${createHash("sha256").update(basis).digest("hex").slice(0, 16)}`;
  return {
    evidence_id: evidenceId,
    evidence_type: "operator_readable_placeholder_module_card_evidence",
    summary: `Console validated a read-only placeholder module card proposal for "${handoff.request.module_card_name}". No execution, repo mutation, branch, commit, PR, deploy, or final integration was authorized.`,
    acceptance_criteria: handoff.request.acceptance_criteria,
    warnings: [
      "Console metadata is a mirror validation result only; System remains source of truth for Vera-side state.",
      "This proof does not run build/test execution or validate an isolated worktree.",
    ],
    blockers: [
      "Final integration is blocked/default-off.",
      "Real build/test execution requires a separate workspace-boundary proof before the normal run path can be used.",
    ],
    safety_boundaries: [
      "metadata_only=true",
      "read_only=true",
      "repo_mutation_authorized=false",
      "branch_creation_authorized=false",
      "commit_creation_authorized=false",
      "pr_creation_authorized=false",
      "deploy_authorized=false",
      "final_integration_authorized=false",
    ],
    metadata_only: true,
    read_only: true,
  };
}

export function validateVeraPlaceholderModuleCardHandoff(
  raw: unknown,
): VeraPlaceholderModuleCardValidationResult {
  if (!isRecord(raw)) {
    return invalid(["Handoff must be a JSON object."]);
  }

  const unsafeErrors = scanUnsafeMetadata(raw);
  const request = isRecord(raw.request) ? raw.request : null;
  const errors = [...unsafeErrors];

  if (raw.schema_version !== VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION}.`);
  }
  if (raw.source !== "veralux-system") {
    errors.push('source must be "veralux-system".');
  }
  if (!stringField(raw.requested_by)) {
    errors.push("requested_by is required.");
  }
  if (raw.artifact_type !== VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE) {
    errors.push(`artifact_type must be ${VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE}.`);
  }
  if (raw.execution_mode !== VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE) {
    errors.push(`execution_mode must be ${VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE}.`);
  }
  if (raw.integration_mode !== VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE) {
    errors.push(`integration_mode must be ${VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE}.`);
  }
  for (const field of [
    "final_integration_authorized",
    "repo_mutation_authorized",
    "branch_creation_authorized",
    "commit_creation_authorized",
    "pr_creation_authorized",
    "deploy_authorized",
    "merge_authorized",
    "arbitrary_execution_authorized",
    "arbitrary_filesystem_path_authorized",
    "console_metadata_authoritative",
  ]) {
    if (raw[field] !== false) errors.push(`${field} must be false.`);
  }
  if (raw.system_source_of_truth !== true) {
    errors.push("system_source_of_truth must be true.");
  }
  if (!request) {
    errors.push("request is required.");
  } else {
    if (!stringField(request.module_card_name)) errors.push("request.module_card_name is required.");
    if (!stringField(request.purpose)) errors.push("request.purpose is required.");
    if (stringList(request.scope).length === 0) errors.push("request.scope must include at least one item.");
    if (stringList(request.constraints).length === 0) errors.push("request.constraints must include at least one item.");
    if (stringList(request.risks).length === 0) errors.push("request.risks must include at least one item.");
    if (stringList(request.acceptance_criteria).length === 0) {
      errors.push("request.acceptance_criteria must include at least one item.");
    }
    if (request.requested_artifact_type !== VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE) {
      errors.push(`request.requested_artifact_type must be ${VERA_PLACEHOLDER_MODULE_CARD_ARTIFACT_TYPE}.`);
    }
    if (request.integration_status !== VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE) {
      errors.push(`request.integration_status must be ${VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE}.`);
    }
  }

  if (errors.length > 0) return invalid(errors);

  const handoff = raw as VeraPlaceholderModuleCardHandoff;
  return {
    ok: true,
    status: "validated_metadata_only",
    schema_version: VERA_PLACEHOLDER_MODULE_CARD_SCHEMA_VERSION,
    canonical_owner: VERA_PLACEHOLDER_MODULE_CARD_CANONICAL_OWNER,
    console_boundary: VERA_PLACEHOLDER_MODULE_CARD_CONSOLE_BOUNDARY,
    non_authoritative: true,
    metadata_only: true,
    read_only: true,
    errors: [],
    warnings: [
      "Metadata validation only; no run, task execution, branch, commit, PR, deploy, or final integration was created.",
      "Console metadata is not authoritative for System-owned Vera state.",
    ],
    placeholder_artifact: handoff.request,
    evidence: evidenceFor(handoff),
    final_integration_blocked_state: "final-integration-default-off",
    execution_mode: VERA_PLACEHOLDER_MODULE_CARD_EXECUTION_MODE,
    integration_mode: VERA_PLACEHOLDER_MODULE_CARD_INTEGRATION_MODE,
    final_integration_authorized: false,
    repo_mutation_authorized: false,
    branch_creation_authorized: false,
    commit_creation_authorized: false,
    pr_creation_authorized: false,
    deploy_authorized: false,
    merge_authorized: false,
    arbitrary_execution_authorized: false,
    arbitrary_filesystem_path_authorized: false,
    console_metadata_authoritative: false,
  };
}
