import type { AuditEventRecord } from "../../governance/audit-ledger/audit-ledger-types";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../../governance/audit-ledger/append-audit-event";
import type { HardReleaseGateAction, HardReleaseGateEvaluation } from "./release-gate-types";

export function auditHardReleaseGateEvaluated(
  runId: string,
  taskId: string | null,
  payload: {
    action: HardReleaseGateAction;
    gateEnabled: boolean;
    status: string;
    blockerCount: number;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_EVALUATED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      actionAttempted: payload.action,
      gateEnabled: payload.gateEnabled,
      status: payload.status,
      blockerCount: payload.blockerCount,
    },
  });
}

export function auditHardReleaseGateBlocked(
  runId: string,
  taskId: string | null,
  payload: {
    action: HardReleaseGateAction;
    blockerCount: number;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_BLOCKED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      actionAttempted: payload.action,
      gateEnabled: true,
      status: "blocked",
      blockerCount: payload.blockerCount,
    },
  });
}

export function auditHardReleaseGatePassed(
  runId: string,
  taskId: string | null,
  payload: {
    action: HardReleaseGateAction;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_PASSED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      actionAttempted: payload.action,
      gateEnabled: true,
      status: "passed",
      blockerCount: 0,
    },
  });
}

export function recordHardReleaseGateAudit(
  runId: string,
  taskId: string | null,
  evaluation: HardReleaseGateEvaluation,
  actorLabel: string,
): void {
  if (!evaluation.enabled) return;

  auditHardReleaseGateEvaluated(runId, taskId, {
    action: evaluation.action,
    gateEnabled: true,
    status: evaluation.status,
    blockerCount: evaluation.blockers.length,
    actorLabel,
  });

  if (evaluation.status === "blocked") {
    auditHardReleaseGateBlocked(runId, taskId, {
      action: evaluation.action,
      blockerCount: evaluation.blockers.length,
      actorLabel,
    });
  } else {
    auditHardReleaseGatePassed(runId, taskId, {
      action: evaluation.action,
      actorLabel,
    });
  }
}
