export type VeraConsoleEvidenceHashAlgorithm = "sha256" | "sha512";

export type VeraConsoleEvidenceArtifactMetadata = Record<
  string,
  string | number | boolean | null | undefined
>;

export const VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID =
  "vera_console_evidence_artifact" as const;

export const VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION =
  "vera_console_evidence_artifact_v1" as const;

export const VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS = [
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
] as const;

export const VERA_CONSOLE_EVIDENCE_ARTIFACT_TYPES = [
  "prototype_loop_evidence",
  "prototype_plan_evidence",
  "prototype_apply_evidence",
  "prototype_integration_evidence",
  "bridge_audit_status",
] as const;

export const VERA_CONSOLE_EVIDENCE_ARTIFACT_CATEGORIES = [
  "console_prototype",
  "bridge_status",
  "runtime_policy",
  "research",
] as const;

export const VERA_CONSOLE_EVIDENCE_ARTIFACT_SENSITIVITY_MARKERS = [
  "none",
  "redacted",
  "sensitive",
] as const;

export type VeraConsoleEvidenceArtifactSchemaId =
  typeof VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID;

export type VeraConsoleEvidenceArtifactSchemaVersion =
  (typeof VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS)[number];

export type VeraConsoleEvidenceArtifactType =
  (typeof VERA_CONSOLE_EVIDENCE_ARTIFACT_TYPES)[number];

export type VeraConsoleEvidenceArtifactCategory =
  (typeof VERA_CONSOLE_EVIDENCE_ARTIFACT_CATEGORIES)[number];

export type VeraConsoleEvidenceArtifactSensitivityMarker =
  (typeof VERA_CONSOLE_EVIDENCE_ARTIFACT_SENSITIVITY_MARKERS)[number];

export type VeraConsoleEvidenceArtifactSourceContext = {
  source_system: string;
  source_context: string;
};

export type VeraConsoleEvidenceArtifactLineage = {
  evidence_ref_id?: string;
  request_id?: string;
  task_id?: string;
  run_id?: string;
  parent_artifact_ids?: readonly string[];
};

export type VeraConsoleEvidenceArtifactV1 = {
  schema_id: VeraConsoleEvidenceArtifactSchemaId;
  schema_version: VeraConsoleEvidenceArtifactSchemaVersion;
  artifact_id: string;
  artifact_type: VeraConsoleEvidenceArtifactType;
  artifact_category: VeraConsoleEvidenceArtifactCategory;
  created_at?: string;
  generated_at?: string;
  source: VeraConsoleEvidenceArtifactSourceContext;
  evidence_lineage: VeraConsoleEvidenceArtifactLineage;
  content_hash?: string;
  hash_algorithm?: VeraConsoleEvidenceHashAlgorithm;
  metadata?: VeraConsoleEvidenceArtifactMetadata;
  sensitivity: VeraConsoleEvidenceArtifactSensitivityMarker;
};

export type VeraConsoleEvidenceArtifactValidationErrorCode =
  | "invalid_schema"
  | "unsupported_schema_version"
  | "unsupported_artifact_type"
  | "unsupported_artifact_category"
  | "unsupported_hash_algorithm";

export type VeraConsoleEvidenceArtifactValidationError = {
  code: VeraConsoleEvidenceArtifactValidationErrorCode;
  field: string;
  message: string;
};

export type VeraConsoleEvidenceArtifactValidationState = "schema_valid" | "invalid_schema";

export type VeraConsoleEvidenceArtifactValidationOptions = {
  require_content_hash?: boolean;
  supported_schema_versions?: readonly string[];
};

export type VeraConsoleEvidenceArtifactValidationValue = {
  artifact_id: string;
  schema_id: VeraConsoleEvidenceArtifactSchemaId;
  schema_version: VeraConsoleEvidenceArtifactSchemaVersion;
  artifact_type: VeraConsoleEvidenceArtifactType;
  artifact_category: VeraConsoleEvidenceArtifactCategory;
  timestamp: string;
  source: VeraConsoleEvidenceArtifactSourceContext;
  evidence_lineage: VeraConsoleEvidenceArtifactLineage;
  content_hash?: string;
  hash_algorithm?: VeraConsoleEvidenceHashAlgorithm;
  metadata: VeraConsoleEvidenceArtifactMetadata;
  sensitivity: VeraConsoleEvidenceArtifactSensitivityMarker;
  caller_metadata_trusted: false;
  hash_trusted: false;
};

export type VeraConsoleEvidenceArtifactValidationResult =
  | {
      ok: true;
      validation_state: "schema_valid";
      verification_state: "unverified";
      artifact: VeraConsoleEvidenceArtifactValidationValue;
      errors: [];
      warnings: string[];
      authorizes_execution: false;
      authorizes_main_tree_mutation: false;
    }
  | {
      ok: false;
      validation_state: "invalid_schema";
      verification_state: "invalid_schema";
      artifact?: undefined;
      errors: VeraConsoleEvidenceArtifactValidationError[];
      warnings: string[];
      authorizes_execution: false;
      authorizes_main_tree_mutation: false;
    };

