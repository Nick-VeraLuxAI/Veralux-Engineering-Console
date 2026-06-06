import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../governance/audit-ledger/append-audit-event";
import type { AuditEventRecord } from "../governance/audit-ledger/audit-ledger-types";

const NO_EXECUTION_FLAGS = {
  noCodeExecuted: true as const,
  noWorkerDispatch: true as const,
  noWorktreeCreated: true as const,
  noPatchApplied: true as const,
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
};

export function auditVeraImplementationRunPrepareRequested(
  taskId: string,
  detail: {
    preparedBy: string;
    veraWorkOrderId?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_RUN_PREPARE_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.TASK,
    entityId: taskId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.preparedBy,
    taskId,
    payload: {
      taskId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      message: "Vera implementation run preparation requested. No execution performed.",
      ...NO_EXECUTION_FLAGS,
    },
  });
}

export function auditVeraImplementationRunPrepared(
  taskId: string,
  runId: string,
  detail: {
    preparedBy: string;
    veraWorkOrderId?: string | null;
    alreadyExisted?: boolean;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_RUN_PREPARED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.preparedBy,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      alreadyExisted: detail.alreadyExisted === true,
      message: "Vera implementation run prepared. Execution remains gated.",
      ...NO_EXECUTION_FLAGS,
    },
  });
}

export function auditVeraExecutionApprovalRequested(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_EXECUTION_APPROVAL_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.requestedBy,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      message: "Vera execution approval requested. No code was executed.",
      ...NO_EXECUTION_FLAGS,
    },
  });
}

export function auditVeraExecutionApprovalRequestRejected(
  taskId: string,
  detail: {
    runId?: string;
    requestedBy?: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_EXECUTION_APPROVAL_REQUEST_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: detail.runId ?? taskId,
    actorType: detail.requestedBy
      ? AUDIT_ACTOR_TYPES.HUMAN
      : AUDIT_ACTOR_TYPES.SYSTEM,
    ...(detail.requestedBy ? { actorLabel: detail.requestedBy } : {}),
    taskId,
    ...(detail.runId ? { runId: detail.runId } : {}),
    payload: {
      taskId,
      runId: detail.runId ?? null,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      reasonCode: detail.reasonCode,
      message: detail.message,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...NO_EXECUTION_FLAGS,
    },
  });
}

export function auditVeraImplementationRunPrepareRejected(
  taskId: string,
  detail: {
    preparedBy?: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_RUN_PREPARE_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.TASK,
    entityId: taskId,
    actorType: detail.preparedBy
      ? AUDIT_ACTOR_TYPES.HUMAN
      : AUDIT_ACTOR_TYPES.SYSTEM,
    ...(detail.preparedBy ? { actorLabel: detail.preparedBy } : {}),
    taskId,
    payload: {
      taskId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      reasonCode: detail.reasonCode,
      message: detail.message,
      ...NO_EXECUTION_FLAGS,
    },
  });
}
