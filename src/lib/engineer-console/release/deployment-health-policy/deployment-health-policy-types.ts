export const DEPLOYMENT_HEALTH_POLICY_STATUSES = [
  "healthy",
  "unhealthy",
  "needs_attention",
  "not_checked",
] as const;

export type DeploymentHealthPolicyStatus =
  (typeof DEPLOYMENT_HEALTH_POLICY_STATUSES)[number];

export interface DeploymentHealthPolicyRule {
  id: string;
  description: string;
}

export interface DeploymentHealthPolicyDefinition {
  id: string;
  name: string;
  version: string;
  rules: DeploymentHealthPolicyRule[];
}

export interface DeploymentHealthPolicyEvaluation {
  runId: string;
  status: DeploymentHealthPolicyStatus;
  policyVersion: string;
  policyHash: string;
  evaluatedAt: string;
  deploymentExecutionId: string | null;
  healthCheckId: string | null;
  environmentName: string | null;
  healthProfile: string | null;
  healthCheckStatus: string | null;
  responseStatus: number | null;
  responseTimeMs: number | null;
  warnings: string[];
  blockers: string[];
  recommendedAction: string;
}

export interface DeploymentHealthPolicyResultRecord {
  id: string;
  runId: string;
  deploymentExecutionId: string | null;
  healthCheckId: string | null;
  environmentId: string | null;
  status: DeploymentHealthPolicyStatus;
  policyVersion: string;
  policyHash: string;
  resultJson: string;
  actorType: string;
  actorLabel: string | null;
  createdAt: string;
}

export class DeploymentHealthPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentHealthPolicyError";
  }
}
