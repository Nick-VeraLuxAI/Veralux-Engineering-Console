/** Default lifecycle applicator that reuses the existing Phase 2U gate. */

import {
  reviewVeraPostPatchQualityReport,
  type ReviewVeraPostPatchQualityReportResult,
} from "../../../bridge/review-vera-post-patch-quality-report";

/**
 * Builds an applyLifecycle callback that calls the existing
 * `reviewVeraPostPatchQualityReport` implementation (not a parallel gate).
 */
export function createExistingQualityReportLifecycleApplicator(): (input: {
  runId: string;
  decision: "approved" | "rejected";
  confirmationText: string;
  reviewer: string;
  reviewerNote?: string | null;
}) => {
  nextStep: string;
  runStatus: string;
  priorStep?: string;
  priorStatus?: string;
  result: ReviewVeraPostPatchQualityReportResult;
} {
  return (input) => {
    const prior = {
      priorStatus: "waiting_for_approval",
      priorStep: "implementation_post_patch_quality_gates_completed",
    };
    const result = reviewVeraPostPatchQualityReport({
      runId: input.runId,
      decision: input.decision,
      confirmationText: input.confirmationText,
      reviewer: input.reviewer,
      reviewerNote: input.reviewerNote,
    });
    return {
      nextStep: result.nextStep,
      runStatus: result.run.status,
      priorStep: prior.priorStep,
      priorStatus: prior.priorStatus,
      result,
    };
  };
}
