export const EVIDENCE_BUNDLE_VERSION = "engineer_run_evidence_bundle_v1" as const;
export const EVIDENCE_REDACTION_VERSION = "engineer-evidence-v1" as const;

export interface EvidenceQualityGateSummary {
  command: string;
  status: string;
  exitCode: number;
  durationMs: number;
  outputHash: string;
  outputPreview: string;
}

export interface EvidenceGovernanceSummary {
  riskLevel: string;
  canApprove: boolean;
  issueCount: number;
  blockedFileCount: number;
  issuesPreview: string[];
}

export interface EvidenceWorkerPlanSummary {
  workerPlanId: string;
  summary: string;
  validationStatus: string;
  executionStatus: string;
  operationCount: number;
  executedCount: number;
  errorCount: number;
}

export interface EvidenceModelDraftSummary {
  draftId: string;
  provider: string;
  model: string;
  validationStatus: string;
  promptHash: string;
  rawResponseHash: string;
}

export interface EvidenceApprovalSummary {
  canApprove: boolean;
  recommendedNextAction: string;
  riskLevel: string;
}

export interface EvidencePolicySummary {
  status: string;
  policyVersion: string;
  policyHashPrefix: string;
  blockerCount: number;
  warningCount: number;
  reviewRequiredCount: number;
  recommendedNextAction: string;
}

export interface EvidenceReviewStagesSummary {
  requiredCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  skippedCount: number;
}

export interface EvidencePrRequestsSummary {
  attemptCount: number;
  latestStatus: string | null;
  latestPrUrl: string | null;
}

export interface EvidenceMergeRequestsSummary {
  attemptCount: number;
  latestStatus: string | null;
  latestMergeShaPrefix: string | null;
}

export interface EvidenceCompatibilitySummary {
  breakingCount: number;
  warningCount: number;
  unknownCount: number;
  linkCount: number;
  latestRunAt: string | null;
}

export interface EvidenceAuditReference {
  eventCount: number;
  chainHashPrefixes: string[];
  latestEventType: string | null;
}

export interface RunEvidenceBundleV1 {
  bundleVersion: typeof EVIDENCE_BUNDLE_VERSION;
  runId: string;
  taskId: string;
  taskTitle: string;
  taskDescriptionPreview: string;
  registeredRepoId: string | null;
  repoName: string | null;
  repoPathRef: string;
  branchName: string | null;
  runStatus: string;
  runStep: string | null;
  modelDraft: EvidenceModelDraftSummary | null;
  workerPlan: EvidenceWorkerPlanSummary | null;
  changedFiles: string[];
  changedFileCount: number;
  diffStats: {
    lineCount: number;
    preview: string;
    contentHash: string;
  };
  qualityGates: EvidenceQualityGateSummary[];
  governance: EvidenceGovernanceSummary | null;
  approval: EvidenceApprovalSummary | null;
  policy: EvidencePolicySummary | null;
  reviewStages: EvidenceReviewStagesSummary | null;
  prRequests: EvidencePrRequestsSummary | null;
  mergeRequests: EvidenceMergeRequestsSummary | null;
  compatibility: EvidenceCompatibilitySummary | null;
  audit: EvidenceAuditReference;
  timestamps: {
    runStartedAt: string | null;
    runCompletedAt: string | null;
    bundleBuiltAt: string;
  };
}

export interface EvidenceBundleRecord {
  id: string;
  runId: string;
  taskId: string | null;
  registeredRepoId: string | null;
  bundleHash: string;
  bundleJson: string;
  redactionVersion: string;
  createdAt: string;
  updatedAt: string;
}

export class EvidenceBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceBundleError";
  }
}
