import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";

export function auditCompatibilityAnalysisStarted(
  analysisRunId: string,
  payload: { repoCount: number },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.COMPATIBILITY_ANALYSIS_STARTED,
    entityType: AUDIT_ENTITY_TYPES.COMPATIBILITY,
    entityId: analysisRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      analysisRunId,
      repoCount: payload.repoCount,
    },
  });
}

export function auditCompatibilityAnalysisCompleted(
  analysisRunId: string,
  payload: {
    repoCount: number;
    surfaceCount: number;
    linkCount: number;
    warningCount: number;
    breakingCount: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.COMPATIBILITY_ANALYSIS_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.COMPATIBILITY,
    entityId: analysisRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      analysisRunId,
      repoCount: payload.repoCount,
      surfaceCount: payload.surfaceCount,
      linkCount: payload.linkCount,
      warningCount: payload.warningCount,
      breakingCount: payload.breakingCount,
    },
  });
}

export function auditCompatibilityAnalysisFailed(
  analysisRunId: string,
  payload: { message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.COMPATIBILITY_ANALYSIS_FAILED,
    entityType: AUDIT_ENTITY_TYPES.COMPATIBILITY,
    entityId: analysisRunId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {
      analysisRunId,
      message: payload.message.slice(0, 500),
    },
  });
}
