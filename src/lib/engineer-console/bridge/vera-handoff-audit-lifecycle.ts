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

const RELEASE_GATED_FLAGS = {
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noPullRequestCreated: true as const,
  noReleasePerformed: true as const,
};

const ARTIFACT_REVIEW_GATED_FLAGS = {
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noReleasePerformed: true as const,
};

export function auditVeraExecutionStartRequested(
  taskId: string,
  runId: string,
  detail: {
    startedBy: string;
    veraWorkOrderId?: string | null;
    readinessOk: boolean;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_EXECUTION_START_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.startedBy,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      readinessOk: detail.readinessOk,
      message: "Vera execution start requested.",
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraExecutionStartAccepted(
  taskId: string,
  runId: string,
  detail: {
    startedBy: string;
    veraWorkOrderId?: string | null;
    centralExecutionFunctionCalled: boolean;
    status: string;
    currentStep: string | null;
    startedAt: string | null;
    branchName: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_EXECUTION_START_ACCEPTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.startedBy,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      centralExecutionFunctionCalled: detail.centralExecutionFunctionCalled,
      workerDispatchAttempted: false,
      worktreeCreationAttempted: false,
      worktreeCreationDelegatedToExecuteRun: true,
      statusChanged: detail.status !== "pending",
      startedAtSet: detail.startedAt !== null,
      branchNameSet: detail.branchName !== null,
      status: detail.status,
      currentStep: detail.currentStep,
      startedAt: detail.startedAt,
      branchName: detail.branchName,
      message: "Vera execution start accepted via central executeRun.",
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraExecutionStartRejected(
  taskId: string,
  detail: {
    runId?: string;
    startedBy?: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_EXECUTION_START_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: detail.runId ?? taskId,
    actorType: detail.startedBy ? AUDIT_ACTOR_TYPES.HUMAN : AUDIT_ACTOR_TYPES.SYSTEM,
    ...(detail.startedBy ? { actorLabel: detail.startedBy } : {}),
    taskId,
    ...(detail.runId ? { runId: detail.runId } : {}),
    payload: {
      taskId,
      runId: detail.runId ?? null,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      reasonCode: detail.reasonCode,
      message: detail.message,
      centralExecutionFunctionCalled: false,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraExecutionStartFailed(
  taskId: string,
  runId: string,
  detail: {
    startedBy: string;
    veraWorkOrderId?: string | null;
    message: string;
    centralExecutionFunctionCalled: boolean;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_EXECUTION_START_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      startedBy: detail.startedBy,
      message: detail.message,
      centralExecutionFunctionCalled: detail.centralExecutionFunctionCalled,
      ...RELEASE_GATED_FLAGS,
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

export function auditVeraImplementationWorkerStarted(
  taskId: string,
  runId: string,
  detail: {
    veraWorkOrderId?: string | null;
    branchName: string;
    repoPath: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_STARTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      branchName: detail.branchName,
      repoPath: detail.repoPath,
      message: "Vera implementation worker started.",
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationArtifactCreated(
  taskId: string,
  runId: string,
  detail: {
    veraWorkOrderId?: string | null;
    branchName: string;
    artifactPath: string | null;
    artifactHash: string | null;
    workerMode: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      branchName: detail.branchName,
      artifactPath: detail.artifactPath,
      artifactHash: detail.artifactHash,
      workerMode: detail.workerMode,
      message: "Vera implementation artifact created.",
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationWorkerBlocked(
  taskId: string,
  runId: string,
  detail: {
    veraWorkOrderId?: string | null;
    branchName: string;
    artifactPath: string | null;
    artifactHash: string | null;
    workerMode: string;
    blockers: string[];
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_BLOCKED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      branchName: detail.branchName,
      artifactPath: detail.artifactPath,
      artifactHash: detail.artifactHash,
      workerMode: detail.workerMode,
      blockers: detail.blockers,
      message: "Vera implementation worker blocked with reviewable artifact.",
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationWorkerFailed(
  taskId: string,
  runId: string,
  detail: {
    veraWorkOrderId?: string | null;
    branchName: string;
    message: string;
    workerMode: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      branchName: detail.branchName,
      workerMode: detail.workerMode,
      message: detail.message,
      ...RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationArtifactReviewRequested(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    artifactPath?: string | null;
    artifactHash?: string | null;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_REVIEW_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      artifactPath: detail.artifactPath ?? null,
      artifactHash: detail.artifactHash ?? null,
      message: "Vera implementation artifact review requested.",
      ...ARTIFACT_REVIEW_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationArtifactApproved(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    veraWorkOrderId?: string | null;
    artifactPath?: string | null;
    artifactHash?: string | null;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: "approved",
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      artifactPath: detail.artifactPath ?? null,
      artifactHash: detail.artifactHash ?? null,
      message: "Vera implementation artifact approved. Patch/commit/PR/merge/deploy remain gated.",
      ...ARTIFACT_REVIEW_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationArtifactRejected(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    veraWorkOrderId?: string | null;
    artifactPath?: string | null;
    artifactHash?: string | null;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: "rejected",
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      artifactPath: detail.artifactPath ?? null,
      artifactHash: detail.artifactHash ?? null,
      message: "Vera implementation artifact rejected. No patch/commit/PR/merge/deploy performed.",
      ...ARTIFACT_REVIEW_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationArtifactReviewBlocked(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    artifactPath?: string | null;
    artifactHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_REVIEW_BLOCKED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reasonCode: detail.reasonCode,
      message: detail.message,
      artifactPath: detail.artifactPath ?? null,
      artifactHash: detail.artifactHash ?? null,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...ARTIFACT_REVIEW_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationArtifactReviewFailed(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    message: string;
    reasonCode: string;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_REVIEW_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reasonCode: detail.reasonCode,
      message: detail.message,
      ...ARTIFACT_REVIEW_GATED_FLAGS,
    },
  });
}

const PATCH_PROPOSAL_GATED_FLAGS = {
  noPatchApplied: true as const,
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noReleasePerformed: true as const,
};

export function auditVeraImplementationPatchProposalRequested(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    sourceArtifactPath?: string | null;
    sourceArtifactHash?: string | null;
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REQUESTED,
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
      requestedBy: detail.requestedBy,
      sourceArtifactPath: detail.sourceArtifactPath ?? null,
      sourceArtifactHash: detail.sourceArtifactHash ?? null,
      note: detail.note ?? null,
      message: "Vera patch proposal creation requested. No patch applied.",
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalCreated(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    sourceArtifactPath?: string | null;
    sourceArtifactHash?: string | null;
    proposalPath?: string | null;
    proposalHash?: string | null;
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_CREATED,
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
      requestedBy: detail.requestedBy,
      sourceArtifactPath: detail.sourceArtifactPath ?? null,
      sourceArtifactHash: detail.sourceArtifactHash ?? null,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      note: detail.note ?? null,
      message:
        "Vera patch proposal created. Patch application, commit, PR, merge, deploy, and release remain gated.",
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalBlocked(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    sourceArtifactPath?: string | null;
    sourceArtifactHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_BLOCKED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      sourceArtifactPath: detail.sourceArtifactPath ?? null,
      sourceArtifactHash: detail.sourceArtifactHash ?? null,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalFailed(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    sourceArtifactPath?: string | null;
    sourceArtifactHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_FAILED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      sourceArtifactPath: detail.sourceArtifactPath ?? null,
      sourceArtifactHash: detail.sourceArtifactHash ?? null,
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalReviewRequested(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    proposalPath?: string | null;
    proposalHash?: string | null;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REVIEW_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      message: "Vera patch proposal review requested.",
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalApproved(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    veraWorkOrderId?: string | null;
    proposalPath?: string | null;
    proposalHash?: string | null;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: "approved",
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      message:
        "Vera patch proposal approved. Patch application, commit, PR, merge, deploy, and release remain gated.",
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalRejected(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    veraWorkOrderId?: string | null;
    proposalPath?: string | null;
    proposalHash?: string | null;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: "rejected",
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      message:
        "Vera patch proposal rejected. No patch/commit/PR/merge/deploy/release performed.",
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalReviewBlocked(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    proposalPath?: string | null;
    proposalHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REVIEW_BLOCKED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reasonCode: detail.reasonCode,
      message: detail.message,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchProposalReviewFailed(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    message: string;
    reasonCode: string;
    proposalPath?: string | null;
    proposalHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REVIEW_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reasonCode: detail.reasonCode,
      message: detail.message,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      ...PATCH_PROPOSAL_GATED_FLAGS,
    },
  });
}

const PATCH_APPLICATION_RELEASE_GATED_FLAGS = {
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noReleasePerformed: true as const,
};

export function auditVeraImplementationPatchApplicationRequested(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    proposalPath?: string | null;
    proposalHash?: string | null;
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED,
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
      requestedBy: detail.requestedBy,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      note: detail.note ?? null,
      message: "Vera patch application requested.",
      noPatchApplied: true,
      ...PATCH_APPLICATION_RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchApplicationApplied(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    proposalPath?: string | null;
    proposalHash?: string | null;
    applicationReportPath?: string | null;
    applicationReportHash?: string | null;
    appliedFiles?: string[];
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED,
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
      requestedBy: detail.requestedBy,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      applicationReportPath: detail.applicationReportPath ?? null,
      applicationReportHash: detail.applicationReportHash ?? null,
      appliedFiles: detail.appliedFiles ?? [],
      note: detail.note ?? null,
      message:
        "Vera patch applied to governed worktree. Commit, PR, merge, deploy, and release remain gated.",
      patchApplied: true,
      ...PATCH_APPLICATION_RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchApplicationBlocked(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    reasonCodes?: string[];
    proposalPath?: string | null;
    proposalHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_BLOCKED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...(detail.reasonCodes ? { reasonCodes: detail.reasonCodes } : {}),
      noPatchApplied: true,
      ...PATCH_APPLICATION_RELEASE_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchApplicationFailed(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    proposalPath?: string | null;
    proposalHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_FAILED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      proposalPath: detail.proposalPath ?? null,
      proposalHash: detail.proposalHash ?? null,
      noPatchApplied: true,
      ...PATCH_APPLICATION_RELEASE_GATED_FLAGS,
    },
  });
}

const PATCH_CONTENT_DRAFT_GATED_FLAGS = {
  noPatchApplied: true as const,
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noReleasePerformed: true as const,
};

export function auditVeraImplementationPatchContentDraftRequested(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    sourceProposalPath?: string | null;
    sourceProposalHash?: string | null;
    note?: string | null;
    entryCount?: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REQUESTED,
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
      requestedBy: detail.requestedBy,
      sourceProposalPath: detail.sourceProposalPath ?? null,
      sourceProposalHash: detail.sourceProposalHash ?? null,
      note: detail.note ?? null,
      entryCount: detail.entryCount ?? 0,
      message: "Vera patch content draft creation requested.",
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftCreated(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    sourceProposalPath?: string | null;
    sourceProposalHash?: string | null;
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_CREATED,
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
      requestedBy: detail.requestedBy,
      sourceProposalPath: detail.sourceProposalPath ?? null,
      sourceProposalHash: detail.sourceProposalHash ?? null,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      note: detail.note ?? null,
      message:
        "Vera patch content draft created. Review, patch application, commit, PR, merge, deploy, and release remain gated.",
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftBlocked(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    reasonCodes?: string[];
    sourceProposalPath?: string | null;
    sourceProposalHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_BLOCKED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      sourceProposalPath: detail.sourceProposalPath ?? null,
      sourceProposalHash: detail.sourceProposalHash ?? null,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...(detail.reasonCodes ? { reasonCodes: detail.reasonCodes } : {}),
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftFailed(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    sourceProposalPath?: string | null;
    sourceProposalHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_FAILED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      sourceProposalPath: detail.sourceProposalPath ?? null,
      sourceProposalHash: detail.sourceProposalHash ?? null,
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftReviewRequested(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      message: "Vera patch content draft review requested.",
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftApproved(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    veraWorkOrderId?: string | null;
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: "approved",
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      message:
        "Vera patch content draft approved. Patch application, commit, PR, merge, deploy, and release remain gated.",
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftRejected(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    veraWorkOrderId?: string | null;
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
    reviewerNote?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: "rejected",
      reviewer: detail.reviewer,
      reviewerNote: detail.reviewerNote ?? null,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      message:
        "Vera patch content draft rejected. No patch/commit/PR/merge/deploy/release performed.",
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftReviewBlocked(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    reasonCodes?: string[];
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_BLOCKED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reasonCode: detail.reasonCode,
      message: detail.message,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...(detail.reasonCodes ? { reasonCodes: detail.reasonCodes } : {}),
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

export function auditVeraImplementationPatchContentDraftReviewFailed(
  taskId: string,
  runId: string,
  detail: {
    reviewer: string;
    decision: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_FAILED,
    entityType: AUDIT_ENTITY_TYPES.RUN,
    entityId: runId,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: detail.reviewer,
    taskId,
    runId,
    payload: {
      taskId,
      runId,
      veraWorkOrderId: detail.veraWorkOrderId ?? null,
      decision: detail.decision,
      reviewer: detail.reviewer,
      reasonCode: detail.reasonCode,
      message: detail.message,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      ...PATCH_CONTENT_DRAFT_GATED_FLAGS,
    },
  });
}

const APPROVED_PATCH_CONTENT_APPLICATION_APPLIED_FLAGS = {
  patchApplied: true as const,
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noReleasePerformed: true as const,
};

const APPROVED_PATCH_CONTENT_APPLICATION_BLOCKED_FLAGS = {
  noPatchApplied: true as const,
  noCommitCreated: true as const,
  noPullRequestCreated: true as const,
  noMergePerformed: true as const,
  noDeploymentPerformed: true as const,
  noReleasePerformed: true as const,
};

export function auditVeraImplementationApprovedPatchContentApplicationRequested(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType:
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_REQUESTED,
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
      requestedBy: detail.requestedBy,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      note: detail.note ?? null,
      message: "Approved Vera patch content draft application requested.",
      ...APPROVED_PATCH_CONTENT_APPLICATION_BLOCKED_FLAGS,
    },
  });
}

export function auditVeraImplementationApprovedPatchContentApplied(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    draftPath?: string | null;
    draftHash?: string | null;
    applicationReportPath?: string | null;
    applicationReportHash?: string | null;
    appliedFiles?: string[];
    note?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLIED,
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
      requestedBy: detail.requestedBy,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      applicationReportPath: detail.applicationReportPath ?? null,
      applicationReportHash: detail.applicationReportHash ?? null,
      appliedFiles: detail.appliedFiles ?? [],
      note: detail.note ?? null,
      message:
        "Approved Vera patch content applied to governed worktree. Commit, PR, merge, deploy, and release remain gated.",
      ...APPROVED_PATCH_CONTENT_APPLICATION_APPLIED_FLAGS,
    },
  });
}

export function auditVeraImplementationApprovedPatchContentApplicationBlocked(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    readinessReasons?: string[];
    reasonCodes?: string[];
    draftPath?: string | null;
    draftHash?: string | null;
    entryCount?: number;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType:
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_BLOCKED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      entryCount: detail.entryCount ?? 0,
      ...(detail.readinessReasons ? { readinessReasons: detail.readinessReasons } : {}),
      ...(detail.reasonCodes ? { reasonCodes: detail.reasonCodes } : {}),
      ...APPROVED_PATCH_CONTENT_APPLICATION_BLOCKED_FLAGS,
    },
  });
}

export function auditVeraImplementationApprovedPatchContentApplicationFailed(
  taskId: string,
  runId: string,
  detail: {
    requestedBy: string;
    veraWorkOrderId?: string | null;
    reasonCode: string;
    message: string;
    draftPath?: string | null;
    draftHash?: string | null;
  },
): AuditEventRecord {
  return requireAuditEvent({
    eventType:
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_FAILED,
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
      requestedBy: detail.requestedBy,
      reasonCode: detail.reasonCode,
      message: detail.message,
      draftPath: detail.draftPath ?? null,
      draftHash: detail.draftHash ?? null,
      ...APPROVED_PATCH_CONTENT_APPLICATION_BLOCKED_FLAGS,
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
