import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

const NOT_DOWNSTREAM_FLAGS = {
  notDeployed: true as const,
  notComplete: true as const,
};

export function auditDeploymentPacketRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  createdBy: string,
  targetEnvironment: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOYMENT_PACKET_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: createdBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment,
      createdBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditDeploymentPacketValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    targetEnvironment: string;
    createdBy: string;
    reason: string;
    mergeCommitSha: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOYMENT_PACKET_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment: detail.targetEnvironment,
      createdBy: detail.createdBy,
      reason: detail.reason,
      mergeCommitSha: detail.mergeCommitSha,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditDeploymentPacketPrepared(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    targetEnvironment: string;
    createdBy: string;
    reason: string;
    deploymentPacketPath: string;
    deploymentPlanPath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOYMENT_PACKET_PREPARED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.createdBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment: detail.targetEnvironment,
      createdBy: detail.createdBy,
      reason: detail.reason,
      deploymentPacketPath: detail.deploymentPacketPath,
      deploymentPlanPath: detail.deploymentPlanPath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditDeploymentPacketRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_DEPLOYMENT_PACKET_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId ?? runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      reason,
      code,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}
