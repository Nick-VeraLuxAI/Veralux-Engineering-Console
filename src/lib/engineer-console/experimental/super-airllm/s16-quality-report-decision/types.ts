/** S16 gated senior influence on post-patch quality-report decision — types. */

import { S15_RUNTIME_ID } from "../s15-senior-review-workflow/types";
import {
  VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
} from "../../../worker/vera-post-patch-quality-report-types";

export const S16_SCHEMA = "s16_quality_report_decision_context_v1" as const;
export const S16_TARGET_GATE = "post_patch_quality_report_decision" as const;
export const S16_PHASE = "S16" as const;
export const S16_DEFAULT_REVIEW_RUNTIME_ID = "deterministic-quality-report-summary" as const;
export const S16_MAX_NEW_TOKENS = 32 as const;

export type QualityReportRecommendation =
  | "approve"
  | "reject"
  | "needs_revision"
  | "neutral";

export type QualityReportLifecycleDecision =
  | "approve_quality_report"
  | "reject_quality_report";

export type S16ContextState =
  | "default_only"
  | "senior_execution_blocked"
  | "senior_requested"
  | "senior_completed_unaccepted"
  | "senior_accepted_pending_operator"
  | "senior_cancelled"
  | "senior_failed"
  | "operator_approved"
  | "operator_rejected"
  | "stale";

export type QualityReportRef = {
  artifactPath: string;
  artifactSha256: string;
  schemaVersion: string;
  createdAt: string;
  overallStatus?: string;
};

export type DefaultReviewRef = {
  reviewId: string;
  runtimeId: string;
  content: string;
  contentSha256: string;
  recommendation: QualityReportRecommendation;
  createdAt: string;
};

export type SeniorReviewRef = {
  reviewBundleId: string;
  reviewId: string;
  runtimeId: string;
  content: string;
  contentSha256: string;
  comparisonSha256: string;
  executionApprovalReference: string;
  acceptanceDecisionReference: string;
  accepted: boolean;
  stale: boolean;
  recommendation: QualityReportRecommendation;
  createdAt: string;
  promptSha256?: string;
  generatedTokenIds?: number[];
  completionReason?: string;
  s14CorrelationId?: string;
  s13RequestId?: string;
};

export type RecommendationSummary = {
  defaultRecommendation: QualityReportRecommendation;
  seniorRecommendation: QualityReportRecommendation | null;
  recommendationsAgree: boolean | null;
  disagreements: string[];
  unresolvedRisks: string[];
};

export type OperatorDecisionRecord = {
  decisionId: string;
  decision: QualityReportLifecycleDecision;
  operatorId?: string;
  reason?: string;
  decidedAt: string;
  reviewedQualityReportSha256: string;
  reviewedDefaultReviewSha256: string;
  reviewedSeniorReviewSha256?: string;
  reviewedComparisonSha256?: string;
  seniorReviewConsidered: boolean;
  followedSeniorRecommendation: boolean | null;
  confirmationText: string;
  consumed: boolean;
};

export type LifecycleEffect = {
  applied: boolean;
  priorRunStatus?: string;
  resultingRunStatus?: string;
  priorStep?: string;
  resultingStep?: string;
  downstreamEligible: boolean;
  qualityReportDecision: "pending" | "approved" | "rejected";
  appliedBySenior: false;
};

export type QualityReportDecisionContext = {
  schema: typeof S16_SCHEMA;
  decisionContextId: string;
  targetGate: typeof S16_TARGET_GATE;
  runId: string;
  taskId?: string;
  workOrderId?: string;
  state: S16ContextState;
  qualityReport: QualityReportRef;
  defaultReview: DefaultReviewRef;
  seniorReview?: SeniorReviewRef;
  recommendationSummary: RecommendationSummary;
  operatorDecision?: OperatorDecisionRecord;
  lifecycleEffect: LifecycleEffect;
  s15ReviewBundleId?: string;
  createdAt: string;
  updatedAt: string;
  revisionGeneration: number;
};

export type CreateContextInput = {
  runId: string;
  taskId?: string;
  workOrderId?: string;
  qualityReport: QualityReportRef;
  defaultReviewContent?: string;
  defaultRecommendation?: QualityReportRecommendation;
};

export type AttachAcceptedSeniorInput = {
  decisionContextId: string;
  reviewBundleId: string;
  reviewId: string;
  content: string;
  contentSha256: string;
  comparisonSha256: string;
  executionApprovalReference: string;
  acceptanceDecisionReference: string;
  recommendation?: QualityReportRecommendation;
  promptSha256?: string;
  generatedTokenIds?: number[];
  completionReason?: string;
  s14CorrelationId?: string;
  s13RequestId?: string;
  runtimeId?: string;
};

export type ApplyOperatorDecisionInput = {
  decisionContextId: string;
  decision: QualityReportLifecycleDecision;
  operatorId?: string;
  reason?: string;
  confirmationText: string;
  reviewedQualityReportSha256: string;
  reviewedDefaultReviewSha256: string;
  reviewedSeniorReviewSha256?: string;
  reviewedComparisonSha256?: string;
  seniorReviewConsidered?: boolean;
  /** Injected lifecycle applicator — defaults to existing reviewVeraPostPatchQualityReport. */
  applyLifecycle?: (input: {
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
  };
};

export const S16_ARCHITECTURE = {
  phase: S16_PHASE,
  targetGate: S16_TARGET_GATE,
  schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
  usesS15NotS14OrS13Direct: true,
  allocatesCuda: false,
  stopsNano: false,
  importsModelLoading: false,
  automaticSeniorSelection: false,
  defaultSeniorRoute: false,
  nativeFp8KernelProven: false,
  maxNewTokens: S16_MAX_NEW_TOKENS,
  generationStrategy: "full_prefix_recomputation",
  seniorMayChangeRunState: false,
  seniorMayAuthorizeDownstreamActions: false,
  gates: [
    "senior_execution_approval",
    "senior_review_acceptance",
    "quality_report_operator_decision",
  ] as const,
  seniorRuntimeId: S15_RUNTIME_ID,
} as const;
