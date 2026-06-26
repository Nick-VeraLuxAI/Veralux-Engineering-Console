import { describe, expect, it } from "vitest";
import {
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID,
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS,
  createInvalidEvidenceArtifactResult,
  isSupportedEvidenceArtifactSchemaVersion,
  normalizeEvidenceArtifactMetadata,
  validateEvidenceArtifactSchema,
} from "./vera-console-evidence-artifact-schema";
import {
  consoleLikeEvidenceArtifactConflictingMetadataFixture,
  consoleLikeEvidenceArtifactFixture,
  consoleLikeEvidenceArtifactMissingHashFixture,
  consoleLikeEvidenceArtifactMissingLineageFixture,
  consoleLikeEvidenceArtifactSensitiveFixture,
  consoleLikeEvidenceArtifactUnsupportedHashFixture,
  consoleLikeEvidenceArtifactUnsupportedSchemaFixture,
} from "./vera-console-evidence-artifact.fixtures";

function validArtifact(overrides: Record<string, unknown> = {}) {
  return {
    schema_id: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID,
    schema_version: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
    artifact_id: "artifact-123",
    artifact_type: "prototype_loop_evidence",
    artifact_category: "console_prototype",
    generated_at: "2026-06-26T05:45:00.000Z",
    source: {
      source_system: "veralux-engineering-console",
      source_context: "prototype-loop",
    },
    evidence_lineage: {
      evidence_ref_id: "evidence-123",
      request_id: "request-123",
      task_id: "task-123",
      run_id: "run-123",
    },
    content_hash: "a".repeat(64),
    hash_algorithm: "sha256",
    metadata: {
      status: "ready_for_review",
      attempts: 1,
      ignored_object: { nested: true },
    },
    sensitivity: "redacted",
    ...overrides,
  };
}

