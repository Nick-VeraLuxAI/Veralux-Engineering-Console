export const ENGINEERING_DEPLOYMENT_PACKET_SCHEMA = "engineering-deployment-packet/v1" as const;

export type GovernedDeploymentTargetEnvironment = "staging";

export const GOVERNED_DEPLOYMENT_PACKET_ENVIRONMENTS: readonly GovernedDeploymentTargetEnvironment[] =
  ["staging"] as const;

export const DEFAULT_GOVERNED_DEPLOYMENT_TARGET_ENVIRONMENT: GovernedDeploymentTargetEnvironment =
  "staging";
