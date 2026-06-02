export const ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA =
  "engineering-production-deployment-packet/v1" as const;

export type GovernedProductionDeploymentTargetEnvironment = "production";

export const GOVERNED_PRODUCTION_DEPLOYMENT_PACKET_ENVIRONMENTS: readonly GovernedProductionDeploymentTargetEnvironment[] =
  ["production"] as const;

export const DEFAULT_GOVERNED_PRODUCTION_DEPLOYMENT_TARGET_ENVIRONMENT: GovernedProductionDeploymentTargetEnvironment =
  "production";
