import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";

export function auditFileIndexStarted(
  repoId: string,
  payload: { repoName: string; indexRunId: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.FILE_INDEX_STARTED,
    entityType: AUDIT_ENTITY_TYPES.FILE_INDEX,
    entityId: payload.indexRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      repoId,
      repoName: payload.repoName,
      indexRunId: payload.indexRunId,
    },
  });
}

export function auditFileIndexCompleted(
  repoId: string,
  payload: {
    repoName: string;
    indexRunId: string;
    scannedCount: number;
    indexedCount: number;
    skippedCount: number;
    errorCount: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.FILE_INDEX_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.FILE_INDEX,
    entityId: payload.indexRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      repoId,
      repoName: payload.repoName,
      indexRunId: payload.indexRunId,
      scannedCount: payload.scannedCount,
      indexedCount: payload.indexedCount,
      skippedCount: payload.skippedCount,
      errorCount: payload.errorCount,
    },
  });
}

export function auditFileIndexFailed(
  repoId: string,
  payload: { repoName: string; indexRunId: string; message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.FILE_INDEX_FAILED,
    entityType: AUDIT_ENTITY_TYPES.FILE_INDEX,
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
