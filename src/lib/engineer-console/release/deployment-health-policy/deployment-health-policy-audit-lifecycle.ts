import type { AuditEventRecord } from "../../governance/audit-ledger/audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../../governance/audit-ledger/append-audit-event";
import type { DeploymentHealthPolicyStatus } from "./deployment-health-policy-types";

export function auditDeploymentHealthPolicyEvaluated(
  runId: string,
  taskId: string | null,
  payload: {
    policyResultId: string;
    deploymentExecutionId: string | null;
    healthCheckId: string | null;
    environmentName: string | null;
    policyStatus: DeploymentHealthPolicyStatus;
    policyVersion: string;
    policyHashPrefix: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_POLICY_EVALUATED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.policyResultId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      policyResultId: payload.policyResultId,
      deploymentExecutionId: payload.deploymentExecutionId,
      healthCheckId: payload.healthCheckId,
      environmentName: payload.environmentName,
      policyStatus: payload.policyStatus,
      policyVersion: payload.policyVersion,
      policyHashPrefix: payload.policyHashPrefix,
    },
  });
}

export function auditDeploymentHealthPolicyFailed(
  runId: string,
  taskId: string | null,
  payload: {
    deploymentExecutionId: string | null;
    message: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_POLICY_FAILED,
    entityType: AUDIT_ENTITY_TYPES.DEPLOYMENT,
    entityId: payload.deploymentExecutionId ?? runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      deploymentExecutionId: payload.deploymentExecutionId,
      message: payload.message.slice(0, 300),
    },
  });
}
