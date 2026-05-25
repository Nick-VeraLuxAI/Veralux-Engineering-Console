import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { ReviewStageStatus, ReviewStageType } from "../review-stages/review-stage-types";

export function auditReviewStagesCreated(
  runId: string,
  taskId: string | null,
  payload: { stageCount: number; requiredCount: number; stages: string[] },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REVIEW_STAGES_CREATED,
    entityType: AUDIT_ENTITY_TYPES.REVIEW_STAGE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      stageCount: payload.stageCount,
      requiredCount: payload.requiredCount,
      stages: payload.stages.slice(0, 10),
    },
  });
}

export function auditReviewStageApproved(
  runId: string,
  taskId: string | null,
  payload: {
    stageId: string;
    stage: ReviewStageType;
    required: boolean;
    reason: string | null;
    actorType: string;
    actorLabel: string;
    evidenceBundleHashPrefix: string | null;
    policyResultId: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REVIEW_STAGE_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.REVIEW_STAGE,
    entityId: payload.stageId,
    actorType: payload.actorType as "human" | "system" | "model",
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      stage: payload.stage,
      status: "approved" as ReviewStageStatus,
      required: payload.required,
      reason: payload.reason?.slice(0, 300) ?? null,
      actorType: payload.actorType,
      actorLabel: payload.actorLabel,
      evidenceBundleHashPrefix: payload.evidenceBundleHashPrefix,
      policyResultId: payload.policyResultId,
    },
  });
}

export function auditReviewStageRejected(
  runId: string,
  taskId: string | null,
  payload: {
    stageId: string;
    stage: ReviewStageType;
    required: boolean;
    reason: string | null;
    actorType: string;
    actorLabel: string;
    notes: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REVIEW_STAGE_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.REVIEW_STAGE,
    entityId: payload.stageId,
    actorType: payload.actorType as "human" | "system" | "model",
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      stage: payload.stage,
      status: "rejected" as ReviewStageStatus,
      required: payload.required,
      reason: payload.reason?.slice(0, 300) ?? null,
      actorType: payload.actorType,
      actorLabel: payload.actorLabel,
      notes: payload.notes.slice(0, 500),
    },
  });
}

export function auditReviewStageSkipped(
  runId: string,
  taskId: string | null,
  payload: {
    stageId: string;
    stage: ReviewStageType;
    required: boolean;
    actorType: string;
    actorLabel: string;
    notes: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REVIEW_STAGE_SKIPPED,
    entityType: AUDIT_ENTITY_TYPES.REVIEW_STAGE,
    entityId: payload.stageId,
    actorType: payload.actorType as "human" | "system" | "model",
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      stage: payload.stage,
      status: "skipped" as ReviewStageStatus,
      required: payload.required,
      actorType: payload.actorType,
      actorLabel: payload.actorLabel,
      notes: payload.notes.slice(0, 500),
    },
  });
}

export function auditReviewStageBlockedApproval(
  runId: string,
  taskId: string | null,
  payload: { pendingStages: string[]; rejectedStages: string[] },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REVIEW_STAGE_BLOCKED_APPROVAL,
    entityType: AUDIT_ENTITY_TYPES.REVIEW_STAGE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      pendingStages: payload.pendingStages.slice(0, 10),
      rejectedStages: payload.rejectedStages.slice(0, 10),
    },
  });
}
