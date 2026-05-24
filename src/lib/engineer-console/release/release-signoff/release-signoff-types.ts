import type { AuditActorType } from "../../governance/audit-ledger/audit-event-types";

export const RELEASE_SIGNOFF_DECISIONS = [
  "completed",
  "completed_with_exceptions",
  "rejected",
] as const;

export type ReleaseSignoffDecision = (typeof RELEASE_SIGNOFF_DECISIONS)[number];

export const RELEASE_SIGNOFF_SNAPSHOT_VERSION = "engineer_release_signoff_snapshot_v1" as const;

export interface ReleaseSignoffChecklistItemSummary {
  id: string;
  label: string;
  status: string;
}

export interface ReleaseSignoffSnapshotV1 {
  snapshotVersion: typeof RELEASE_SIGNOFF_SNAPSHOT_VERSION;
  runId: string;
  taskId: string;
  taskTitle: string;
  releaseChecklistId: string | null;
  releaseChecklistStatus: string;
  checklistItemSummaries: ReleaseSignoffChecklistItemSummary[];
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  latestDeploymentExecutionStatus: string | null;
  latestHealthPolicyStatus: string | null;
  latestReplayVerificationStatus: string | null;
  latestPolicyResultStatus: string | null;
  reviewStageSummary: {
    requiredCount: number;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
  } | null;
  latestHumanDecision: string | null;
  signoffDecision: ReleaseSignoffDecision;
  rationale: string | null;
  signedOffAt: string;
}

export interface ReleaseSignoffRecord {
  id: string;
  runId: string;
  releaseChecklistId: string | null;
  releaseChecklistStatus: string | null;
  decision: ReleaseSignoffDecision;
  actorType: AuditActorType;
  actorLabel: string | null;
  rationale: string | null;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  auditEventId: string | null;
  auditChainHash: string | null;
  signoffSnapshotJson: string;
  createdAt: string;
}

export interface ReleaseSignoffRow {
  id: string;
  run_id: string;
  release_checklist_id: string | null;
  release_checklist_status: string | null;
  decision: string;
  actor_type: string;
  actor_label: string | null;
  rationale: string | null;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  audit_event_id: string | null;
  audit_chain_hash: string | null;
  signoff_snapshot_json: string;
  created_at: string;
}

export class ReleaseSignoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseSignoffError";
  }
}
