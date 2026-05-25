import type { AuditEventRecord } from "../../governance/audit-ledger/audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../../governance/audit-ledger/append-audit-event";

export function auditDeploymentExecutionStarted(
  runId: string,
  taskId: string | null,
  payload: {
    executionId: string;
    environmentId: string | null;
    environmentName: string | null;
    deploymentProfile: string;
    deploymentApprovalId: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_STARTED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.executionId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      executionId: payload.executionId,
      environmentId: payload.environmentId,
      environmentName: payload.environmentName,
      deploymentProfile: payload.deploymentProfile,
      deploymentApprovalId: payload.deploymentApprovalId,
      status: "running",
    },
  });
}

export function auditDeploymentExecutionSucceeded(
  runId: string,
  taskId: string | null,
  payload: {
    executionId: string;
    environmentId: string | null;
    environmentName: string | null;
    deploymentProfile: string;
    exitCode: number;
    outputHashPrefix: string | null;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_SUCCEEDED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.executionId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      executionId: payload.executionId,
      environmentId: payload.environmentId,
      environmentName: payload.environmentName,
      deploymentProfile: payload.deploymentProfile,
      status: "succeeded",
      exitCode: payload.exitCode,
      outputHashPrefix: payload.outputHashPrefix,
    },
  });
}

export function auditDeploymentExecutionFailed(
  runId: string,
  taskId: string | null,
  payload: {
    executionId: string;
    environmentId: string | null;
    environmentName: string | null;
    deploymentProfile: string;
    exitCode: number | null;
    outputHashPrefix: string | null;
    message: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.executionId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      executionId: payload.executionId,
      environmentId: payload.environmentId,
      environmentName: payload.environmentName,
      deploymentProfile: payload.deploymentProfile,
      status: "failed",
      exitCode: payload.exitCode,
      outputHashPrefix: payload.outputHashPrefix,
      message: payload.message.slice(0, 300),
    },
  });
}
