import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { DeploymentReadinessStatus } from "../../release/deployment-gates/deployment-gate-types";

export function auditDeploymentReadinessEvaluated(
  runId: string,
  taskId: string | null,
  payload: {
    readinessCheckId: string;
    environmentId: string;
    environmentName: string;
    readinessStatus: DeploymentReadinessStatus;
    blockerCount: number;
    warningCount: number;
    mergeRequestId?: string | null;
    mergeShaPrefix?: string | null;
    actorType: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_READINESS_EVALUATED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.readinessCheckId,
    actorType:
      payload.actorType === AUDIT_ACTOR_TYPES.HUMAN
        ? AUDIT_ACTOR_TYPES.HUMAN
        : AUDIT_ACTOR_TYPES.SYSTEM,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      readinessCheckId: payload.readinessCheckId,
      environmentId: payload.environmentId,
      environmentName: payload.environmentName,
      readinessStatus: payload.readinessStatus,
      blockerCount: payload.blockerCount,
      warningCount: payload.warningCount,
      mergeRequestId: payload.mergeRequestId ?? null,
      mergeShaPrefix: payload.mergeShaPrefix ?? null,
    },
  });
}

export function auditDeploymentApproved(
  runId: string,
  taskId: string | null,
  payload: {
    approvalId: string;
    readinessCheckId: string;
    environmentId: string;
    environmentName: string;
    readinessStatus: DeploymentReadinessStatus;
    mergeShaPrefix: string | null;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.approvalId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      approvalId: payload.approvalId,
      readinessCheckId: payload.readinessCheckId,
      environmentId: payload.environmentId,
      environmentName: payload.environmentName,
      readinessStatus: payload.readinessStatus,
      mergeShaPrefix: payload.mergeShaPrefix,
    },
  });
}

export function auditDeploymentRejected(
  runId: string,
  taskId: string | null,
  payload: {
    approvalId: string;
    readinessCheckId: string;
    environmentId: string;
    environmentName: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.approvalId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      approvalId: payload.approvalId,
      readinessCheckId: payload.readinessCheckId,
      environmentId: payload.environmentId,
      environmentName: payload.environmentName,
    },
  });
}
