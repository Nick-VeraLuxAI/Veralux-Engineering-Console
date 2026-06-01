import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { AuditEventRecord } from "./audit-ledger-types";

const GOVERNANCE_FLAGS = {
  notCommitted: true,
  notPushed: true,
  notMerged: true,
  notDeployed: true,
  notComplete: true,
} as const;

export function auditCommitCandidateRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_COMMIT_CANDIDATE_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: { ...payload, ...GOVERNANCE_FLAGS },
  });
}

export function auditCommitCandidateValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_COMMIT_CANDIDATE_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: { ...payload, ...GOVERNANCE_FLAGS },
  });
}

export function auditCommitCandidatePrepared(
  runId: string,
  taskId: string,
  candidateId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_COMMIT_CANDIDATE_PREPARED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: { ...payload, ...GOVERNANCE_FLAGS },
  });
}

export function auditCommitCandidateRejected(
  runId: string,
  taskId: string,
  candidateId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_COMMIT_CANDIDATE_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: { ...payload, ...GOVERNANCE_FLAGS },
  });
}
