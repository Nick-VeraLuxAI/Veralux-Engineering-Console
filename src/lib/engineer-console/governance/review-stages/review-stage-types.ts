export const REVIEW_STAGE_TYPES = [
  "architecture_review",
  "implementation_review",
  "risky_diff_review",
  "release_readiness_review",
] as const;

export type ReviewStageType = (typeof REVIEW_STAGE_TYPES)[number];

export const REVIEW_STAGE_STATUSES = ["pending", "approved", "rejected", "skipped"] as const;

export type ReviewStageStatus = (typeof REVIEW_STAGE_STATUSES)[number];

export type ReviewStageAction = "approve" | "reject" | "skip";

export interface RequiredReviewStageSpec {
  stage: ReviewStageType;
  required: boolean;
  reason: string;
}

export interface ReviewStageRecord {
  id: string;
  runId: string;
  taskId: string | null;
  stage: ReviewStageType;
  status: ReviewStageStatus;
  required: boolean;
  reason: string | null;
  reviewerActorType: string | null;
  reviewerActorLabel: string | null;
  reviewerNotes: string | null;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  policyResultId: string | null;
  auditEventId: string | null;
  auditChainHash: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ReviewStageGateResult {
  ok: boolean;
  pendingRequired: ReviewStageRecord[];
  rejectedRequired: ReviewStageRecord[];
  message: string | null;
}

export interface ReviewStageSummary {
  requiredCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  skippedCount: number;
}

export class ReviewStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewStageError";
  }
}
