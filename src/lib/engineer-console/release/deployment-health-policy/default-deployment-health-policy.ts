import type { DeploymentHealthPolicyDefinition } from "./deployment-health-policy-types";

export const DEFAULT_DEPLOYMENT_HEALTH_POLICY: DeploymentHealthPolicyDefinition = {
  id: "deployment-health-policy-v1",
  name: "Default Deployment Health Policy",
  version: "1.0.0",
  rules: [
    {
      id: "health-check-healthy",
      description: "Latest health check status is healthy → policy healthy.",
    },
    {
      id: "health-check-unhealthy",
      description: "Latest health check status is unhealthy → policy unhealthy.",
    },
    {
      id: "health-check-failed",
      description: "Latest health check failed (timeout/network) → needs_attention.",
    },
    {
      id: "no-health-check-staging",
      description:
        "Successful deployment with no health check on non-production → not_checked.",
    },
    {
      id: "no-health-check-production",
      description:
        "Successful production deployment with no health check → needs_attention.",
    },
    {
      id: "no-deployment",
      description: "No successful deployment execution → not_checked.",
    },
  ],
};
