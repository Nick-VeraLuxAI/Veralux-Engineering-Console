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

export function auditDeployReadinessRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  reviewedBy: string,
  decision: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOY_READINESS_REQUESTED,
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

export function auditDeployReadinessValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    decision: string;
    reviewedBy: string;
    reason: string;
    prUrl: string;
    prNumber: string;
    mergeCommitSha: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOY_READINESS_VALIDATED,
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
      mergeCommitSha: detail.mergeCommitSha,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditDeployReadinessRecorded(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    decision: string;
    reviewedBy: string;
    reason: string;
    prUrl: string;
    prNumber: string;
    mergeCommitSha: string | null;
    deployReadinessPath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOY_READINESS_RECORDED,
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
      mergeCommitSha: detail.mergeCommitSha,
      deployReadinessPath: detail.deployReadinessPath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditDeployReadinessRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOY_READINESS_REJECTED,
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
