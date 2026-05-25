import type { AuditEventRecord } from "../../governance/audit-ledger/audit-ledger-types";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../../governance/audit-ledger/append-audit-event";
import type { ReleaseSignoffDecision } from "./release-signoff-types";

function eventTypeForDecision(decision: ReleaseSignoffDecision): string {
  switch (decision) {
    case "completed":
      return AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_COMPLETED;
    case "completed_with_exceptions":
      return AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_COMPLETED_WITH_EXCEPTIONS;
    case "rejected":
      return AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_REJECTED;
    default:
      return AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_FAILED;
  }
}

export function auditReleaseSignoffRecorded(
  runId: string,
  taskId: string | null,
  payload: {
    signoffId: string;
    decision: ReleaseSignoffDecision;
    checklistStatus: string;
    evidenceBundleHashPrefix: string | null;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: eventTypeForDecision(payload.decision),
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.signoffId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      signoffId: payload.signoffId,
      decision: payload.decision,
      checklistStatus: payload.checklistStatus,
      evidenceBundleHashPrefix: payload.evidenceBundleHashPrefix,
    },
  });
}

export function auditReleaseSignoffFailed(
  runId: string,
  taskId: string | null,
  payload: {
    decision: ReleaseSignoffDecision;
    message: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.RELEASE_SIGNOFF_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      decision: payload.decision,
      message: payload.message.slice(0, 300),
    },
  });
}
