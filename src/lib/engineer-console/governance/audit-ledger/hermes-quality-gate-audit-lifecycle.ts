import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { AuditEventRecord } from "./audit-ledger-types";

export function auditHermesQualityGatesRequested(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_QUALITY_GATES_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesQualityGateStarted(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_QUALITY_GATE_STARTED,
    entityType: AUDIT_ENTITY_TYPES.QUALITY_GATE,
    entityId: String(payload.gateId ?? dispatchId),
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesQualityGatePassed(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_QUALITY_GATE_PASSED,
    entityType: AUDIT_ENTITY_TYPES.QUALITY_GATE,
    entityId: String(payload.gateId ?? dispatchId),
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesQualityGateFailed(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_QUALITY_GATE_FAILED,
    entityType: AUDIT_ENTITY_TYPES.QUALITY_GATE,
    entityId: String(payload.gateId ?? dispatchId),
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesQualityGatesCompleted(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_QUALITY_GATES_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload,
  });
}
