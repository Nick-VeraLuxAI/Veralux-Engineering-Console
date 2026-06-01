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

export function auditPullRequestCreateRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  createdBy: string,
  mode: string,
  baseBranch: string,
  headBranch: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATE_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: createdBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      provider: "github",
      mode,
      baseBranch,
      headBranch,
      createdBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditPullRequestCreateValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    mode: string;
    baseBranch: string;
    headBranch: string;
    createdBy: string;
    reason: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATE_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      provider: "github",
      mode: detail.mode,
      baseBranch: detail.baseBranch,
      headBranch: detail.headBranch,
      createdBy: detail.createdBy,
      reason: detail.reason,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditPullRequestCreated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    baseBranch: string;
    headBranch: string;
    prUrl: string | null;
    prNumber: number | null;
    createdBy: string;
    reason: string;
    prEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.createdBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      provider: "github",
      baseBranch: detail.baseBranch,
      headBranch: detail.headBranch,
      prUrl: detail.prUrl,
      prNumber: detail.prNumber,
      createdBy: detail.createdBy,
      reason: detail.reason,
      prEvidencePath: detail.prEvidencePath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditPullRequestPacketPrepared(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    baseBranch: string;
    headBranch: string;
    createdBy: string;
    reason: string;
    prEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_PACKET_PREPARED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.createdBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      provider: "github",
      baseBranch: detail.baseBranch,
      headBranch: detail.headBranch,
      createdBy: detail.createdBy,
      reason: detail.reason,
      prEvidencePath: detail.prEvidencePath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditPullRequestCreateRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATE_REJECTED,
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
