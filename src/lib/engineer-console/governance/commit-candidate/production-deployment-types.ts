export const ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA =
  "engineering-production-deployment-result/v1" as const;

export type GovernedProductionDeploymentAdapter = "local-production-script";

export const GOVERNED_PRODUCTION_DEPLOYMENT_ADAPTERS: readonly GovernedProductionDeploymentAdapter[] =
  ["local-production-script"] as const;

export const DEFAULT_GOVERNED_PRODUCTION_DEPLOYMENT_ADAPTER: GovernedProductionDeploymentAdapter =
  "local-production-script";

export const LOCAL_SCRIPT_PRODUCTION_DEPLOY_RELATIVE_PATH =
  "scripts/deploy-production.sh" as const;

export const PRODUCTION_DEPLOYMENT_TIMEOUT_MS = 300_000;