describe("vera console evidence artifact schema", () => {
  it("accepts a representative Console-like evidence artifact fixture", () => {
    const result = validateEvidenceArtifactSchema(consoleLikeEvidenceArtifactFixture);

    expect(result.ok).toBe(true);
    expect(result.ok && result.artifact).toMatchObject({
      artifact_id: "console-run-evidence:run-2026-06-26-pricing-summary",
      artifact_type: "prototype_loop_evidence",
      artifact_category: "console_prototype",
      sensitivity: "redacted",
      caller_metadata_trusted: false,
      hash_trusted: false,
    });
    expect(result.ok && result.artifact.metadata).toMatchObject({
      bundle_version: "engineer_run_evidence_bundle_v1",
      redaction_version: "engineer-evidence-v1",
      run_status: "ready_for_user_approval",
      approval_required: true,
      integration_allowed: false,
    });
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });

  it("rejects Console-like fixtures with missing lineage", () => {
    const result = validateEvidenceArtifactSchema(
      consoleLikeEvidenceArtifactMissingLineageFixture,
    );

    expect(result.ok).toBe(false);
    expect(result.validation_state).toBe("invalid_schema");
    expect(!result.ok && result.errors.some((item) => item.field === "evidence_lineage")).toBe(
      true,
    );
  });

  it("rejects Console-like fixtures with missing required hash", () => {
    const result = validateEvidenceArtifactSchema(consoleLikeEvidenceArtifactMissingHashFixture);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "content_hash")).toBe(true);
  });

  it("fails closed for Console-like unsupported schema fixtures", () => {
    const result = validateEvidenceArtifactSchema(
      consoleLikeEvidenceArtifactUnsupportedSchemaFixture,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "unsupported_schema_version",
      field: "schema_version",
    });
  });

  it("fails safely for Console-like unsupported hash algorithm fixtures", () => {
    const result = validateEvidenceArtifactSchema(
      consoleLikeEvidenceArtifactUnsupportedHashFixture,
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "unsupported_hash_algorithm",
      field: "hash_algorithm",
    });
  });

  it("keeps Console-like conflicting metadata structural only", () => {
    const result = validateEvidenceArtifactSchema(
      consoleLikeEvidenceArtifactConflictingMetadataFixture,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.artifact.metadata).toMatchObject({
      run_status: "failed",
      readiness_status: "blocked",
      integration_allowed: true,
    });
    expect(result.ok && result.artifact.caller_metadata_trusted).toBe(false);
  });

  it("accepts Console-like sensitivity marker fixtures", () => {
    const result = validateEvidenceArtifactSchema(consoleLikeEvidenceArtifactSensitiveFixture);

    expect(result.ok).toBe(true);
    expect(result.ok && result.artifact.sensitivity).toBe("sensitive");
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });

  it("accepts a valid artifact schema without trusting hash or caller metadata", () => {
    const result = validateEvidenceArtifactSchema(validArtifact());

    expect(result.ok).toBe(true);
    expect(result.validation_state).toBe("schema_valid");
    expect(result.verification_state).toBe("unverified");
    expect(result.ok && result.artifact).toMatchObject({
      artifact_id: "artifact-123",
      schema_id: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID,
      schema_version: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
      artifact_type: "prototype_loop_evidence",
      artifact_category: "console_prototype",
      timestamp: "2026-06-26T05:45:00.000Z",
      hash_algorithm: "sha256",
      sensitivity: "redacted",
      caller_metadata_trusted: false,
      hash_trusted: false,
    });
    expect(result.ok && result.artifact.metadata).toEqual({
      status: "ready_for_review",
      attempts: 1,
    });
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });

  it("rejects unsupported schema versions", () => {
    const result = validateEvidenceArtifactSchema(
      validArtifact({ schema_version: "veralux-console-prototype-loop-evidence/v1" }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "unsupported_schema_version",
      field: "schema_version",
    });
    expect(result.verification_state).toBe("invalid_schema");
  });

  it("rejects missing schema id", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ schema_id: undefined }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "schema_id")).toBe(true);
  });

  it("rejects missing artifact id", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ artifact_id: "" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "artifact_id")).toBe(true);
  });

  it("rejects missing artifact type", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ artifact_type: "" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "artifact_type")).toBe(true);
  });

  it("rejects unsupported artifact type", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ artifact_type: "unknown" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "unsupported_artifact_type",
      field: "artifact_type",
    });
  });

  it("rejects missing artifact category", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ artifact_category: "" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "artifact_category")).toBe(
      true,
    );
  });

  it("rejects missing timestamp", () => {
    const result = validateEvidenceArtifactSchema(
      validArtifact({ generated_at: undefined, created_at: undefined }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "created_at")).toBe(true);
  });

  it("rejects missing source context", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ source: undefined }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "source")).toBe(true);
  });

  it("rejects missing lineage", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ evidence_lineage: {} }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "evidence_lineage")).toBe(
      true,
    );
  });

  it("rejects missing content hash when required", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ content_hash: "" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "content_hash")).toBe(true);
  });

  it("allows missing content hash only when hash verification is not expected", () => {
    const result = validateEvidenceArtifactSchema(
      validArtifact({ content_hash: undefined, hash_algorithm: undefined }),
      { require_content_hash: false },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.artifact.content_hash).toBeUndefined();
    expect(result.ok && result.artifact.hash_algorithm).toBeUndefined();
  });

  it("rejects unsupported hash algorithms", () => {
    const result = validateEvidenceArtifactSchema(validArtifact({ hash_algorithm: "md5" }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatchObject({
      code: "unsupported_hash_algorithm",
      field: "hash_algorithm",
    });
  });

  it("maps invalid schema failures to invalid_schema", () => {
    const result = validateEvidenceArtifactSchema(null);

    expect(result.ok).toBe(false);
    expect(result.validation_state).toBe("invalid_schema");
    expect(result.verification_state).toBe("invalid_schema");
  });

  it("validates schema before hash trust", () => {
    const result = validateEvidenceArtifactSchema(
      validArtifact({
        schema_id: undefined,
        content_hash: undefined,
        hash_algorithm: "md5",
      }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((item) => item.field === "schema_id")).toBe(true);
    expect(!result.ok && result.warnings[0]).toContain("before hash trust");
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });

  it("returns JSON-serializable validation results", () => {
    const result = validateEvidenceArtifactSchema(validArtifact());

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("checks supported schema versions", () => {
    expect(
      isSupportedEvidenceArtifactSchemaVersion(
        VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
        VERA_CONSOLE_EVIDENCE_ARTIFACT_SUPPORTED_SCHEMA_VERSIONS,
      ),
    ).toBe(true);
    expect(isSupportedEvidenceArtifactSchemaVersion("unknown")).toBe(false);
  });

  it("normalizes optional metadata without trusting objects", () => {
    expect(
      normalizeEvidenceArtifactMetadata({
        status: "ready",
        attempts: 2,
        redacted: true,
        nested: { ignored: true },
      }),
    ).toEqual({
      status: "ready",
      attempts: 2,
      redacted: true,
    });
  });

  it("creates safe invalid artifact results", () => {
    const result = createInvalidEvidenceArtifactResult([
      {
        code: "invalid_schema",
        field: "artifact",
        message: "bad artifact",
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.verification_state).toBe("invalid_schema");
    expect(result.authorizes_execution).toBe(false);
    expect(result.authorizes_main_tree_mutation).toBe(false);
  });
});
