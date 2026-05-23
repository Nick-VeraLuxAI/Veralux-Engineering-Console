import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";

export function auditEvidenceBundleCreated(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.EVIDENCE_BUNDLE_CREATED,
    entityType: AUDIT_ENTITY_TYPES.EVIDENCE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}

export function auditEvidenceBundleUpdated(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
) {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.EVIDENCE_BUNDLE_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.EVIDENCE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload,
  });
}
