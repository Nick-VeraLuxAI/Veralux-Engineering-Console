import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { AuditEventRecord } from "./audit-ledger-types";
import type { EngineeringReviewSignoffDecision } from "../engineering-review-signoff/engineering-review-signoff-types";

const DECISION_EVENT: Record<EngineeringReviewSignoffDecision, string> = {
  approved: AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_APPROVED,
  needs_changes: AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_NEEDS_CHANGES,
  blocked: AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_BLOCKED,
  rejected: AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_REJECTED,
};

export function auditEngineeringReviewSignoffRequested(
  runId: string,
  taskId: string,
  signoffId: string,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.ENGINEERING_REVIEW,
    entityId: signoffId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: { ...payload, notMerge: true, notDeploy: true },
  });
}

export function auditEngineeringReviewSignoffCreated(
  runId: string,
  taskId: string,
  signoffId: string,
  decision: EngineeringReviewSignoffDecision,
  payload: Record<string, unknown>,
  actorLabel: string,
): AuditEventRecord {
  requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.ENGINEERING_REVIEW_SIGNOFF_CREATED,
    entityType: AUDIT_ENTITY_TYPES.ENGINEERING_REVIEW,
    entityId: signoffId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: { ...payload, decision, notMerge: true, notDeploy: true },
  });
  return requireAuditEvent({
    eventType: DECISION_EVENT[decision],
    entityType: AUDIT_ENTITY_TYPES.ENGINEERING_REVIEW,
    entityId: signoffId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel,
    taskId,
    runId,
    payload: { ...payload, decision, notMerge: true, notDeploy: true },
  });
}
