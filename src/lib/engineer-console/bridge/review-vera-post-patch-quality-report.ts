import {
  auditVeraPostPatchQualityReportApproved,
  auditVeraPostPatchQualityReportRejected,
  auditVeraPostPatchQualityReportReviewBlocked,
  auditVeraPostPatchQualityReportReviewFailed,
  auditVeraPostPatchQualityReportReviewRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPostPatchQualityReportReviewReadiness } from "./vera-post-patch-quality-report-review-readiness";
import {
  getVeraPostPatchQualityReportReviewDecision,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
  type VeraPostPatchQualityReportReviewDecision,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
} from "../worker/vera-post-patch-quality-report-types";

export class VeraPostPatchQualityReportReviewError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraPostPatchQualityReportReviewError";
    this.code = code;
    this.status = status;
  }
}

export type ReviewVeraPostPatchQualityReportInput = {
  runId: string;
  decision: VeraPostPatchQualityReportReviewDecision;
  confirmationText: string;
  reviewer: string;
  reviewerNote?: string | null;
};

export type ReviewVeraPostPatchQualityReportResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  decision: VeraPostPatchQualityReportReviewDecision;
  qualityReportPath: string | null;
  qualityReportHash: string | null;
  gateCount: number;
  overallStatus: string | null;
  nextStep: string;
  warning: string;
};

function expectedConfirmationPhrase(
  decision: VeraPostPatchQualityReportReviewDecision,
): string {
  return decision === "approved"
    ? VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION
    : VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION;
}

/**
 * Fail-closed duplicate protection:
 * - already approved → POST_PATCH_QUALITY_REPORT_ALREADY_APPROVED (409)
 * - already rejected → POST_PATCH_QUALITY_REPORT_REVIEW_ALREADY_RECORDED (409)
 * Re-approval after rejection is intentionally blocked; a new governed path
 * must be designed before rejection can be overturned.
 */
export function reviewVeraPostPatchQualityReport(
  input: ReviewVeraPostPatchQualityReportInput,
): ReviewVeraPostPatchQualityReportResult {
  const runId = input.runId.trim();
  const reviewer = input.reviewer.trim() || "operator";
  const decision = input.decision;
  const reviewerNote = input.reviewerNote?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraPostPatchQualityReportReviewBlocked("", "", {
      reviewer,
      decision,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraPostPatchQualityReportReviewError("NOT_FOUND", "Run not found.", 404);
  }

  const existingDecision = getVeraPostPatchQualityReportReviewDecision(run.governanceNotes);
  if (existingDecision) {
    const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
    const reasonCode =
      existingDecision === "approved"
        ? "POST_PATCH_QUALITY_REPORT_ALREADY_APPROVED"
        : "POST_PATCH_QUALITY_REPORT_REVIEW_ALREADY_RECORDED";
    const message =
      existingDecision === "approved"
        ? "Vera post-patch quality report is already approved."
        : `Vera post-patch quality report review decision already recorded: ${existingDecision}.`;
    auditVeraPostPatchQualityReportReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId: governanceNotes.veraWorkOrderId ?? null,
      reasonCode,
      message,
      qualityReportPath: governanceNotes.veraPostPatchQualityReportPath ?? null,
      qualityReportHash: governanceNotes.veraPostPatchQualityReportHash ?? null,
    });
    throw new VeraPostPatchQualityReportReviewError(reasonCode, message, 409);
  }

  const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
  const veraWorkOrderId = readiness.veraWorkOrderId;
  const gateCount = readiness.reportSummary?.gateCount ?? 0;
  const overallStatus = readiness.reportSummary?.overallStatus ?? null;

  auditVeraPostPatchQualityReportReviewRequested(run.taskId, run.id, {
    reviewer,
    decision,
    veraWorkOrderId,
    qualityReportPath: readiness.qualityReportPath,
    qualityReportHash: readiness.qualityReportHash,
    gateCount,
    overallStatus,
    reviewerNote,
  });

  // Exact match only — no trim, no normalization, no case folding.
  const expectedPhrase = expectedConfirmationPhrase(decision);
  if (input.confirmationText !== expectedPhrase) {
    auditVeraPostPatchQualityReportReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${expectedPhrase}`,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      gateCount,
      overallStatus,
    });
    throw new VeraPostPatchQualityReportReviewError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${expectedPhrase}`,
    );
  }

  if (!readiness.safeToReviewPostPatchQualityReport) {
    const message = readiness.reasons.join(" ");
    auditVeraPostPatchQualityReportReviewBlocked(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      gateCount,
      overallStatus,
    });
    throw new VeraPostPatchQualityReportReviewError("READINESS_FAILED", message);
  }

  const reviewedAt = new Date().toISOString();
  const nextStep =
    decision === "approved"
      ? VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP
      : VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP;

  const governancePatch =
    decision === "approved"
      ? {
          veraPostPatchQualityReportReviewDecision: decision,
          veraPostPatchQualityReportReviewedBy: reviewer,
          veraPostPatchQualityReportReviewedAt: reviewedAt,
          veraPostPatchQualityReportReviewNote: reviewerNote,
          veraPostPatchQualityReportApprovedHash: readiness.qualityReportHash,
        }
      : {
          veraPostPatchQualityReportReviewDecision: decision,
          veraPostPatchQualityReportReviewedBy: reviewer,
          veraPostPatchQualityReportReviewedAt: reviewedAt,
          veraPostPatchQualityReportReviewNote: reviewerNote,
        };

  const updated = updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: nextStep,
    completedAt: null,
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, governancePatch),
    agentMessage:
      decision === "approved"
        ? "Vera post-patch quality report approved. Commit proposal remains separately gated."
        : "Vera post-patch quality report rejected. No commit proposal was created.",
  });

  if (!updated) {
    auditVeraPostPatchQualityReportReviewFailed(run.taskId, run.id, {
      reviewer,
      decision,
      veraWorkOrderId,
      reasonCode: "RUN_UPDATE_FAILED",
      message: "Failed to persist Vera post-patch quality report review decision.",
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      gateCount,
      overallStatus,
    });
    throw new VeraPostPatchQualityReportReviewError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera post-patch quality report review decision.",
      500,
    );
  }

  if (decision === "approved") {
    auditVeraPostPatchQualityReportApproved(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      gateCount,
      overallStatus,
      reviewerNote,
    });
  } else {
    auditVeraPostPatchQualityReportRejected(run.taskId, run.id, {
      reviewer,
      veraWorkOrderId,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      gateCount,
      overallStatus,
      reviewerNote,
    });
  }

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    decision,
    qualityReportPath: readiness.qualityReportPath,
    qualityReportHash: readiness.qualityReportHash,
    gateCount,
    overallStatus,
    nextStep,
    warning:
      "Commit proposal, commit, PR, merge, deploy, and release remain separately gated.",
  };
}
