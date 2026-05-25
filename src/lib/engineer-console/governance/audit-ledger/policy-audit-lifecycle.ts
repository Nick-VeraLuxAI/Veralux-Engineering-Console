import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { PolicyResultStatus } from "../policy-results/policy-types";

export function auditPolicyEvaluationStarted(
  runId: string,
  taskId: string | null,
  payload: { evaluationId: string; policyVersion: string; policyHash: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION_STARTED,
    entityType: AUDIT_ENTITY_TYPES.POLICY,
    entityId: payload.evaluationId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      evaluationId: payload.evaluationId,
      policyVersion: payload.policyVersion,
      policyHash: payload.policyHash,
    },
  });
}

export function auditPolicyEvaluationCompleted(
  runId: string,
  taskId: string | null,
  payload: {
    evaluationId: string;
    policyVersion: string;
    policyHash: string;
    status: PolicyResultStatus;
    blockerCount: number;
    warningCount: number;
    reviewCount: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.POLICY,
    entityId: payload.evaluationId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      evaluationId: payload.evaluationId,
      policyVersion: payload.policyVersion,
      policyHash: payload.policyHash,
      status: payload.status,
      blockerCount: payload.blockerCount,
      warningCount: payload.warningCount,
      reviewCount: payload.reviewCount,
    },
  });
}

export function auditPolicyEvaluationFailed(
  runId: string,
  taskId: string | null,
  payload: { evaluationId: string; message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.POLICY,
    entityId: payload.evaluationId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      evaluationId: payload.evaluationId,
      message: payload.message.slice(0, 500),
    },
  });
}
