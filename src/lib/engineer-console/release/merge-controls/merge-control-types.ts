export const MERGE_REQUEST_STATUSES = [
  "draft",
  "ready",
  "merging",
  "merged",
  "failed",
  "cancelled",
] as const;

export type MergeRequestStatus = (typeof MERGE_REQUEST_STATUSES)[number];

export const MERGE_READINESS_STATUSES = ["passed", "blocked", "requires_review"] as const;

export type MergeReadinessStatus = (typeof MERGE_READINESS_STATUSES)[number];

export const MERGE_METHODS = ["squash", "merge"] as const;

export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface MergeReadinessSignals {
  runId: string;
  runStatus: string;
  prRequestId: string | null;
  prRequestStatus: string | null;
  hasApprovedDecision: boolean;
  hasEvidenceBundle: boolean;
  policyStatus: string | null;
  replayStatus: string | null;
  reviewStagesApproved: number;
  reviewStagesPending: number;
  reviewStagesRejected: number;
  qualityGatesFailed: number;
  governanceRiskLevel: string | null;
  prState: string | null;
  prMerged: boolean;
  headBranchMatches: boolean | null;
}

export interface MergeReadinessResult {
  status: MergeReadinessStatus;
  blockers: string[];
  warnings: string[];
  requiredEvidence: string[];
  recommendedAction: string;
  signals: MergeReadinessSignals;
}

export interface MergeRequestRecord {
  id: string;
  runId: string;
  prRequestId: string;
  taskId: string | null;
  registeredRepoId: string | null;
  prUrl: string | null;
  prNumber: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  commitSha: string | null;
  mergeSha: string | null;
  status: MergeRequestStatus;
  readinessStatus: MergeReadinessStatus;
  readinessJson: string;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  policyResultId: string | null;
  replayVerificationId: string | null;
  actorType: string;
  actorLabel: string | null;
  rationale: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CreateMergeRequestInput {
  runId: string;
  prRequestId: string;
  actorType: string;
  actorLabel: string;
  mergeMethod?: MergeMethod;
  rationale?: string | null;
}

export class MergeControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeControlError";
  }
}

export interface GithubPrViewSnapshot {
  state: string;
  merged: boolean;
  url: string;
  headRefName: string;
  baseRefName: string;
  headRefOid: string | null;
  mergeCommitOid: string | null;
}

export interface MergeGithubPrResult {
  mergeSha: string | null;
  prUrl: string;
  prNumber: string | null;
}
