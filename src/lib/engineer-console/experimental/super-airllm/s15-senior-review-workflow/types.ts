/** S15 approved senior-review workflow types — advisory until operator acceptance. */

import { S14_EXECUTION_MODE, S14_RUNTIME_ID } from "../s14-senior-adapter/types";

export const S15_SCHEMA = "s15_senior_review_bundle_v1" as const;
export const S15_RUNTIME_ID = S14_RUNTIME_ID;
export const S15_EXECUTION_MODE = S14_EXECUTION_MODE;
export const S15_DEFAULT_WORKER_RUNTIME_ID = "local-nemotron-nano-30b-console" as const;

export type OperatorDecisionKind =
  | "accept_senior"
  | "reject_senior"
  | "keep_default"
  | "request_revision";

export type BundleState =
  | "default_only"
  | "senior_execution_blocked"
  | "senior_requested"
  | "senior_executing"
  | "senior_completed"
  | "senior_cancelled"
  | "senior_failed"
  | "senior_recovery_required"
  | "comparison_ready"
  | "pending_operator_review"
  | "senior_accepted"
  | "senior_rejected"
  | "default_retained"
  | "revision_requested"
  | "stale";

export type DecisionReason =
  | "senior_review_not_requested"
  | "senior_execution_not_approved"
  | "senior_review_pending"
  | "senior_review_failed"
  | "comparison_pending"
  | "operator_decision_missing"
  | "operator_accepted_senior"
  | "operator_rejected_senior"
  | "operator_retained_default"
  | "review_artifact_changed"
  | "senior_review_cancelled"
  | "senior_review_requested_before_default_review"
  | "execution_approval_is_not_acceptance"
  | "acceptance_hash_mismatch"
  | "acceptance_reuse_rejected"
  | "acceptance_wrong_bundle"
  | "downstream_action_rejected"
  | "unaccepted_senior_cannot_trigger_actions"
  | "senior_output_incomplete"
  | "senior_output_partial_not_acceptable"
  | "senior_output_cancelled_not_acceptable";

export type SeniorCompletionReason =
  | "max_new_tokens"
  | "eos"
  | "stop_token"
  | "cancelled"
  | "failed"
  | "recovery_required"
  | "truncated"
  | "fixture";

export type DefaultReviewRecord = {
  reviewId: string;
  runtimeId: string;
  content: string;
  contentSha256: string;
  createdAt: string;
};

export type SeniorReviewRequestRecord = {
  requestId: string;
  runtimeId: string;
  approvalReference: string;
  s14CorrelationId: string;
  s13RequestId?: string;
  state: string;
  requestedAt: string;
  idempotencyKey: string;
};

export type SeniorReviewRecord = {
  reviewId: string;
  runtimeId: string;
  executionMode: typeof S15_EXECUTION_MODE;
  content: string;
  contentSha256: string;
  generatedTokenIds?: number[];
  createdAt: string;
  /** True only for fixture/synthetic bounded outputs — not long-form generation proof. */
  syntheticOrFixture?: boolean;
  completionReason?: SeniorCompletionReason;
  tokensCompleted?: number;
  requestedMaxNewTokens?: number;
  /** False for partial/cancelled/failed; required true for accept_senior. */
  complete?: boolean;
  s15AcceptanceEligible?: boolean;
};

export type ComparisonRecord = {
  comparisonId: string;
  agreements: string[];
  disagreements: string[];
  seniorOnlyFindings: string[];
  defaultOnlyFindings: string[];
  severityDifferences: string[];
  recommendationDifferences: string[];
  confidenceNotes: string[];
  proposedActions: string[];
  comparisonSha256: string;
  createdAt: string;
  /** Comparison never auto-selects a winner. */
  autoSelectedWinner: false;
  comparisonRuntime: "rule_based_s15_v1";
};

export type OperatorDecisionRecord = {
  decisionId: string;
  decision: OperatorDecisionKind;
  operatorId?: string;
  reason?: string;
  decidedAt: string;
  reviewedDefaultSha256: string;
  reviewedSeniorSha256?: string;
  reviewedComparisonSha256?: string;
  reviewBundleId: string;
  intendedDownstreamStep?: string;
  consumed: boolean;
};

export type EffectiveReviewRecord = {
  source: "default" | "senior";
  reviewId: string;
  contentSha256: string;
  eligibleForDownstreamUse: boolean;
  /** Never authorizes patches/commits/PRs/deploys by itself. */
  downstreamActionAuthorized: false;
};

export type SeniorReviewBundle = {
  schema: typeof S15_SCHEMA;
  reviewBundleId: string;
  runId: string;
  taskId?: string;
  workOrderId?: string;
  state: BundleState;
  defaultReview: DefaultReviewRecord;
  seniorReviewRequest?: SeniorReviewRequestRecord;
  seniorReview?: SeniorReviewRecord;
  comparison?: ComparisonRecord;
  operatorDecision?: OperatorDecisionRecord;
  effectiveReview: EffectiveReviewRecord;
  decisionReason: DecisionReason;
  createdAt: string;
  updatedAt: string;
  revisionGeneration: number;
};

export type DownstreamActionAttempt =
  | "apply_patch"
  | "git_commit"
  | "create_pr"
  | "merge"
  | "deploy"
  | "send_external_message"
  | "modify_production"
  | "irreversible_action";

export type CreateBundleInput = {
  runId: string;
  taskId?: string;
  workOrderId?: string;
  defaultContent: string;
  defaultRuntimeId?: string;
  defaultReviewId?: string;
  createdAt?: string;
};

export type RequestSeniorInput = {
  reviewBundleId: string;
  approvalReference: string;
  /** Must be a validated S14 execution approval reference — never acceptance. */
  executionApprovalPresent: boolean;
  prompt?: string;
  idempotencyKey?: string;
  requestId?: string;
  maxNewTokens?: number;
};

export type RecordSeniorResultInput = {
  reviewBundleId: string;
  content: string;
  s13RequestId?: string;
  generatedTokenIds?: number[];
  syntheticOrFixture?: boolean;
  createdAt?: string;
  completionReason?: SeniorCompletionReason;
  tokensCompleted?: number;
  requestedMaxNewTokens?: number;
  complete?: boolean;
  s15AcceptanceEligible?: boolean;
  partial?: boolean;
};

export type OperatorDecisionInput = {
  reviewBundleId: string;
  decision: OperatorDecisionKind;
  operatorId?: string;
  reason?: string;
  /** Required hashes — must match current immutable artifacts. */
  reviewedDefaultSha256: string;
  reviewedSeniorSha256?: string;
  reviewedComparisonSha256?: string;
  intendedDownstreamStep?: string;
  /** Forbidden: attempting to pass S14 execution approval as acceptance. */
  executionApprovalAsAcceptance?: boolean;
  reuseDecisionId?: string;
};
