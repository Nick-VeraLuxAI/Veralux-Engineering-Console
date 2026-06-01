import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { AuditEventRecord } from "./audit-ledger-types";

export function auditHermesPatchApplyRequested(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_APPLY_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesPatchValidationPassed(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_VALIDATION_PASSED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesPatchValidationFailed(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_VALIDATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesPatchApplied(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_APPLIED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesPatchRollbackArtifactCreated(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_ROLLBACK_ARTIFACT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditHermesPatchRollbackApplied(
  runId: string,
  taskId: string,
  dispatchId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_ROLLBACK_APPLIED,
    entityType: AUDIT_ENTITY_TYPES.HERMES_WORKER,
    entityId: dispatchId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload,
  });
}
