import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../audit-ledger/audit-event-types";
import { requireAuditEvent } from "../audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../audit-ledger/audit-ledger-types";

const NOT_DOWNSTREAM_FLAGS = {
  rollbackNotesPresent: true as const,
  notComplete: true as const,
};

export function auditProductionDeploymentRequested(
  runId: string,
  taskId: string,
  candidateId: string,
  deployedBy: string,
  targetEnvironment: string,
  deploymentAdapter: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: deployedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment,
      deploymentAdapter,
      deployedBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditProductionDeploymentValidated(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    targetEnvironment: string;
    deploymentAdapter: string;
    deployedBy: string;
    reason: string;
    mergeCommitSha: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment: detail.targetEnvironment,
      deploymentAdapter: detail.deploymentAdapter,
      deployedBy: detail.deployedBy,
      reason: detail.reason,
      mergeCommitSha: detail.mergeCommitSha,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditProductionDeploymentStarted(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    targetEnvironment: string;
    deploymentAdapter: string;
    deployedBy: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_STARTED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment: detail.targetEnvironment,
      deploymentAdapter: detail.deploymentAdapter,
      deployedBy: detail.deployedBy,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditProductionDeploymentSucceeded(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    targetEnvironment: string;
    deploymentAdapter: string;
    deployedBy: string;
    reason: string;
    exitCode: number;
    deploymentEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.deployedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment: detail.targetEnvironment,
      deploymentAdapter: detail.deploymentAdapter,
      deployedBy: detail.deployedBy,
      reason: detail.reason,
      exitCode: detail.exitCode,
      deploymentEvidencePath: detail.deploymentEvidencePath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditProductionDeploymentFailed(
  runId: string,
  taskId: string,
  candidateId: string,
  detail: {
    targetEnvironment: string;
    deploymentAdapter: string;
    deployedBy: string;
    reason: string;
    exitCode: number;
    deploymentEvidencePath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_FAILED,
    entityType: AUDIT_ENTITY_TYPES.COMMIT_CANDIDATE,
    entityId: candidateId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.deployedBy,
    taskId,
    runId,
    payload: {
      runId,
      candidateId,
      targetEnvironment: detail.targetEnvironment,
      deploymentAdapter: detail.deploymentAdapter,
      deployedBy: detail.deployedBy,
      reason: detail.reason,
      exitCode: detail.exitCode,
      deploymentEvidencePath: detail.deploymentEvidencePath,
      ...NOT_DOWNSTREAM_FLAGS,
    },
  });
}

export function auditProductionDeploymentRejected(
  runId: string,
  taskId: string,
  candidateId: string | null,
  reason: string,
  code: string,
  actorLabel: string,
  deploymentAdapter?: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_REJECTED,
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
      deploymentAdapter: deploymentAdapter ?? null,
      rollbackNotesPresent: false,
      notComplete: true,
    },
  });
}
