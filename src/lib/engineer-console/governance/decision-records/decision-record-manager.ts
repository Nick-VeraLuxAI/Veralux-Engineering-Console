import { createDecisionRecord } from "./create-decision-record";
import { listDecisionRecordsForRun } from "./list-decision-records";
import type {
  ApprovalAction,
  DecisionRecord,
  DecisionSnapshotV1,
} from "./decision-record-types";
import { DECISION_BY_ACTION, DecisionRecordError } from "./decision-record-types";

export { createDecisionRecord, DecisionRecordError };

export function listDecisionRecords(runId: string): DecisionRecord[] {
  return listDecisionRecordsForRun(runId);
}

export function toPublicDecisionRecord(record: DecisionRecord) {
  let snapshot: DecisionSnapshotV1 | null = null;
  try {
    snapshot = JSON.parse(record.decisionSnapshotJson) as DecisionSnapshotV1;
  } catch {
    snapshot = null;
  }

  return {
    id: record.id,
    runId: record.runId,
    taskId: record.taskId,
    decision: record.decision,
    actorType: record.actorType,
    actorLabel: record.actorLabel,
    rationale: record.rationale,
    approvalReportId: record.approvalReportId,
    evidenceBundleHash: record.evidenceBundleHash,
    riskLevel: record.riskLevel,
    canApprove: record.canApprove,
    qualityGateState: record.qualityGateState,
    auditChainHash: record.auditChainHash,
    auditChainHashPrefix: record.auditChainHash?.slice(0, 12) ?? null,
    createdAt: record.createdAt,
    snapshot,
  };
}

export function recordDecisionForApprovalAction(input: {
  runId: string;
  action: ApprovalAction;
  actorType: Parameters<typeof createDecisionRecord>[0]["actorType"];
  actorLabel?: string | null;
  rationale?: string | null;
}): DecisionRecord {
  return createDecisionRecord({
    runId: input.runId,
    decision: DECISION_BY_ACTION[input.action],
    actorType: input.actorType,
    actorLabel: input.actorLabel,
    rationale: input.rationale,
  });
}
