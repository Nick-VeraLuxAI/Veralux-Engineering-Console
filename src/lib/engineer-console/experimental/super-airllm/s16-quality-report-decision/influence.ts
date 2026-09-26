/** Senior influence rules and staleness for S16. */

import type {
  QualityReportDecisionContext,
  RecommendationSummary,
  SeniorReviewRef,
} from "./types";
import { extractRecommendation } from "./recommendation";

export function buildRecommendationSummary(
  context: Pick<QualityReportDecisionContext, "defaultReview" | "seniorReview">,
): RecommendationSummary {
  const defaultRecommendation = context.defaultReview.recommendation;
  const senior =
    context.seniorReview && context.seniorReview.accepted && !context.seniorReview.stale
      ? context.seniorReview
      : undefined;
  const seniorRecommendation = senior?.recommendation ?? null;
  const disagreements: string[] = [];
  if (
    seniorRecommendation &&
    seniorRecommendation !== "neutral" &&
    defaultRecommendation !== "neutral" &&
    seniorRecommendation !== defaultRecommendation
  ) {
    disagreements.push(
      `default=${defaultRecommendation}; senior=${seniorRecommendation}`,
    );
  }
  return {
    defaultRecommendation,
    seniorRecommendation,
    recommendationsAgree:
      seniorRecommendation === null
        ? null
        : seniorRecommendation === defaultRecommendation ||
          seniorRecommendation === "neutral" ||
          defaultRecommendation === "neutral",
    disagreements,
    unresolvedRisks: disagreements.length ? ["recommendation_disagreement"] : [],
  };
}

export function canSeniorInfluence(context: QualityReportDecisionContext): boolean {
  return Boolean(
    context.seniorReview?.accepted &&
      !context.seniorReview.stale &&
      context.state === "senior_accepted_pending_operator",
  );
}

export function markSeniorStale(
  context: QualityReportDecisionContext,
  reason: string,
): QualityReportDecisionContext {
  const senior: SeniorReviewRef | undefined = context.seniorReview
    ? { ...context.seniorReview, stale: true }
    : undefined;
  return {
    ...context,
    state: "stale",
    seniorReview: senior,
    recommendationSummary: buildRecommendationSummary({
      defaultReview: context.defaultReview,
      seniorReview: senior,
    }),
    lifecycleEffect: {
      ...context.lifecycleEffect,
      qualityReportDecision: context.operatorDecision
        ? context.lifecycleEffect.qualityReportDecision
        : "pending",
      downstreamEligible: context.lifecycleEffect.applied
        ? context.lifecycleEffect.downstreamEligible
        : false,
    },
    revisionGeneration: context.revisionGeneration + 1,
    updatedAt: new Date().toISOString(),
    // reason retained via events by caller
  };
}

export function detectStaleness(
  context: QualityReportDecisionContext,
  current: {
    qualityReportSha256: string;
    defaultReviewSha256: string;
    seniorReviewSha256?: string;
    comparisonSha256?: string;
  },
): { stale: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (current.qualityReportSha256 !== context.qualityReport.artifactSha256) {
    reasons.push("quality_report_hash_changed");
  }
  if (current.defaultReviewSha256 !== context.defaultReview.contentSha256) {
    reasons.push("default_review_hash_changed");
  }
  if (
    context.seniorReview &&
    current.seniorReviewSha256 &&
    current.seniorReviewSha256 !== context.seniorReview.contentSha256
  ) {
    reasons.push("senior_review_hash_changed");
  }
  if (
    context.seniorReview &&
    current.comparisonSha256 &&
    current.comparisonSha256 !== context.seniorReview.comparisonSha256
  ) {
    reasons.push("comparison_hash_changed");
  }
  return { stale: reasons.length > 0, reasons };
}

export function normalizeSeniorRecommendation(
  content: string,
  explicit?: ReturnType<typeof extractRecommendation>,
): ReturnType<typeof extractRecommendation> {
  return explicit ?? extractRecommendation(content);
}