const SUPPORTED_SCHEMA_VERSION_SET = new Set<string>(
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS,
);
const SUPPORTED_ARTIFACT_TYPE_SET = new Set<string>(VERA_CONSOLE_EVIDENCE_ARTIFACT_TYPES);
const SUPPORTED_ARTIFACT_CATEGORY_SET = new Set<string>(
  VERA_CONSOLE_EVIDENCE_ARTIFACT_CATEGORIES,
);
const SUPPORTED_SENSITIVITY_SET = new Set<string>(
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SENSITIVITY_MARKERS,
);
const SUPPORTED_HASH_ALGORITHM_SET = new Set<string>(["sha256", "sha512"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validIsoTimestamp(value: unknown): string | null {
  const timestamp = nonEmptyString(value);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;
  return timestamp;
}

function optionalScalar(value: unknown): string | number | boolean | null | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return undefined;
}

function error(
  code: VeraConsoleEvidenceArtifactValidationErrorCode,
  field: string,
  message: string,
): VeraConsoleEvidenceArtifactValidationError {
  return { code, field, message };
}

export function createInvalidEvidenceArtifactResult(
  errors: VeraConsoleEvidenceArtifactValidationError[],
  warnings: string[] = [],
): VeraConsoleEvidenceArtifactValidationResult {
  return {
    ok: false,
    validation_state: "invalid_schema",
    verification_state: "invalid_schema",
    errors,
    warnings,
    authorizes_execution: false,
    authorizes_main_tree_mutation: false,
  };
}

export function isSupportedEvidenceArtifactSchemaVersion(
  schemaVersion: unknown,
  supportedSchemaVersions: readonly string[] = VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS,
): schemaVersion is VeraConsoleEvidenceArtifactSchemaVersion {
  return typeof schemaVersion === "string" && supportedSchemaVersions.includes(schemaVersion);
}

export function normalizeEvidenceArtifactMetadata(
  metadata: unknown,
): VeraConsoleEvidenceArtifactMetadata {
  if (!isRecord(metadata)) return {};
  const normalized: VeraConsoleEvidenceArtifactMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    const scalar = optionalScalar(value);
    if (scalar !== undefined) normalized[key] = scalar;
  }
  return normalized;
}

function validateSource(raw: unknown): {
  source: VeraConsoleEvidenceArtifactSourceContext | null;
  errors: VeraConsoleEvidenceArtifactValidationError[];
} {
  if (!isRecord(raw)) {
    return {
      source: null,
      errors: [error("invalid_schema", "source", "source context is required.")],
    };
  }
  const sourceSystem = nonEmptyString(raw.source_system);
  const sourceContext = nonEmptyString(raw.source_context);
  const errors: VeraConsoleEvidenceArtifactValidationError[] = [];
  if (!sourceSystem) {
    errors.push(error("invalid_schema", "source.source_system", "source_system is required."));
  }
  if (!sourceContext) {
    errors.push(error("invalid_schema", "source.source_context", "source_context is required."));
  }
  return {
    source: sourceSystem && sourceContext ? { source_system: sourceSystem, source_context: sourceContext } : null,
    errors,
  };
}

function validateLineage(raw: unknown): {
  lineage: VeraConsoleEvidenceArtifactLineage | null;
  errors: VeraConsoleEvidenceArtifactValidationError[];
} {
  if (!isRecord(raw)) {
    return {
      lineage: null,
      errors: [error("invalid_schema", "evidence_lineage", "evidence_lineage is required.")],
    };
  }
  const evidenceRefId = nonEmptyString(raw.evidence_ref_id) ?? undefined;
  const requestId = nonEmptyString(raw.request_id) ?? undefined;
  const taskId = nonEmptyString(raw.task_id) ?? undefined;
  const runId = nonEmptyString(raw.run_id) ?? undefined;
  const parentArtifactIds = Array.isArray(raw.parent_artifact_ids)
    ? raw.parent_artifact_ids.filter((item): item is string => Boolean(nonEmptyString(item)))
    : undefined;

  if (!evidenceRefId && !requestId && !taskId && !runId && !parentArtifactIds?.length) {
    return {
      lineage: null,
      errors: [
        error(
          "invalid_schema",
          "evidence_lineage",
          "evidence_lineage must include at least one identifier.",
        ),
      ],
    };
  }

  return {
    lineage: {
      ...(evidenceRefId ? { evidence_ref_id: evidenceRefId } : {}),
      ...(requestId ? { request_id: requestId } : {}),
      ...(taskId ? { task_id: taskId } : {}),
      ...(runId ? { run_id: runId } : {}),
      ...(parentArtifactIds?.length ? { parent_artifact_ids: parentArtifactIds } : {}),
    },
    errors: [],
  };
}

