import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { AuditEventRecord } from "./audit-ledger-types";

export function auditHermesRunPacketPrepared(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_RUN_PACKET_PREPARED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesRunDispatched(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_RUN_DISPATCHED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesEvidencePlaceholderCreated(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_EVIDENCE_PLACEHOLDER_CREATED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesEvidenceReceived(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_EVIDENCE_RECEIVED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}
