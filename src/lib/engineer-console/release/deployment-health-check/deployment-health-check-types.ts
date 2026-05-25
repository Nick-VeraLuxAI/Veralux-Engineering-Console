export const DEPLOYMENT_HEALTH_CHECK_STATUSES = [
  "pending",
  "running",
  "healthy",
  "unhealthy",
  "failed",
] as const;

export type DeploymentHealthCheckStatus =
  (typeof DEPLOYMENT_HEALTH_CHECK_STATUSES)[number];

export const HEALTH_CHECK_PROFILE_TYPES = ["http"] as const;

export type HealthCheckProfileType = (typeof HEALTH_CHECK_PROFILE_TYPES)[number];

export interface HealthCheckProfileConfig {
  name: string;
  environmentName: string;
  type: HealthCheckProfileType;
  url: string;
  expectedStatus: number;
  allowed: boolean;
  timeoutMs?: number;
}

export interface HealthCheckProfilePublicMetadata {
  name: string;
  environmentName: string;
  type: HealthCheckProfileType;
  enabled: boolean;
  hostname: string | null;
}

export interface DeploymentHealthCheckReadinessResult {
  status: "ready" | "blocked";
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  profile: HealthCheckProfilePublicMetadata | null;
}

export interface DeploymentHealthCheckRecord {
  id: string;
  runId: string;
  deploymentExecutionId: string;
  environmentId: string | null;
  healthProfile: string;
  status: DeploymentHealthCheckStatus;
  checkedUrl: string | null;
  responseStatus: number | null;
  responseTimeMs: number | null;
  outputSummary: string | null;
  outputHash: string | null;
  errorMessage: string | null;
  actorType: string;
  actorLabel: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateDeploymentHealthCheckInput {
  runId: string;
  deploymentExecutionId: string;
  healthProfile: string;
  actorType: string;
  actorLabel: string;
}

export interface HttpHealthCheckExecResult {
  responseStatus: number | null;
  responseTimeMs: number;
  bodySnippet: string;
  errorMessage: string | null;
  timedOut: boolean;
}

export class DeploymentHealthCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentHealthCheckError";
  }
}