export function validateEvidenceArtifactSchema(
  raw: unknown,
  options: VeraConsoleEvidenceArtifactValidationOptions = {},
): VeraConsoleEvidenceArtifactValidationResult {
  if (!isRecord(raw)) {
    return createInvalidEvidenceArtifactResult([
      error("invalid_schema", "artifact", "artifact must be a JSON object."),
    ]);
  }

  const requireContentHash = options.require_content_hash ?? true;
  const supportedSchemaVersions =
    options.supported_schema_versions ?? VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS;
  const errors: VeraConsoleEvidenceArtifactValidationError[] = [];

  if (raw.schema_id !== VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID) {
    errors.push(error("invalid_schema", "schema_id", "schema_id is required."));
  }

  const schemaVersion = nonEmptyString(raw.schema_version);
  if (!schemaVersion) {
    errors.push(error("invalid_schema", "schema_version", "schema_version is required."));
  } else if (
    !SUPPORTED_SCHEMA_VERSION_SET.has(schemaVersion) ||
    !supportedSchemaVersions.includes(schemaVersion)
  ) {
    errors.push(
      error(
        "unsupported_schema_version",
        "schema_version",
        `unsupported schema_version: ${schemaVersion}.`,
      ),
    );
  }

  const artifactId = nonEmptyString(raw.artifact_id);
  if (!artifactId) {
    errors.push(error("invalid_schema", "artifact_id", "artifact_id is required."));
  }

  const artifactType = nonEmptyString(raw.artifact_type);
  if (!artifactType) {
    errors.push(error("invalid_schema", "artifact_type", "artifact_type is required."));
  } else if (!SUPPORTED_ARTIFACT_TYPE_SET.has(artifactType)) {
    errors.push(
      error("unsupported_artifact_type", "artifact_type", `unsupported artifact_type: ${artifactType}.`),
    );
  }

  const artifactCategory = nonEmptyString(raw.artifact_category);
  if (!artifactCategory) {
    errors.push(error("invalid_schema", "artifact_category", "artifact_category is required."));
  } else if (!SUPPORTED_ARTIFACT_CATEGORY_SET.has(artifactCategory)) {
    errors.push(
      error(
        "unsupported_artifact_category",
        "artifact_category",
        `unsupported artifact_category: ${artifactCategory}.`,
      ),
    );
  }

  const timestamp = validIsoTimestamp(raw.generated_at) ?? validIsoTimestamp(raw.created_at);
  if (!timestamp) {
    errors.push(
      error("invalid_schema", "created_at", "created_at or generated_at timestamp is required."),
    );
  }

  const sourceResult = validateSource(raw.source);
  errors.push(...sourceResult.errors);
  const lineageResult = validateLineage(raw.evidence_lineage);
  errors.push(...lineageResult.errors);

  const contentHash = nonEmptyString(raw.content_hash);
  const hashAlgorithm = nonEmptyString(raw.hash_algorithm);
  if (requireContentHash && !contentHash) {
    errors.push(error("invalid_schema", "content_hash", "content_hash is required."));
  }
  if ((requireContentHash || contentHash) && !hashAlgorithm) {
    errors.push(error("invalid_schema", "hash_algorithm", "hash_algorithm is required."));
  } else if (hashAlgorithm && !SUPPORTED_HASH_ALGORITHM_SET.has(hashAlgorithm)) {
    errors.push(
      error(
        "unsupported_hash_algorithm",
        "hash_algorithm",
        "hash_algorithm must be sha256 or sha512.",
      ),
    );
  }

  const sensitivity = nonEmptyString(raw.sensitivity) ?? "none";
  if (!SUPPORTED_SENSITIVITY_SET.has(sensitivity)) {
    errors.push(error("invalid_schema", "sensitivity", "sensitivity marker is unsupported."));
  }

  if (errors.length > 0) {
    return createInvalidEvidenceArtifactResult(errors, [
      "Artifact schema validation failed before hash trust or caller metadata trust.",
    ]);
  }

  return {
    ok: true,
    validation_state: "schema_valid",
    verification_state: "unverified",
    artifact: {
      artifact_id: artifactId as string,
      schema_id: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID,
      schema_version: schemaVersion as VeraConsoleEvidenceArtifactSchemaVersion,
      artifact_type: artifactType as VeraConsoleEvidenceArtifactType,
      artifact_category: artifactCategory as VeraConsoleEvidenceArtifactCategory,
      timestamp: timestamp as string,
      source: sourceResult.source as VeraConsoleEvidenceArtifactSourceContext,
      evidence_lineage: lineageResult.lineage as VeraConsoleEvidenceArtifactLineage,
      ...(contentHash ? { content_hash: contentHash } : {}),
      ...(hashAlgorithm ? { hash_algorithm: hashAlgorithm as VeraConsoleEvidenceHashAlgorithm } : {}),
      metadata: normalizeEvidenceArtifactMetadata(raw.metadata),
      sensitivity: sensitivity as VeraConsoleEvidenceArtifactSensitivityMarker,
      caller_metadata_trusted: false,
      hash_trusted: false,
    },
    errors: [],
    warnings: [
      "Schema validation is structural only; it does not trust caller metadata, verify content bytes, authorize execution, or authorize main-tree mutation.",
    ],
    authorizes_execution: false,
    authorizes_main_tree_mutation: false,
  };
}
