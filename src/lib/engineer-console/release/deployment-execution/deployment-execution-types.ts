export const DEPLOYMENT_EXECUTION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type DeploymentExecutionStatus = (typeof DEPLOYMENT_EXECUTION_STATUSES)[number];

export const DEPLOYMENT_PROFILE_STRATEGIES = ["fixed_command", "github_actions_future"] as const;

export type DeploymentProfileStrategy = (typeof DEPLOYMENT_PROFILE_STRATEGIES)[number];

export interface DeploymentProfileConfig {
  name: string;
  environmentName: string;
  strategy: DeploymentProfileStrategy;
  workingDirectory: string;
  command: string;
  args: string[];
  allowed: boolean;
  timeoutMs?: number;
}

export interface DeploymentProfilePublicMetadata {
  name: string;
  environmentName: string;
  strategy: DeploymentProfileStrategy;
  enabled: boolean;
}

export interface DeploymentExecutionReadinessResult {
  status: "ready" | "blocked";
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  profile: DeploymentProfilePublicMetadata | null;
}

export interface DeploymentExecutionRecord {
  id: string;
  runId: string;
  deploymentApprovalId: string;
  readinessCheckId: string | null;
  environmentId: string | null;
  mergeRequestId: string | null;
  deploymentProfile: string;
  status: DeploymentExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  actorType: string;
  actorLabel: string | null;
  commandLabel: string | null;
  exitCode: number | null;
  outputSummary: string | null;
  outputHash: string | null;
  errorMessage: string | null;
  evidenceBundleId: string | null;
  evidenceBundleHash: string | null;
  auditEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentExecutionInput {
  runId: string;
  deploymentApprovalId: string;
  deploymentProfile: string;
  actorType: string;
  actorLabel: string;
  rationale?: string | null;
}

export interface ControlledDeploymentExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class DeploymentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentExecutionError";
  }
}
