export const REPLAY_CHECK_STATUSES = ["passed", "warning", "failed"] as const;
export type ReplayCheckStatus = (typeof REPLAY_CHECK_STATUSES)[number];

export const REPLAY_VERIFICATION_STATUSES = ["passed", "warning", "failed"] as const;
export type ReplayVerificationStatus = (typeof REPLAY_VERIFICATION_STATUSES)[number];

export interface ReplayCheck {
  code: string;
  status: ReplayCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface ReplayVerificationSummary {
  passed: number;
  warnings: number;
  failed: number;
}

export interface ReplayVerificationResult {
  ok: boolean;
  runId: string;
  checkedAt: string;
  status: ReplayVerificationStatus;
  checks: ReplayCheck[];
  summary: ReplayVerificationSummary;
}

export interface ReplayVerificationRecord {
  id: string;
  runId: string;
  status: ReplayVerificationStatus;
  resultJson: string;
  createdAt: string;
}

export interface RedactedReplayPackage {
  packageVersion: "engineer_replay_package_v1";
  runId: string;
  builtAt: string;
  runSummary: {
    status: string;
    currentStep: string | null;
    branchName: string | null;
    riskLevel: string | null;
  };
  taskSummary: {
    id: string;
    title: string;
  };
  repoRef: {
    registeredRepoId: string | null;
    repoName: string | null;
    repoPathRef: string | null;
  };
  evidenceBundle: {
    id: string | null;
    bundleHashPrefix: string | null;
    redactionVersion: string | null;
    updatedAt: string | null;
  };
  auditEventHashes: string[];
  decisionRecords: Array<{
    id: string;
    decision: string;
    evidenceBundleHashPrefix: string | null;
    auditChainHashPrefix: string | null;
    createdAt: string;
  }>;
  qualityGateSummaries: Array<{ command: string; status: string; exitCode: number }>;
  governanceSummary: {
    riskLevel: string | null;
    canApprove: boolean | null;
  } | null;
  verification: ReplayVerificationResult;
}

export class ReplayVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayVerificationError";
  }
}
