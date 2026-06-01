import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

const NOT_DOWNSTREAM_FLAGS = {
  notMerged: true as const,
  notDeployed: true as const,
  notComplete: true as const,
};

export function auditMergeReadinessRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  reviewedBy: string,
  decision: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_MERGE_READINESS_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: reviewedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      decision,
      reviewedBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditMergeReadinessValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    decision: string;
    reviewedBy: string;
    reason: string;
    prUrl: string | null;
    prNumber: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_MERGE_READINESS_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      decision: detail.decision,
      reviewedBy: detail.reviewedBy,
      reason: detail.reason,
      prUrl: detail.prUrl,
      prNumber: detail.prNumber,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditMergeReadinessRecorded(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    decision: string;
    reviewedBy: string;
    reason: string;
    prUrl: string | null;
    prNumber: string | null;
    mergeReadinessPath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_MERGE_READINESS_RECORDED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      decision: detail.decision,
      reviewedBy: detail.reviewedBy,
      reason: detail.reason,
      prUrl: detail.prUrl,
      prNumber: detail.prNumber,
      mergeReadinessPath: detail.mergeReadinessPath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditMergeReadinessRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_MERGE_READINESS_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId ?? runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      reason,
      code,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}
