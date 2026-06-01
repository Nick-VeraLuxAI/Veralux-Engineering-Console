import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

const NOT_REMOTE_FLAGS = {
  notPushed: true as const,
  notPrCreated: true as const,
  notMerged: true as const,
  notDeployed: true as const,
  notComplete: true as const,
};

export function auditLocalCommitRequested(
  runId: string,
  taskId: string,
  candidateId: string | null,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId ?? runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      createdBy: actorLabel,
      ...NOT_REMOTE_FLAGS,
    },
  });
}

export function auditLocalCommitValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: { changedFiles: string[]; createdBy: string; reason: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      changedFiles: detail.changedFiles,
      createdBy: detail.createdBy,
      reason: detail.reason,
      ...NOT_REMOTE_FLAGS,
    },
  });
}

export function auditLocalCommitCreated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    commitHash: string;
    changedFiles: string[];
    createdBy: string;
    reason: string;
    commitEvidencePath: string;
    currentBranch: string;
    recommendedBranch: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.createdBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      commitHash: detail.commitHash,
      changedFiles: detail.changedFiles,
      createdBy: detail.createdBy,
      reason: detail.reason,
      commitEvidencePath: detail.commitEvidencePath,
      currentBranch: detail.currentBranch,
      recommendedBranch: detail.recommendedBranch,
      ...NOT_REMOTE_FLAGS,
    },
  });
}

export function auditLocalCommitRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_REJECTED,
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
      ...NOT_REMOTE_FLAGS,
    },
  });
}
