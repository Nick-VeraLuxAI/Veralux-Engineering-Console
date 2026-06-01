import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

const NOT_DOWNSTREAM_FLAGS = {
  notDeployed: true as const,
  notComplete: true as const,
};

export function auditGovernedPrMergeRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  mergedBy: string,
  mergeMethod: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGE_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: mergedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      mergeMethod,
      mergedBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditGovernedPrMergeValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    mergeMethod: string;
    mergedBy: string;
    reason: string;
    prUrl: string;
    prNumber: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGE_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      mergeMethod: detail.mergeMethod,
      mergedBy: detail.mergedBy,
      reason: detail.reason,
      prUrl: detail.prUrl,
      prNumber: detail.prNumber,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditGovernedPrMerged(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    mergeMethod: string;
    mergeCommitSha: string | null;
    mergedBy: string;
    reason: string;
    prUrl: string;
    prNumber: string;
    mergeEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.mergedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      mergeMethod: detail.mergeMethod,
      mergeCommitSha: detail.mergeCommitSha,
      mergedBy: detail.mergedBy,
      reason: detail.reason,
      prUrl: detail.prUrl,
      prNumber: detail.prNumber,
      mergeEvidencePath: detail.mergeEvidencePath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditGovernedPrMergeRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGE_REJECTED,
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
