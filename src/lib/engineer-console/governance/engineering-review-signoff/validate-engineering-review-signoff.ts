import { getRunById } from "../../run-manager/run-manager";
import { ingestHermesWorkerEvidenceForRun } from "../../hermes-worker/hermes-evidence-ingest";
import type { HermesWorkerEvidenceSummary } from "../../hermes-worker/hermes-evidence-types";
import {
  ENGINEERING_REVIEW_SIGNOFF_DECISIONS,
  type EngineeringReviewSignoffDecision,
} from "./engineering-review-signoff-types";

export class EngineeringReviewSignoffError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "EngineeringReviewSignoffError";
    this.code = code;
    this.status = status;
  }
}

export function isHermesPatchWorkflow(summary: HermesWorkerEvidenceSummary): boolean {
  return summary.patchProposal.available || summary.dispatchId !== null;
}

export function qualityGatesSatisfiedForApproval(
  summary: HermesWorkerEvidenceSummary["postApplyQualityGates"],
): boolean {
  if (summary.status !== "completed") return false;
  if (summary.overallStatus === "passed") return true;
  return summary.failedCount === 0 && summary.passedCount > 0;
}

export function validateEngineeringReviewSignoffInput(input: {
  runId: string;
  decision: string;
  reviewer: string;
  reason: string;
  qualityGateOverride?: boolean;
}): {
  runId: string;
  decision: EngineeringReviewSignoffDecision;
  reviewer: string;
  reason: string;
  qualityGateOverride: boolean;
  hermesSummary: HermesWorkerEvidenceSummary;
} {
  const run = getRunById(input.runId);
  if (!run) {
    throw new EngineeringReviewSignoffError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const decision = input.decision?.trim() as EngineeringReviewSignoffDecision;
  if (!ENGINEERING_REVIEW_SIGNOFF_DECISIONS.includes(decision)) {
    throw new EngineeringReviewSignoffError("Invalid review decision", "INVALID_DECISION");
  }

  const reviewer = input.reviewer?.trim();
  if (!reviewer) {
    throw new EngineeringReviewSignoffError("Reviewer is required", "REVIEWER_REQUIRED");
  }

  const reason = input.reason?.trim();
  if (!reason) {
    throw new EngineeringReviewSignoffError("Review reason is required", "REASON_REQUIRED");
  }

  const hermesSummary = ingestHermesWorkerEvidenceForRun(input.runId).summary;

  if (decision === "approved") {
    if (isHermesPatchWorkflow(hermesSummary)) {
      if (hermesSummary.patchApplication.status === "rolled_back") {
        throw new EngineeringReviewSignoffError(
          "Cannot approve after patch rollback; use blocked, needs_changes, or rejected",
          "PATCH_ROLLED_BACK",
        );
      }
      if (hermesSummary.patchApplication.status !== "patch_applied") {
        throw new EngineeringReviewSignoffError(
          "Hermes patch must be applied before approval",
          "PATCH_NOT_APPLIED",
        );
      }
      if (
        !qualityGatesSatisfiedForApproval(hermesSummary.postApplyQualityGates) &&
        !input.qualityGateOverride
      ) {
        throw new EngineeringReviewSignoffError(
          "Post-apply quality gates must pass or qualityGateOverride must be true with documented reason",
          "QUALITY_GATES_OVERRIDE_REQUIRED",
        );
      }
    }
  }

  return {
    runId: input.runId,
    decision,
    reviewer,
    reason,
    qualityGateOverride: input.qualityGateOverride === true,
    hermesSummary,
  };
}
