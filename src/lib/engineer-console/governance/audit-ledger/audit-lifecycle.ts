import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { AuditEventRecord } from "./audit-ledger-types";

function systemEvent(
  input: Omit<Parameters<typeof requireAuditEvent>[0], "actorType">,
): AuditEventRecord {
  return requireAuditEvent({ ...input, actorType: AUDIT_ACTOR_TYPES.SYSTEM });
}

export function auditTaskCreated(taskId: string, payload: Record<string, unknown>): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.TASK_CREATED,
    entityType: AUDIT_ENTITY_TYPES.TASK,
    entityId: taskId,
    taskId,
    payload,
  });
}

export function auditTaskUpdated(taskId: string, payload: Record<string, unknown>): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.TASK_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.TASK,
    entityId: taskId,
    taskId,
    payload,
  });
}

export function auditRunCreated(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.RUN_CREATED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditRunStarted(
  runId: string,
  taskId: string,
  payload: Record<string, unknown> = {},
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.RUN_STARTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditBranchCreated(
  runId: string,
  taskId: string,
  branchName: string,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.BRANCH_CREATED,
    entityType: AUDIT_ENTITY_TYPES.BRANCH,
    entityId: branchName,
    taskId,
    runId,
    payload: { branchName },
  });
}

export function auditModelDraftRequested(runId: string, taskId: string): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.MODEL_DRAFT_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.MODEL_DRAFT,
    entityId: runId,
    taskId,
    runId,
    payload: {},
  });
}

export function auditModelDraftCreated(
  runId: string,
  taskId: string,
  draftId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.MODEL_DRAFT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.MODEL_DRAFT,
    entityId: draftId,
    actorType: AUDIT_ACTOR_TYPES.MODEL,
    actorLabel: String(payload.provider ?? "model"),
    taskId,
    runId,
    payload,
  });
}

export function auditModelDraftValidationFailed(
  runId: string,
  taskId: string,
  draftId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.MODEL_DRAFT_VALIDATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.MODEL_DRAFT,
    entityId: draftId,
    actorType: AUDIT_ACTOR_TYPES.MODEL,
    taskId,
    runId,
    payload,
  });
}

export function auditWorkerPlanSubmitted(
  runId: string,
  taskId: string,
  workerPlanId: string,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.WORKER_PLAN_SUBMITTED,
    entityType: AUDIT_ENTITY_TYPES.WORKER_PLAN,
    entityId: workerPlanId,
    taskId,
    runId,
    payload: { workerPlanId },
  });
}

export function auditWorkerPlanValidated(
  runId: string,
  taskId: string,
  workerPlanId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.WORKER_PLAN_VALIDATED,
    entityType: AUDIT_ENTITY_TYPES.WORKER_PLAN,
    entityId: workerPlanId,
    taskId,
    runId,
    payload,
  });
}

export function auditWorkerPlanValidationFailed(
  runId: string,
  taskId: string,
  workerPlanId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.WORKER_PLAN_VALIDATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.WORKER_PLAN,
    entityId: workerPlanId,
    taskId,
    runId,
    payload,
  });
}

export function auditWorkerPlanExecuted(
  runId: string,
  taskId: string,
  workerPlanId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.WORKER_PLAN_EXECUTED,
    entityType: AUDIT_ENTITY_TYPES.WORKER_PLAN,
    entityId: workerPlanId,
    taskId,
    runId,
    payload,
  });
}

export function auditWorkerPlanExecutionFailed(
  runId: string,
  taskId: string,
  workerPlanId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.WORKER_PLAN_EXECUTION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.WORKER_PLAN,
    entityId: workerPlanId,
    taskId,
    runId,
    payload,
  });
}

export function auditQualityGatesStarted(
  runId: string,
  taskId: string,
  payload: Record<string, unknown> = {},
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.QUALITY_GATES_STARTED,
    entityType: AUDIT_ENTITY_TYPES.QUALITY_GATE,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditQualityGatesCompleted(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.QUALITY_GATES_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.QUALITY_GATE,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditGovernanceAssessed(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.GOVERNANCE_ASSESSED,
    entityType: AUDIT_ENTITY_TYPES.GOVERNANCE,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditApprovalReportCreated(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.APPROVAL_REPORT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.APPROVAL,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditRunFailed(
  runId: string,
  taskId: string,
  payload: Record<string, unknown>,
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.RUN_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditRunCompleted(
  runId: string,
  taskId: string,
  payload: Record<string, unknown> = {},
): AuditEventRecord {
  return systemEvent({
    eventType: AUDIT_EVENT_TYPES.RUN_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    taskId,
    runId,
    payload,
  });
}

export function auditHumanApproved(runId: string, taskId: string): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HUMAN_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.APPROVAL,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "operator",
    taskId,
    runId,
    payload: {},
  });
}

export function auditHumanRequestFix(runId: string, taskId: string): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HUMAN_REQUEST_FIX,
    entityType: AUDIT_ENTITY_TYPES.APPROVAL,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "operator",
    taskId,
    runId,
    payload: {},
  });
}

export function auditHumanStopped(runId: string, taskId: string): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HUMAN_STOPPED,
    entityType: AUDIT_ENTITY_TYPES.APPROVAL,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "operator",
    taskId,
    runId,
    payload: {},
  });
}

/** Shared post-change pipeline audits (quality gates → governance → approval report). */
export function auditPostChangePipeline(
  runId: string,
  taskId: string,
  input: {
    governance: { riskLevel: string; canApprove: boolean; issueCount: number };
    gateSummary: { total: number; failed: number; passed: number; skipped: number };
    finalRunStatus: string;
    changedFileCount: number;
    canApprove: boolean;
  },
): void {
  auditGovernanceAssessed(runId, taskId, input.governance);
  auditQualityGatesCompleted(runId, taskId, input.gateSummary);
  auditApprovalReportCreated(runId, taskId, {
    finalRunStatus: input.finalRunStatus,
    changedFileCount: input.changedFileCount,
    canApprove: input.canApprove,
  });
  if (input.finalRunStatus === "failed") {
    auditRunFailed(runId, taskId, { reason: "gates_or_governance" });
  }
}
