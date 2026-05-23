import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";

export function auditCodeIndexStarted(
  repoId: string,
  payload: { repoName: string; indexRunId: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.CODE_INDEX_STARTED,
    entityType: AUDIT_ENTITY_TYPES.CODE_INDEX,
    entityId: payload.indexRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: { repoId, repoName: payload.repoName, indexRunId: payload.indexRunId },
  });
}

export function auditCodeIndexCompleted(
  repoId: string,
  payload: {
    repoName: string;
    indexRunId: string;
    symbolCount: number;
    chunkCount: number;
    skippedCount: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.CODE_INDEX_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.CODE_INDEX,
    entityId: payload.indexRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      repoId,
      repoName: payload.repoName,
      indexRunId: payload.indexRunId,
      symbolCount: payload.symbolCount,
      chunkCount: payload.chunkCount,
      skippedCount: payload.skippedCount,
    },
  });
}

export function auditCodeIndexFailed(
  repoId: string,
  payload: { repoName: string; indexRunId: string; message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.CODE_INDEX_FAILED,
    entityType: AUDIT_ENTITY_TYPES.CODE_INDEX,
    entityId: payload.indexRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      repoId,
      repoName: payload.repoName,
      indexRunId: payload.indexRunId,
      message: payload.message.slice(0, 500),
    },
  });
}
