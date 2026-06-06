import {
  auditVeraImplementationArtifactApproved,
  auditVeraImplementationArtifactRejected,
  auditVeraImplementationArtifactReviewBlocked,
  auditVeraImplementationArtifactReviewFailed,
  auditVeraImplementationArtifactReviewRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraArtifactReviewReadiness } from "./vera-artifact-review-readiness";
import {
  getVeraImplementationArtifactReviewDecision,
  hasVeraImplementationArtifactReviewDecision,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
  VERA_IMPLEMENTATION_ARTIFACT_APPROVE_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_ARTIFACT_REJECT_CONFIRMATION_PHRASE,
  type VeraImplementationArtifactReviewDecision,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP,
} from "../worker/vera-implementation-artifact-types";

export class VeraImplementationArtifactReviewError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraImplementationArtifactReviewError";
    this.code = code;
    this.status = status;
  }
}

export type ReviewVeraImplementationArtifactInput = {
  runId: string;
  decision: VeraImplementationArtifactReviewDecision;
  confirmationText: string;
  reviewer: string;
  reviewerNote?: string | null;
};

export type ReviewVeraImplementationArtifactResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  decision: VeraImplementationArtifactReviewDecision;
  artifactPath: string | null;
  artifactHash: string | null;
  nextStep: string;
  warning: string;
};

function expectedConfirmationPhrase(
  decision: VeraImplementationArtifactReviewDecision,
): string {
  return decision === "approved"
    ? VERA_IMPLEMENTATION_ARTIFACT_APPROVE_CONFIRMATION_PHRASE
    : VERA_IMPLEMENTATION_ARTIFACT_REJECT_CONFIRMATION_PHRASE;
}

export function reviewVeraImplementationArtifact(
  input: ReviewVeraImplementationArtifactInput,
): ReviewVeraImplementationArtifactResult {
  const runId = input.runId.trim();
  const reviewer = input.reviewer.trim() || "operator";
  const decision = input.decision;
  const reviewerNote = input.reviewerNote?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationArtifactReviewBlocked("", "", {
      reviewer,
      decision,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraImplementationArtifactReviewError("NOT_FOUND", "Run not found.", 404);
  }

  const existingDecision = getVeraImplementationArtifactReviewDecision(run.governanceNotes);
  if (existingDecision) {
    auditVeraImplementationArtifactReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId: parseVeraRunGovernanceNotes(run.governanceNotes).veraWorkOrderId ?? null,
      reasonCode: "DECISION_ALREADY_RECORDED",
      message: `Vera artifact review decision already recorded: ${existingDecision}.`,
    });
    throw new VeraImplementationArtifactReviewError(
      "DECISION_ALREADY_RECORDED",
      `Vera artifact review decision already recorded: ${existingDecision}.`,
      409,
    );
  }

  const readiness = assessVeraArtifactReviewReadiness(run.id);
  const veraWorkOrderId = readiness.veraWorkOrderId;

  auditVeraImplementationArtifactReviewRequested(run.taskId, run.id, {
    reviewer,
    decision,
    veraWorkOrderId,
    artifactPath: readiness.artifactPath,
    artifactHash: readiness.artifactHash,
    reviewerNote,
  });

  const confirmation = input.confirmationText.trim();
  const expectedPhrase = expectedConfirmationPhrase(decision);
  if (confirmation !== expectedPhrase) {
    auditVeraImplementationArtifactReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${expectedPhrase}`,
      artifactPath: readiness.artifactPath,
      artifactHash: readiness.artifactHash,
    });
    throw new VeraImplementationArtifactReviewError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${expectedPhrase}`,
    );
  }

  if (!readiness.safeToReviewArtifact) {
    const message = readiness.reasons.join(" ");
    auditVeraImplementationArtifactReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      artifactPath: readiness.artifactPath,
      artifactHash: readiness.artifactHash,
    });
    throw new VeraImplementationArtifactReviewError("READINESS_FAILED", message);
  }

  const reviewedAt = new Date().toISOString();
  const nextStep =
    decision === "approved"
      ? VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP
      : VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP;

  const updated = updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: nextStep,
    completedAt: null,
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationArtifactReviewDecision: decision,
      veraImplementationArtifactReviewedBy: reviewer,
      veraImplementationArtifactReviewedAt: reviewedAt,
      veraImplementationArtifactReviewNote: reviewerNote,
    }),
    agentMessage:
      decision === "approved"
        ? "Vera implementation artifact approved. Next gated phases remain separate."
        : "Vera implementation artifact rejected. No patch/commit/PR/merge/deploy performed.",
  });

  if (!updated) {
    auditVeraImplementationArtifactReviewFailed(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "RUN_UPDATE_FAILED",
      message: "Failed to persist Vera artifact review decision.",
    });
    throw new VeraImplementationArtifactReviewError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera artifact review decision.",
      500,
    );
  }

  if (decision === "approved") {
    auditVeraImplementationArtifactApproved(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      artifactPath: readiness.artifactPath,
      artifactHash: readiness.artifactHash,
      reviewerNote,
    });
  } else {
    auditVeraImplementationArtifactRejected(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      artifactPath: readiness.artifactPath,
      artifactHash: readiness.artifactHash,
      reviewerNote,
    });
  }

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    decision,
    artifactPath: readiness.artifactPath,
    artifactHash: readiness.artifactHash,
    nextStep,
    warning:
      "PR, merge, deploy, release, commit, and patch application remain separately gated.",
  };
}

export function hasVeraArtifactReviewBeenCompleted(run: EngineeringRun): boolean {
  return hasVeraImplementationArtifactReviewDecision(run.governanceNotes);
}
