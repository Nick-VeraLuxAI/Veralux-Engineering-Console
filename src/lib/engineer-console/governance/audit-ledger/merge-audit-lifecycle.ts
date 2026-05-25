import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { MergeReadinessStatus } from "../../release/merge-controls/merge-control-types";

export function auditMergeReadinessEvaluated(
  runId: string,
  taskId: string | null,
  payload: {
    mergeRequestId?: string;
    prRequestId: string;
    readinessStatus: MergeReadinessStatus;
    blockerCount: number;
    warningCount: number;
    actorLabel?: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.MERGE_READINESS_EVALUATED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.mergeRequestId ?? payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    actorLabel: payload.actorLabel ?? "system",
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      mergeRequestId: payload.mergeRequestId ?? null,
      prRequestId: payload.prRequestId,
      readinessStatus: payload.readinessStatus,
      blockerCount: payload.blockerCount,
      warningCount: payload.warningCount,
    },
  });
}

export function auditMergeStarted(
  runId: string,
  taskId: string | null,
  payload: {
    mergeRequestId: string;
    prRequestId: string;
    prNumber: string | null;
    mergeMethod: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.MERGE_STARTED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.mergeRequestId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      mergeRequestId: payload.mergeRequestId,
      prRequestId: payload.prRequestId,
      prNumber: payload.prNumber,
      mergeMethod: payload.mergeMethod,
    },
  });
}

export function auditMergeCompleted(
  runId: string,
  taskId: string | null,
  payload: {
    mergeRequestId: string;
    prRequestId: string;
    prUrl: string | null;
    mergeShaPrefix: string | null;
    readinessStatus: MergeReadinessStatus;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.MERGE_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.mergeRequestId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      mergeRequestId: payload.mergeRequestId,
      prRequestId: payload.prRequestId,
      prUrl: payload.prUrl,
      mergeShaPrefix: payload.mergeShaPrefix,
      readinessStatus: payload.readinessStatus,
    },
  });
}

export function auditMergeFailed(
  runId: string,
  taskId: string | null,
  payload: {
    mergeRequestId: string;
    prRequestId: string;
    message: string;
    actorLabel?: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.MERGE_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.mergeRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    actorLabel: payload.actorLabel ?? "system",
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      mergeRequestId: payload.mergeRequestId,
      prRequestId: payload.prRequestId,
      message: payload.message.slice(0, 300),
    },
  });
}
