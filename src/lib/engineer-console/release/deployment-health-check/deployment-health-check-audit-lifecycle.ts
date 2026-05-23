import type { AuditEventRecord } from "../../governance/audit-ledger/audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../../governance/audit-ledger/append-audit-event";

export function auditDeploymentHealthCheckStarted(
  runId: string,
  taskId: string | null,
  payload: {
    healthCheckId: string;
    deploymentExecutionId: string;
    healthProfile: string;
    environmentName: string | null;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_CHECK_STARTED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.healthCheckId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      healthCheckId: payload.healthCheckId,
      deploymentExecutionId: payload.deploymentExecutionId,
      healthProfile: payload.healthProfile,
      environmentName: payload.environmentName,
      status: "running",
    },
  });
}

export function auditDeploymentHealthCheckHealthy(
  runId: string,
  taskId: string | null,
  payload: {
    healthCheckId: string;
    deploymentExecutionId: string;
    healthProfile: string;
    responseStatus: number;
    responseTimeMs: number;
    outputHashPrefix: string | null;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_CHECK_HEALTHY,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.healthCheckId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      healthCheckId: payload.healthCheckId,
      deploymentExecutionId: payload.deploymentExecutionId,
      healthProfile: payload.healthProfile,
      status: "healthy",
      responseStatus: payload.responseStatus,
      responseTimeMs: payload.responseTimeMs,
      outputHashPrefix: payload.outputHashPrefix,
    },
  });
}

export function auditDeploymentHealthCheckUnhealthy(
  runId: string,
  taskId: string | null,
  payload: {
    healthCheckId: string;
    deploymentExecutionId: string;
    healthProfile: string;
    responseStatus: number | null;
    responseTimeMs: number;
    outputHashPrefix: string | null;
    message: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_CHECK_UNHEALTHY,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.healthCheckId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      healthCheckId: payload.healthCheckId,
      deploymentExecutionId: payload.deploymentExecutionId,
      healthProfile: payload.healthProfile,
      status: "unhealthy",
      responseStatus: payload.responseStatus,
      responseTimeMs: payload.responseTimeMs,
      outputHashPrefix: payload.outputHashPrefix,
      message: payload.message.slice(0, 300),
    },
  });
}

export function auditDeploymentHealthCheckFailed(
  runId: string,
  taskId: string | null,
  payload: {
    healthCheckId: string;
    deploymentExecutionId: string;
    healthProfile: string;
    responseStatus: number | null;
    responseTimeMs: number;
    message: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_CHECK_FAILED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.healthCheckId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      healthCheckId: payload.healthCheckId,
      deploymentExecutionId: payload.deploymentExecutionId,
      healthProfile: payload.healthProfile,
      status: "failed",
      responseStatus: payload.responseStatus,
      responseTimeMs: payload.responseTimeMs,
      message: payload.message.slice(0, 300),
    },
  });
}
