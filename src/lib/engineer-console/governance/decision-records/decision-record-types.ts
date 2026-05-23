import type { AuditActorType } from "../audit-ledger/audit-event-types";

export const DECISION_RECORD_VERSION = "engineer_decision_snapshot_v1" as const;

export const DECISION_VALUES = ["approved", "request_fix", "stopped"] as const;
export type DecisionValue = (typeof DECISION_VALUES)[number];

export type ApprovalAction = "approve" | "request_fix" | "stop";

export const DECISION_BY_ACTION: Record<ApprovalAction, DecisionValue> = {
  approve: "approved",
  request_fix: "request_fix",
  stop: "stopped",
};

export interface DecisionSnapshotV1 {
  snapshotVersion: typeof DECISION_RECORD_VERSION;
  runId: string;
  runStatus: string;
  runCurrentStep: string | null;
  taskId: string;
  taskTitle: string;
  decision: DecisionValue;
  actorType: AuditActorType;
  actorLabel: string | null;
  rationale: string | null;
  approvalReportId: string | null;
  approvalCanApprove: boolean;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  governanceRiskLevel: string | null;
  qualityGateState: string;
  recordedAt: string;
}

export interface DecisionRecordRow {
  id: string;
  run_id: string;
  task_id: string | null;
  decision: string;
  actor_type: string;
  actor_label: string | null;
  rationale: string | null;
  approval_report_id: string | null;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  risk_level: string | null;
  can_approve: number;
  quality_gate_state: string | null;
  audit_event_id: string | null;
  audit_chain_hash: string | null;
  decision_snapshot_json: string;
  created_at: string;
}

export interface DecisionRecord {
  id: string;
  runId: string;
  taskId: string | null;
  decision: DecisionValue;
  actorType: AuditActorType;
  actorLabel: string | null;
  rationale: string | null;
  approvalReportId: string | null;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  riskLevel: string | null;
  canApprove: boolean;
  qualityGateState: string | null;
  auditEventId: string | null;
  auditChainHash: string | null;
  decisionSnapshotJson: string;
  createdAt: string;
}

export class DecisionRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionRecordError";
  }
}

export interface CreateDecisionRecordInput {
  runId: string;
  decision: DecisionValue;
  actorType: AuditActorType;
  actorLabel?: string | null;
  rationale?: string | null;
}
