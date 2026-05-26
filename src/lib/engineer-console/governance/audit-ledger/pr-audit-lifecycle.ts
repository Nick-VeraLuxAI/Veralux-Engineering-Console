import type { AuditEventRecord } from "./audit-ledger-types";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from "./audit-event-types";
import { requireAuditEvent } from "./append-audit-event";
import type { PrReadinessStatus } from "../../release/pr-creation/pr-creation-types";

export function auditPrReadinessEvaluated(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId?: string;
    readinessStatus: PrReadinessStatus;
    blockerCount: number;
    warningCount: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_READINESS_EVALUATED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId ?? runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId ?? null,
      readinessStatus: payload.readinessStatus,
      blockerCount: payload.blockerCount,
      warningCount: payload.warningCount,
    },
  });
}

export function auditCommitCreated(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId: string;
    commitShaPrefix: string;
    actorType: string;
    actorLabel: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.COMMIT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: payload.actorType as "human" | "system" | "model",
    actorLabel: payload.actorLabel,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      commitShaPrefix: payload.commitShaPrefix,
    },
  });
}

export function auditCommitCreationFailed(
  runId: string,
  taskId: string | null,
  payload: { prRequestId: string; message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.COMMIT_CREATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      message: payload.message.slice(0, 300),
    },
  });
}

export function auditPrCreationStarted(
  runId: string,
  taskId: string | null,
  payload: { prRequestId: string; branchName: string; baseBranch: string; draft: boolean },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_CREATION_STARTED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      branchName: payload.branchName,
      baseBranch: payload.baseBranch,
      draft: payload.draft,
    },
  });
}

export function auditPrCreationResumed(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId: string;
    branchName: string;
    baseBranch: string;
    reason: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_CREATION_RESUMED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      branchName: payload.branchName,
      baseBranch: payload.baseBranch,
      reason: payload.reason.slice(0, 200),
    },
  });
}

export function auditPrStateReconciled(
  runId: string,
  taskId: string | null,
  payload: {
    runBranchName: string | null;
    currentBranchName: string | null;
    reusableCommitShaPrefix: string | null;
    reusableCommitSource: string;
    remoteBranchExists: boolean;
    canResume: boolean;
    manualRecoveryRequired: boolean;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_STATE_RECONCILED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      runBranchName: payload.runBranchName,
      currentBranchName: payload.currentBranchName,
      reusableCommitShaPrefix: payload.reusableCommitShaPrefix,
      reusableCommitSource: payload.reusableCommitSource,
      remoteBranchExists: payload.remoteBranchExists,
      canResume: payload.canResume,
      manualRecoveryRequired: payload.manualRecoveryRequired,
    },
  });
}

export function auditPrExistingCommitReused(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId: string;
    branchName: string;
    commitShaPrefix: string;
    reason: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_EXISTING_COMMIT_REUSED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      branchName: payload.branchName,
      commitShaPrefix: payload.commitShaPrefix,
      reason: payload.reason.slice(0, 200),
    },
  });
}

export function auditPrExistingRemoteBranchReused(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId: string;
    branchName: string;
    commitShaPrefix: string | null;
    reason: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_EXISTING_REMOTE_BRANCH_REUSED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      branchName: payload.branchName,
      commitShaPrefix: payload.commitShaPrefix,
      reason: payload.reason.slice(0, 200),
    },
  });
}

export function auditPrExistingDetected(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId: string;
    branchName: string;
    commitShaPrefix: string | null;
    prUrl: string;
    reason: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_EXISTING_PR_DETECTED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      branchName: payload.branchName,
      commitShaPrefix: payload.commitShaPrefix,
      prUrl: payload.prUrl,
      reason: payload.reason.slice(0, 200),
    },
  });
}

export function auditPrCreated(
  runId: string,
  taskId: string | null,
  payload: {
    prRequestId: string;
    prUrl: string;
    commitShaPrefix: string;
    readinessStatus: PrReadinessStatus;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_CREATED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      prUrl: payload.prUrl,
      commitShaPrefix: payload.commitShaPrefix,
      readinessStatus: payload.readinessStatus,
    },
  });
}

export function auditPrCreationFailed(
  runId: string,
  taskId: string | null,
  payload: { prRequestId: string; message: string },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.PR_CREATION_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RELEASE,
    entityId: payload.prRequestId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: taskId ?? undefined,
    runId,
    payload: {
      runId,
      prRequestId: payload.prRequestId,
      message: payload.message.slice(0, 300),
    },
  });
}
