export const DEPLOYMENT_READINESS_STATUSES = ["passed", "blocked", "requires_review"] as const;

export type DeploymentReadinessStatus = (typeof DEPLOYMENT_READINESS_STATUSES)[number];

export const DEPLOYMENT_APPROVAL_DECISIONS = ["approved", "rejected"] as const;

export type DeploymentApprovalDecision = (typeof DEPLOYMENT_APPROVAL_DECISIONS)[number];

export const DEPLOYMENT_ENVIRONMENT_TYPES = ["local", "staging", "production"] as const;

export type DeploymentEnvironmentType = (typeof DEPLOYMENT_ENVIRONMENT_TYPES)[number];

export const DEPLOYMENT_STRATEGIES = [
  "manual",
  "github_actions_future",
  "script_future",
] as const;

export type DeploymentStrategy = (typeof DEPLOYMENT_STRATEGIES)[number];

export interface DeploymentEnvironmentRecord {
  id: string;
  name: string;
  environmentType: DeploymentEnvironmentType;
  description: string | null;
  requiredBranch: string | null;
  deploymentStrategy: DeploymentStrategy;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentReadinessSignals {
  runId: string;
  runStatus: string;
  environmentId: string;
  environmentName: string;
  environmentType: DeploymentEnvironmentType;
  deploymentStrategy: DeploymentStrategy;
  hasApprovedDecision: boolean;
  hasPrCreated: boolean;
  mergeRequestId: string | null;
  mergeRequestStatus: string | null;
  mergeSha: string | null;
  hasEvidenceBundle: boolean;
  policyStatus: string | null;
  replayStatus: string | null;
  reviewStagesApproved: number;
  reviewStagesPending: number;
  reviewStagesRejected: number;
  qualityGatesFailed: number;
  governanceRiskLevel: string | null;
}

export interface DeploymentReadinessResult {
  status: DeploymentReadinessStatus;
  blockers: string[];
  warnings: string[];
  requiredEvidence: string[];
  recommendedAction: string;
  environment: {
    id: string;
    name: string;
    environmentType: DeploymentEnvironmentType;
    deploymentStrategy: DeploymentStrategy;
  };
  signals: DeploymentReadinessSignals;
}

export interface DeploymentReadinessCheckRecord {
  id: string;
  runId: string;
  mergeRequestId: string | null;
  environmentId: string;
  status: DeploymentReadinessStatus;
  readinessJson: string;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  policyResultId: string | null;
  replayVerificationId: string | null;
  mergeSha: string | null;
  actorType: string;
  actorLabel: string | null;
  createdAt: string;
}

export interface DeploymentApprovalRecord {
  id: string;
  runId: string;
  readinessCheckId: string;
  environmentId: string;
  decision: DeploymentApprovalDecision;
  actorType: string;
  actorLabel: string | null;
  rationale: string | null;
  createdAt: string;
}

export interface CreateDeploymentReadinessCheckInput {
  runId: string;
  environmentId: string;
  actorType: string;
  actorLabel: string;
}

export interface CreateDeploymentApprovalInput {
  runId: string;
  readinessCheckId: string;
  decision: DeploymentApprovalDecision;
  actorType: string;
  actorLabel: string;
  rationale?: string | null;
}

export class DeploymentGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentGateError";
  }
}
