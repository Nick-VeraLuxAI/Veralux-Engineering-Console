import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

export function auditRunCompletionRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  completedBy: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETION_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: completedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      completedBy,
    },
  });
}

export function auditRunCompletionValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    completedBy: string;
    reason: string;
    productionDeploymentEvidencePath: string;
    completionReadinessEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETION_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      completedBy: detail.completedBy,
      reason: detail.reason,
      productionDeploymentEvidencePath: detail.productionDeploymentEvidencePath,
      completionReadinessEvidencePath: detail.completionReadinessEvidencePath,
    },
  });
}

export function auditRunCompletedGoverned(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    completedBy: string;
    reason: string;
    closeoutEvidencePath: string;
    productionDeploymentEvidencePath: string;
    completionReadinessEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.completedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      completedBy: detail.completedBy,
      reason: detail.reason,
      closeoutEvidencePath: detail.closeoutEvidencePath,
      productionDeploymentEvidencePath: detail.productionDeploymentEvidencePath,
      completionReadinessEvidencePath: detail.completionReadinessEvidencePath,
    },
  });
}

export function auditRunCompletionRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETION_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      reason,
      code,
    },
  });
}
