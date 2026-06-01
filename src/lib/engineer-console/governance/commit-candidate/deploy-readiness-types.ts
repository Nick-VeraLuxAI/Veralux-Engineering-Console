export const ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA =
  "engineering-deploy-readiness-result/v1" as const;

export type DeployReadinessDecision = "ready" | "not_ready" | "blocked";

export const DEPLOY_READINESS_DECISIONS: readonly DeployReadinessDecision[] = [
  "ready",
  "not_ready",
  "blocked",
] as const;
