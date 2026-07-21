/** Operator acceptance gate — independent from S14 senior execution approval. */

import type {
  DecisionReason,
  OperatorDecisionInput,
  OperatorDecisionRecord,
  SeniorReviewBundle,
} from "./types";
import { newId, utcNow } from "./comparison";

export type AcceptanceResult =
  | { ok: true; decision: OperatorDecisionRecord; bundle: SeniorReviewBundle }
  | { ok: false; reason: DecisionReason; message: string };

/**
 * Validate and build an operator decision bound to exact artifact hashes.
 * Execution approval must never satisfy this gate.
 */
export function validateAndBuildOperatorDecision(
  bundle: SeniorReviewBundle,
  input: OperatorDecisionInput,
  options: { consumedDecisionIds?: Set<string> } = {},
): AcceptanceResult {
  if (input.executionApprovalAsAcceptance) {
    return {
      ok: false,
      reason: "execution_approval_is_not_acceptance",
      message: "S14 senior execution approval cannot satisfy senior review acceptance",
    };
  }
  if (input.reviewBundleId !== bundle.reviewBundleId) {
    return { ok: false, reason: "acceptance_wrong_bundle", message: "decision bound to wrong bundle" };
  }
  if (input.reuseDecisionId) {
    const consumed = options.consumedDecisionIds ?? new Set<string>();
    if (consumed.has(input.reuseDecisionId)) {
      return { ok: false, reason: "acceptance_reuse_rejected", message: "acceptance decision already consumed" };
    }
  }
  if (input.reviewedDefaultSha256 !== bundle.defaultReview.contentSha256) {
    return {
      ok: false,
      reason: "acceptance_hash_mismatch",
      message: "default review hash mismatch — decision would be stale",
    };
  }
  if (input.decision === "accept_senior") {
    if (!bundle.seniorReview) {
      return { ok: false, reason: "senior_review_failed", message: "cannot accept missing senior review" };
    }
    if (
      bundle.seniorReview.complete === false ||
      bundle.seniorReview.s15AcceptanceEligible === false ||
      bundle.seniorReview.completionReason === "cancelled" ||
      bundle.seniorReview.completionReason === "failed" ||
      bundle.seniorReview.completionReason === "recovery_required" ||
      bundle.seniorReview.completionReason === "truncated"
    ) {
      return {
        ok: false,
        reason:
          bundle.seniorReview.completionReason === "cancelled"
            ? "senior_output_cancelled_not_acceptable"
            : "senior_output_partial_not_acceptable",
        message: "partial or incomplete senior output is not eligible for acceptance",
      };
    }
    if (!bundle.comparison) {
      return { ok: false, reason: "comparison_pending", message: "comparison required before accept_senior" };
    }
    if (input.reviewedSeniorSha256 !== bundle.seniorReview.contentSha256) {
      return { ok: false, reason: "acceptance_hash_mismatch", message: "senior review hash mismatch" };
    }
    if (input.reviewedComparisonSha256 !== bundle.comparison.comparisonSha256) {
      return { ok: false, reason: "acceptance_hash_mismatch", message: "comparison hash mismatch" };
    }
  }
  if (
    (input.decision === "reject_senior" || input.decision === "keep_default" || input.decision === "request_revision") &&
    bundle.seniorReview &&
    input.reviewedSeniorSha256 &&
    input.reviewedSeniorSha256 !== bundle.seniorReview.contentSha256
  ) {
    return { ok: false, reason: "acceptance_hash_mismatch", message: "senior review hash mismatch" };
  }

  const decision: OperatorDecisionRecord = {
    decisionId: input.reuseDecisionId ?? newId("s15-decision"),
    decision: input.decision,
    operatorId: input.operatorId,
    reason: input.reason,
    decidedAt: utcNow(),
    reviewedDefaultSha256: input.reviewedDefaultSha256,
    reviewedSeniorSha256: input.reviewedSeniorSha256,
    reviewedComparisonSha256: input.reviewedComparisonSha256,
    reviewBundleId: bundle.reviewBundleId,
    intendedDownstreamStep: input.intendedDownstreamStep,
    consumed: false,
  };
  return { ok: true, decision, bundle };
}
