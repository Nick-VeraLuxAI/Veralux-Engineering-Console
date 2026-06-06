import {
  auditVeraImplementationPatchProposalApproved,
  auditVeraImplementationPatchProposalRejected,
  auditVeraImplementationPatchProposalReviewBlocked,
  auditVeraImplementationPatchProposalReviewFailed,
  auditVeraImplementationPatchProposalReviewRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPatchProposalApprovalReadiness } from "./vera-patch-proposal-approval-readiness";
import {
  getVeraImplementationPatchProposalReviewDecision,
  hasVeraImplementationPatchProposalReviewDecision,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE,
  type VeraImplementationPatchProposalReviewDecision,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP,
} from "../worker/vera-implementation-patch-proposal-types";

export class VeraImplementationPatchProposalReviewError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraImplementationPatchProposalReviewError";
    this.code = code;
    this.status = status;
  }
}

export type ReviewVeraImplementationPatchProposalInput = {
  runId: string;
  decision: VeraImplementationPatchProposalReviewDecision;
  confirmationText: string;
  reviewer: string;
  reviewerNote?: string | null;
};

export type ReviewVeraImplementationPatchProposalResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  decision: VeraImplementationPatchProposalReviewDecision;
  proposalPath: string | null;
  proposalHash: string | null;
  nextStep: string;
  warning: string;
};

function expectedConfirmationPhrase(
  decision: VeraImplementationPatchProposalReviewDecision,
): string {
  return decision === "approved"
    ? VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE
    : VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE;
}

export function reviewVeraImplementationPatchProposal(
  input: ReviewVeraImplementationPatchProposalInput,
): ReviewVeraImplementationPatchProposalResult {
  const runId = input.runId.trim();
  const reviewer = input.reviewer.trim() || "operator";
  const decision = input.decision;
  const reviewerNote = input.reviewerNote?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationPatchProposalReviewBlocked("", "", {
      reviewer,
      decision,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraImplementationPatchProposalReviewError("NOT_FOUND", "Run not found.", 404);
  }

  const existingDecision = getVeraImplementationPatchProposalReviewDecision(run.governanceNotes);
  if (existingDecision) {
    auditVeraImplementationPatchProposalReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId: parseVeraRunGovernanceNotes(run.governanceNotes).veraWorkOrderId ?? null,
      reasonCode: "DECISION_ALREADY_RECORDED",
      message: `Vera patch proposal review decision already recorded: ${existingDecision}.`,
      proposalPath:
        parseVeraRunGovernanceNotes(run.governanceNotes).veraImplementationPatchProposalPath ??
        null,
      proposalHash:
        parseVeraRunGovernanceNotes(run.governanceNotes).veraImplementationPatchProposalHash ??
        null,
    });
    throw new VeraImplementationPatchProposalReviewError(
      "DECISION_ALREADY_RECORDED",
      `Vera patch proposal review decision already recorded: ${existingDecision}.`,
      409,
    );
  }

  const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
  const veraWorkOrderId = readiness.veraWorkOrderId;

  auditVeraImplementationPatchProposalReviewRequested(run.taskId, run.id, {
    reviewer,
    decision,
    veraWorkOrderId,
    proposalPath: readiness.proposalPath,
    proposalHash: readiness.proposalHash,
    reviewerNote,
  });

  const confirmation = input.confirmationText.trim();
  const expectedPhrase = expectedConfirmationPhrase(decision);
  if (confirmation !== expectedPhrase) {
    auditVeraImplementationPatchProposalReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${expectedPhrase}`,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
    });
    throw new VeraImplementationPatchProposalReviewError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${expectedPhrase}`,
    );
  }

  if (!readiness.safeToReviewPatchProposal) {
    const message = readiness.reasons.join(" ");
    auditVeraImplementationPatchProposalReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
    });
    throw new VeraImplementationPatchProposalReviewError("READINESS_FAILED", message);
  }

  const reviewedAt = new Date().toISOString();
  const nextStep =
    decision === "approved"
      ? VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP
      : VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP;

  const updated = updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: nextStep,
    completedAt: null,
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationPatchProposalReviewDecision: decision,
      veraImplementationPatchProposalReviewedBy: reviewer,
      veraImplementationPatchProposalReviewedAt: reviewedAt,
      veraImplementationPatchProposalReviewNote: reviewerNote,
    }),
    agentMessage:
      decision === "approved"
        ? "Vera patch proposal approved. Patch application remains separately gated."
        : "Vera patch proposal rejected. No patch was applied.",
  });

  if (!updated) {
    auditVeraImplementationPatchProposalReviewFailed(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "RUN_UPDATE_FAILED",
      message: "Failed to persist Vera patch proposal review decision.",
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
    });
    throw new VeraImplementationPatchProposalReviewError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera patch proposal review decision.",
      500,
    );
  }

  if (decision === "approved") {
    auditVeraImplementationPatchProposalApproved(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
      reviewerNote,
    });
  } else {
    auditVeraImplementationPatchProposalRejected(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
      reviewerNote,
    });
  }

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    decision,
    proposalPath: readiness.proposalPath,
    proposalHash: readiness.proposalHash,
    nextStep,
    warning:
      "Patch application, commit, PR, merge, deploy, and release remain separately gated.",
  };
}

export function hasVeraPatchProposalReviewBeenCompleted(run: EngineeringRun): boolean {
  return hasVeraImplementationPatchProposalReviewDecision(run.governanceNotes);
}
