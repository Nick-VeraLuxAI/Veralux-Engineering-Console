export const PR_REQUEST_STATUSES = [
  "draft",
  "ready",
  "committing",
  "committed",
  "pushing",
  "pr_created",
  "failed",
  "cancelled",
] as const;

export type PrRequestStatus = (typeof PR_REQUEST_STATUSES)[number];

export const PR_READINESS_STATUSES = ["passed", "blocked", "requires_review"] as const;

export type PrReadinessStatus = (typeof PR_READINESS_STATUSES)[number];

export interface PrReadinessResult {
  status: PrReadinessStatus;
  blockers: string[];
  warnings: string[];
  requiredEvidence: string[];
  recommendedAction: string;
  signals: PrReadinessSignals;
}

export interface PrReadinessSignals {
  runId: string;
  runStatus: string;
  hasApprovedDecision: boolean;
  hasEvidenceBundle: boolean;
  policyStatus: string | null;
  replayStatus: string | null;
  reviewStagesApproved: number;
  reviewStagesPending: number;
  reviewStagesRejected: number;
  changedFileCount: number;
  branchName: string | null;
  governanceRiskLevel: string | null;
  qualityGatesFailed: number;
}

export interface PrRequestRecord {
  id: string;
  runId: string;
  taskId: string | null;
  registeredRepoId: string | null;
  branchName: string;
  baseBranch: string;
  commitSha: string | null;
  commitMessage: string | null;
  prUrl: string | null;
  prNumber: string | null;
  status: PrRequestStatus;
  readinessStatus: PrReadinessStatus;
  readinessJson: string;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  policyResultId: string | null;
  replayVerificationId: string | null;
  actorType: string;
  actorLabel: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CreatePrRequestInput {
  runId: string;
  actorType: string;
  actorLabel: string;
  baseBranch?: string;
  draft?: boolean;
  rationale?: string | null;
}

export class PrCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrCreationError";
  }
}
