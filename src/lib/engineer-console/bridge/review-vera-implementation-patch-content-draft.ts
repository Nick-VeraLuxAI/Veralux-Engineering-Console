import {
  auditVeraImplementationPatchContentDraftApproved,
  auditVeraImplementationPatchContentDraftRejected,
  auditVeraImplementationPatchContentDraftReviewBlocked,
  auditVeraImplementationPatchContentDraftReviewFailed,
  auditVeraImplementationPatchContentDraftReviewRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPatchContentDraftReviewReadiness } from "./vera-patch-content-draft-review-readiness";
import {
  getVeraImplementationPatchContentDraftReviewDecision,
  hasVeraImplementationPatchContentDraftReviewDecision,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
  type VeraImplementationPatchContentDraftReviewDecision,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION,
} from "../worker/vera-implementation-patch-content-draft-types";

export class VeraImplementationPatchContentDraftReviewError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraImplementationPatchContentDraftReviewError";
    this.code = code;
    this.status = status;
  }
}

export type ReviewVeraImplementationPatchContentDraftInput = {
  runId: string;
  decision: VeraImplementationPatchContentDraftReviewDecision;
  confirmationText: string;
  reviewer: string;
  reviewerNote?: string | null;
};

export type ReviewVeraImplementationPatchContentDraftResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  decision: VeraImplementationPatchContentDraftReviewDecision;
  draftPath: string | null;
  draftHash: string | null;
  entryCount: number;
  nextStep: string;
  warning: string;
};

function expectedConfirmationPhrase(
  decision: VeraImplementationPatchContentDraftReviewDecision,
): string {
  return decision === "approved"
    ? VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION
    : VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION;
}

export function reviewVeraImplementationPatchContentDraft(
  input: ReviewVeraImplementationPatchContentDraftInput,
): ReviewVeraImplementationPatchContentDraftResult {
  const runId = input.runId.trim();
  const reviewer = input.reviewer.trim() || "operator";
  const decision = input.decision;
  const reviewerNote = input.reviewerNote?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationPatchContentDraftReviewBlocked("", "", {
      reviewer,
      decision,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraImplementationPatchContentDraftReviewError("NOT_FOUND", "Run not found.", 404);
  }

  const existingDecision = getVeraImplementationPatchContentDraftReviewDecision(
    run.governanceNotes,
  );
  if (existingDecision) {
    const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
    auditVeraImplementationPatchContentDraftReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId: governanceNotes.veraWorkOrderId ?? null,
      reasonCode: "PATCH_CONTENT_DRAFT_REVIEW_ALREADY_RECORDED",
      message: `Vera patch content draft review decision already recorded: ${existingDecision}.`,
      draftPath: governanceNotes.veraImplementationPatchContentDraftPath ?? null,
      draftHash: governanceNotes.veraImplementationPatchContentDraftHash ?? null,
      entryCount: governanceNotes.veraImplementationPatchContentDraftEntryCount ?? 0,
    });
    throw new VeraImplementationPatchContentDraftReviewError(
      "PATCH_CONTENT_DRAFT_REVIEW_ALREADY_RECORDED",
      `Vera patch content draft review decision already recorded: ${existingDecision}.`,
      409,
    );
  }

  const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
  const veraWorkOrderId = readiness.veraWorkOrderId;
  const entryCount = readiness.draftSummary?.entryCount ?? 0;

  auditVeraImplementationPatchContentDraftReviewRequested(run.taskId, run.id, {
    reviewer,
    decision,
    veraWorkOrderId,
    draftPath: readiness.draftPath,
    draftHash: readiness.draftHash,
    entryCount,
    reviewerNote,
  });

  const confirmation = input.confirmationText.trim();
  const expectedPhrase = expectedConfirmationPhrase(decision);
  if (confirmation !== expectedPhrase) {
    auditVeraImplementationPatchContentDraftReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${expectedPhrase}`,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount,
    });
    throw new VeraImplementationPatchContentDraftReviewError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${expectedPhrase}`,
    );
  }

  if (!readiness.safeToReviewPatchContentDraft) {
    const message = readiness.reasons.join(" ");
    auditVeraImplementationPatchContentDraftReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount,
    });
    throw new VeraImplementationPatchContentDraftReviewError("READINESS_FAILED", message);
  }

  const reviewedAt = new Date().toISOString();
  const nextStep =
    decision === "approved"
      ? VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP
      : VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP;

  const updated = updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: nextStep,
    completedAt: null,
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationPatchContentDraftReviewDecision: decision,
      veraImplementationPatchContentDraftReviewedBy: reviewer,
      veraImplementationPatchContentDraftReviewedAt: reviewedAt,
      veraImplementationPatchContentDraftReviewNote: reviewerNote,
    }),
    agentMessage:
      decision === "approved"
        ? "Vera patch content draft approved. Patch application remains separately gated."
        : "Vera patch content draft rejected. No patch was applied.",
  });

  if (!updated) {
    auditVeraImplementationPatchContentDraftReviewFailed(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "RUN_UPDATE_FAILED",
      message: "Failed to persist Vera patch content draft review decision.",
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount,
    });
    throw new VeraImplementationPatchContentDraftReviewError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera patch content draft review decision.",
      500,
    );
  }

  if (decision === "approved") {
    auditVeraImplementationPatchContentDraftApproved(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount,
      reviewerNote,
    });
  } else {
    auditVeraImplementationPatchContentDraftRejected(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount,
      reviewerNote,
    });
  }

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    decision,
    draftPath: readiness.draftPath,
    draftHash: readiness.draftHash,
    entryCount,
    nextStep,
    warning:
      "Patch application, commit, PR, merge, deploy, and release remain separately gated.",
  };
}

export function hasVeraPatchContentDraftReviewBeenCompleted(run: EngineeringRun): boolean {
  return hasVeraImplementationPatchContentDraftReviewDecision(run.governanceNotes);
}
