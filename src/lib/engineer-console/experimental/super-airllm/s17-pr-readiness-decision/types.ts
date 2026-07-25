/** S17 gated senior influence on PR-readiness (Phase 2X) decision — types. */

import { S15_RUNTIME_ID } from "../s15-senior-review-workflow/types";
import {
  VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
} from "../../../worker/vera-pull-request-preparation-types";

export const S17_SCHEMA = "s17_pr_readiness_decision_context_v1" as const;
export const S17_TARGET_GATE = "pull_request_readiness_decision" as const;
export const S17_PHASE = "S17" as const;
export const S17_DEFAULT_REVIEW_RUNTIME_ID = "deterministic-pr-readiness-summary" as const;
export const S17_MAX_NEW_TOKENS = 32 as const;

export type PrReadinessRecommendation = "ready" | "not_ready" | "needs_revision" | "neutral";

export type PrReadinessLifecycleDecision =
  | "mark_pr_ready"
  | "mark_pr_not_ready"
  | "request_pr_readiness_revision";

export type S17ContextState =
  | "default_only"
  | "senior_execution_blocked"
  | "senior_requested"
  | "senior_completed_unaccepted"
  | "senior_accepted_pending_operator"
  | "senior_cancelled"
  | "senior_failed"
  | "operator_ready"
  | "operator_not_ready"
  | "operator_revision_requested"
  | "stale";

export type PrPreparationRef = {
  artifactPath: string;
  artifactSha256: string;
  schemaVersion: string;
  createdAt: string;
  targetRepoPath?: string;
  branchName?: string;
  commitSha?: string;
  qualityReportSha256?: string;
};

export type DefaultReviewRef = {
  reviewId: string;
  runtimeId: string;
  content: string;
  contentSha256: string;
  recommendation: PrReadinessRecommendation;
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
  recommendation: PrReadinessRecommendation;
  createdAt: string;
  promptSha256?: string;
  generatedTokenIds?: number[];
  completionReason?: string;
  s14CorrelationId?: string;
  s13RequestId?: string;
};

export type RecommendationSummary = {
  defaultRecommendation: PrReadinessRecommendation;
  seniorRecommendation: PrReadinessRecommendation | null;
  recommendationsAgree: boolean | null;
  disagreements: string[];
  unresolvedRisks: string[];
};

export type OperatorDecisionRecord = {
  decisionId: string;
  decision: PrReadinessLifecycleDecision;
  operatorId?: string;
  reason?: string;
  decidedAt: string;
  reviewedPrPreparationSha256: string;
  reviewedDefaultReviewSha256: string;
  reviewedQualityReportSha256?: string;
  reviewedBranchName?: string;
  reviewedCommitSha?: string;
  reviewedSeniorReviewSha256?: string;
  reviewedComparisonSha256?: string;
  seniorReviewConsidered: boolean;
  followedSeniorRecommendation: boolean | null;
  confirmationText?: string;
  consumed: boolean;
};

export type LifecycleEffect = {
  applied: boolean;
  priorRunStatus?: string;
  resultingRunStatus?: string;
  priorStep?: string;
  resultingStep?: string;
  prReadinessDecision: "pending" | "ready" | "not_ready" | "revision_requested";
  /** PR creation (Phase 2Y) is never authorized by S17. */
  prCreationAuthorized: false;
  appliedBySenior: false;
};

export type PrReadinessDecisionContext = {
  schema: typeof S17_SCHEMA;
  decisionContextId: string;
  targetGate: typeof S17_TARGET_GATE;
  runId: string;
  taskId?: string;
  workOrderId?: string;
  targetRepository?: string;
  branchName?: string;
  targetCommit?: string;
  state: S17ContextState;
  qualityReportSha256?: string;
  prPreparation: PrPreparationRef;
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
  targetRepository?: string;
  branchName?: string;
  targetCommit?: string;
  qualityReportSha256?: string;
  prPreparation: PrPreparationRef;
  defaultReviewContent?: string;
  defaultRecommendation?: PrReadinessRecommendation;
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
  recommendation?: PrReadinessRecommendation;
  promptSha256?: string;
  generatedTokenIds?: number[];
  completionReason?: string;
  s14CorrelationId?: string;
  s13RequestId?: string;
  runtimeId?: string;
};

export type LifecycleApplyResult = {
  nextStep: string;
  runStatus: string;
  priorStep?: string;
  priorStatus?: string;
};

export type ApplyOperatorDecisionInput = {
  decisionContextId: string;
  decision: PrReadinessLifecycleDecision;
  operatorId?: string;
  reason?: string;
  /** Required when decision is mark_pr_ready and the lifecycle applicator prepares the PR. */
  confirmationText?: string;
  reviewedPrPreparationSha256: string;
  reviewedDefaultReviewSha256: string;
  reviewedQualityReportSha256?: string;
  reviewedBranchName?: string;
  reviewedCommitSha?: string;
  reviewedSeniorReviewSha256?: string;
  reviewedComparisonSha256?: string;
  seniorReviewConsidered?: boolean;
  /** Injected lifecycle applicator — defaults to existing prepareVeraPullRequest. */
  applyLifecycle?: (input: {
    runId: string;
    decision: PrReadinessLifecycleDecision;
    confirmationText: string;
    requestedBy: string;
    note?: string | null;
  }) => LifecycleApplyResult;
};

export const S17_ARCHITECTURE = {
  phase: S17_PHASE,
  targetGate: S17_TARGET_GATE,
  schemaVersion: VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
  usesS15NotS14OrS13Direct: true,
  allocatesCuda: false,
  stopsNano: false,
  importsModelLoading: false,
  automaticSeniorSelection: false,
  defaultSeniorRoute: false,
  nativeFp8KernelProven: false,
  maxNewTokens: S17_MAX_NEW_TOKENS,
  generationStrategy: "full_prefix_recomputation",
  seniorMayChangeRunState: false,
  seniorMayAuthorizeDownstreamActions: false,
  seniorMayCreatePullRequest: false,
  prCreationRemainsSeparatelyGated: true,
  gates: [
    "senior_execution_approval",
    "senior_review_acceptance",
    "pr_readiness_operator_decision",
    "pr_creation_approval",
  ] as const,
  seniorRuntimeId: S15_RUNTIME_ID,
} as const;
