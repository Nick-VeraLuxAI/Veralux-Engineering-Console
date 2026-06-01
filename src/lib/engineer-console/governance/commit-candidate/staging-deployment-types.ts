export const ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA =
  "engineering-staging-deployment-result/v1" as const;

export type GovernedStagingDeploymentAdapter = "local-script";

export const GOVERNED_STAGING_DEPLOYMENT_ADAPTERS: readonly GovernedStagingDeploymentAdapter[] =
  ["local-script"] as const;

export const DEFAULT_GOVERNED_STAGING_DEPLOYMENT_ADAPTER: GovernedStagingDeploymentAdapter =
  "local-script";

export const LOCAL_SCRIPT_STAGING_DEPLOY_RELATIVE_PATH = "scripts/deploy-staging.sh" as const;

export const STAGING_DEPLOYMENT_TIMEOUT_MS = 300_000;
