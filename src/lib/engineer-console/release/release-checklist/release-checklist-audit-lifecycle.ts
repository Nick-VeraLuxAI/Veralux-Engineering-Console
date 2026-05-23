import type { AuditEventRecord } from "../../governance/audit-ledger/audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../../governance/audit-ledger/append-audit-event";
import type { ReleaseChecklistStatus } from "./release-checklist-types";

export function auditReleaseChecklistEvaluated(
  runId: string,
  taskId: string | null,
  payload: {
    checklistId: string;
    checklistStatus: ReleaseChecklistStatus;
    blockerCount: number;
    needsAttentionCount: number;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.RELEASE_CHECKLIST_EVALUATED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.checklistId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      checklistId: payload.checklistId,
      checklistStatus: payload.checklistStatus,
      blockerCount: payload.blockerCount,
      needsAttentionCount: payload.needsAttentionCount,
    },
  });
}

export function auditReleaseChecklistFailed(
  runId: string,
  taskId: string | null,
  payload: {
    message: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.RELEASE_CHECKLIST_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      message: payload.message.slice(0, 300),
    },
  });
}
