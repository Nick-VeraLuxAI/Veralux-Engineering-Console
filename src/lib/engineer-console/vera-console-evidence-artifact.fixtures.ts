import {
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID,
  VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
} from "./vera-console-evidence-artifact-schema";

export const consoleLikeEvidenceArtifactFixture = {
  schema_id: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_ID,
  schema_version: VERA_CONSOLE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
  artifact_id: "console-run-evidence:run-2026-06-26-pricing-summary",
  artifact_type: "prototype_loop_evidence",
  artifact_category: "console_prototype",
  generated_at: "2026-06-26T16:45:00.000Z",
  source: {
    source_system: "veralux-engineering-console",
    source_context: "prototype-loop-v1",
  },
  evidence_lineage: {
    evidence_ref_id: "evidence-prototype-loop-v1-pricing-summary",
    request_id: "vc-handoff-2026-06-25-prototype-pricing-summary",
    task_id: "task-pricing-summary",
    run_id: "run-2026-06-26-pricing-summary",
    parent_artifact_ids: [
      "console-worker-plan:run-2026-06-26-pricing-summary",
      "console-approval-report:run-2026-06-26-pricing-summary",
    ],
  },
  content_hash: "b".repeat(64),
  hash_algorithm: "sha256",
  metadata: {
    bundle_version: "engineer_run_evidence_bundle_v1",
    redaction_version: "engineer-evidence-v1",
    bundle_hash: "c".repeat(64),
    run_status: "ready_for_user_approval",
    run_step: "acceptance_threshold",
    readiness_status: "ready_for_user_approval",
    approval_required: true,
    integration_allowed: false,
    integration_performed: false,
    quality_gate_count: 3,
    changed_file_count: 2,
    evidence_path: "evidence/prototype-loop-v1/task-pricing-summary.json",
    workspace_path_hash: "workspace-path-ref-8f14e45f",
    audit_event_count: 4,
    latest_audit_event_type: "quality_gate_completed",
  },
  sensitivity: "redacted",
} as const;

export const consoleLikeEvidenceArtifactMissingLineageFixture = {
  ...consoleLikeEvidenceArtifactFixture,
  evidence_lineage: {},
} as const;

export const consoleLikeEvidenceArtifactMissingHashFixture = {
  ...consoleLikeEvidenceArtifactFixture,
  content_hash: "",
} as const;

export const consoleLikeEvidenceArtifactUnsupportedSchemaFixture = {
  ...consoleLikeEvidenceArtifactFixture,
  schema_version: "vera_console_evidence_artifact_v2",
} as const;

export const consoleLikeEvidenceArtifactUnsupportedHashFixture = {
  ...consoleLikeEvidenceArtifactFixture,
  hash_algorithm: "md5",
} as const;

export const consoleLikeEvidenceArtifactConflictingMetadataFixture = {
  ...consoleLikeEvidenceArtifactFixture,
  metadata: {
    ...consoleLikeEvidenceArtifactFixture.metadata,
    run_status: "failed",
    readiness_status: "blocked",
    integration_allowed: true,
  },
} as const;

export const consoleLikeEvidenceArtifactSensitiveFixture = {
  ...consoleLikeEvidenceArtifactFixture,
  artifact_id: "console-run-evidence:run-2026-06-26-sensitive",
  metadata: {
    ...consoleLikeEvidenceArtifactFixture.metadata,
    redaction_version: "engineer-evidence-v1",
    output_preview_redacted: true,
  },
  sensitivity: "sensitive",
} as const;
