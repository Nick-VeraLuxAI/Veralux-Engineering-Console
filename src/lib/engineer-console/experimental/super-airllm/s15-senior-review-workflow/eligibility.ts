/** Downstream eligibility — marks review eligible; never authorizes actions. */

import type { DownstreamActionAttempt, EffectiveReviewRecord, SeniorReviewBundle } from "./types";

export function computeEffectiveReview(bundle: SeniorReviewBundle): EffectiveReviewRecord {
  if (
    bundle.state === "senior_accepted" &&
    bundle.operatorDecision?.decision === "accept_senior" &&
    bundle.seniorReview &&
    bundle.operatorDecision.reviewedSeniorSha256 === bundle.seniorReview.contentSha256 &&
    bundle.operatorDecision.reviewedDefaultSha256 === bundle.defaultReview.contentSha256 &&
    (!bundle.comparison ||
      bundle.operatorDecision.reviewedComparisonSha256 === bundle.comparison.comparisonSha256)
  ) {
    return {
      source: "senior",
      reviewId: bundle.seniorReview.reviewId,
      contentSha256: bundle.seniorReview.contentSha256,
      eligibleForDownstreamUse: true,
      downstreamActionAuthorized: false,
    };
  }
  return {
    source: "default",
    reviewId: bundle.defaultReview.reviewId,
    contentSha256: bundle.defaultReview.contentSha256,
    eligibleForDownstreamUse: true,
    downstreamActionAuthorized: false,
  };
}

export type DownstreamGateResult =
  | { allowed: false; reason: "unaccepted_senior_cannot_trigger_actions" | "downstream_action_rejected"; message: string }
  | { allowed: false; reason: "accepted_senior_still_requires_action_gates"; message: string; eligible: true };

/**
 * S15 never executes patches/commits/PRs/deploys.
 * Even an accepted senior review is only marked eligible and still requires all existing action gates.
 */
export function assertDownstreamActionBlocked(
  bundle: SeniorReviewBundle,
  action: DownstreamActionAttempt,
): DownstreamGateResult {
  const effective = computeEffectiveReview(bundle);
  if (effective.source === "senior" && !bundle.operatorDecision) {
    return {
      allowed: false,
      reason: "unaccepted_senior_cannot_trigger_actions",
      message: `action ${action} rejected: senior not accepted`,
    };
  }
  if (effective.source !== "senior" && action !== "apply_patch") {
    // Any attempt to act on senior without acceptance
  }
  if (
    effective.source !== "senior" &&
    ["apply_patch", "git_commit", "create_pr", "merge", "deploy"].includes(action) &&
    bundle.seniorReview &&
    bundle.state !== "senior_accepted"
  ) {
    return {
      allowed: false,
      reason: "unaccepted_senior_cannot_trigger_actions",
      message: `action ${action} rejected: senior review is not the effective accepted review`,
    };
  }
  // Even when senior is accepted/eligible, S15 itself never authorizes the action.
  return {
    allowed: false,
    reason: "accepted_senior_still_requires_action_gates",
    message: `action ${action} not authorized by S15; existing downstream gates remain mandatory`,
    eligible: effective.eligibleForDownstreamUse && effective.source === "senior",
  };
}

/** Senior model cannot approve itself. */
export function assertSeniorCannotSelfApprove(input: {
  decisionOperatorId?: string;
  seniorRuntimeId: string;
}): void {
  if (input.decisionOperatorId && input.decisionOperatorId === input.seniorRuntimeId) {
    throw new Error("senior_cannot_approve_itself");
  }
}
