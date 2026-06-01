import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

const NOT_DOWNSTREAM_FLAGS = {
  notPrCreated: true as const,
  notMerged: true as const,
  notDeployed: true as const,
  notComplete: true as const,
};

export function auditRemoteBranchPushRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  pushedBy: string,
  remoteName: string,
  branchName: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: pushedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      remoteName,
      branchName,
      pushedBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditRemoteBranchPushValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    commitHash: string;
    remoteName: string;
    branchName: string;
    pushedBy: string;
    reason: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      commitHash: detail.commitHash,
      remoteName: detail.remoteName,
      branchName: detail.branchName,
      pushedBy: detail.pushedBy,
      reason: detail.reason,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditRemoteBranchPushCreated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    commitHash: string;
    remoteName: string;
    branchName: string;
    remoteRef: string;
    pushedBy: string;
    reason: string;
    pushEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.pushedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      commitHash: detail.commitHash,
      remoteName: detail.remoteName,
      branchName: detail.branchName,
      remoteRef: detail.remoteRef,
      pushedBy: detail.pushedBy,
      reason: detail.reason,
      pushEvidencePath: detail.pushEvidencePath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditRemoteBranchPushRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_REJECTED,
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
