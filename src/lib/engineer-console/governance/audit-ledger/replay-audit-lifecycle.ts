import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { ReplayVerificationStatus } from "../replay-verification/replay-verification-types";

export function auditReplayVerificationStarted(
  runId: string,
  taskId: string | null,
  payload: { verificationId: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REPLAY_VERIFICATION_STARTED,
    entityType: AUDIT_ENTITY_TYPES.REPLAY,
    entityId: payload.verificationId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: { runId, verificationId: payload.verificationId },
  });
}

export function auditReplayVerificationCompleted(
  runId: string,
  taskId: string | null,
  payload: {
    verificationId: string;
    status: ReplayVerificationStatus;
    passed: number;
    warnings: number;
    failed: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REPLAY_VERIFICATION_COMPLETED,
    entityType: AUDIT_ENTITY_TYPES.REPLAY,
    entityId: payload.verificationId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      verificationId: payload.verificationId,
      status: payload.status,
      passed: payload.passed,
      warnings: payload.warnings,
      failed: payload.failed,
    },
  });
}

export function auditReplayVerificationFailed(
  runId: string,
  taskId: string | null,
  payload: { verificationId: string; message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REPLAY_VERIFICATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.REPLAY,
    entityId: payload.verificationId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      verificationId: payload.verificationId,
      message: payload.message.slice(0, 500),
    },
  });
}
