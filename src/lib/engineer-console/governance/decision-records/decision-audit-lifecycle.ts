import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { appendAuditEvent } from "../audit-ledger/append-audit-event";
import type { DecisionValue } from "./decision-record-types";

export function auditDecisionRecorded(
  runId: string,
  taskId: string,
  decisionRecordId: string,
  payload: {
    decision: DecisionValue;
    evidenceBundleHash: string | null;
    approvalReportId: string | null;
    riskLevel: string | null;
    qualityGateState: string | null;
    actorType: string;
  },
): AuditEventRecord {
  return appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DECISION_RECORDED,
    entityType: AUDIT_ENTITY_TYPES.DECISION,
    entityId: decisionRecordId,
    actorType: payload.actorType === AUDIT_ACTOR_TYPES.HUMAN ? AUDIT_ACTOR_TYPES.HUMAN : AUDIT_ACTOR_TYPES.SYSTEM,
    actorLabel: payload.actorType === AUDIT_ACTOR_TYPES.HUMAN ? "operator" : payload.actorType,
    taskId,
    runId,
    payload: {
      decision: payload.decision,
      evidenceBundleHash: payload.evidenceBundleHash?.slice(0, 16) ?? null,
      approvalReportId: payload.approvalReportId,
      riskLevel: payload.riskLevel,
      qualityGateState: payload.qualityGateState,
    },
  });
}

export function auditDecisionRecordFailed(
  runId: string,
  taskId: string,
  payload: { decision: DecisionValue; message: string },
): AuditEventRecord {
  return appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DECISION_RECORD_FAILED,
    entityType: AUDIT_ENTITY_TYPES.DECISION,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      decision: payload.decision,
      message: payload.message.slice(0, 500),
    },
  });
}
