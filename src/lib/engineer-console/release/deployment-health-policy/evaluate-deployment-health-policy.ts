import { getDeploymentEnvironmentById } from "../deployment-gates/deployment-environments";
import {
  getDeploymentExecutionById,
  listDeploymentExecutionsForRun,
} from "../deployment-execution/deployment-execution-manager";
import { listDeploymentHealthChecksForRun } from "../deployment-health-check/deployment-health-check-manager";
import { DEFAULT_DEPLOYMENT_HEALTH_POLICY } from "./default-deployment-health-policy";
import { hashDeploymentHealthPolicyDefinition } from "./hash-deployment-health-policy";
import type { DeploymentHealthPolicyEvaluation } from "./deployment-health-policy-types";

export interface EvaluateDeploymentHealthPolicyInput {
  runId: string;
  deploymentExecutionId?: string;
}

function latestHealthCheckForExecution(
  runId: string,
  deploymentExecutionId: string,
) {
  return (
    listDeploymentHealthChecksForRun(runId).find(
      (c) => c.deploymentExecutionId === deploymentExecutionId,
    ) ?? null
  );
}

export function evaluateDeploymentHealthPolicy(
  input: EvaluateDeploymentHealthPolicyInput,
): DeploymentHealthPolicyEvaluation {
  const policy = DEFAULT_DEPLOYMENT_HEALTH_POLICY;
  const policyHash = hashDeploymentHealthPolicyDefinition(policy);
  const evaluatedAt = new Date().toISOString();

  const base = {
    runId: input.runId,
    policyVersion: policy.version,
    policyHash,
    evaluatedAt,
    deploymentExecutionId: null as string | null,
    healthCheckId: null as string | null,
    environmentName: null as string | null,
    healthProfile: null as string | null,
    healthCheckStatus: null as string | null,
    responseStatus: null as number | null,
    responseTimeMs: null as number | null,
    warnings: [] as string[],
    blockers: [] as string[],
  };

  const succeededExecutions = listDeploymentExecutionsForRun(input.runId).filter(
    (e) => e.status === "succeeded",
  );

  const execution = input.deploymentExecutionId
    ? getDeploymentExecutionById(input.deploymentExecutionId)
    : succeededExecutions[0] ?? null;

  if (!execution || execution.runId !== input.runId) {
    return {
      ...base,
      status: "not_checked",
      recommendedAction:
        "Complete a successful deployment execution before evaluating deployment health policy.",
      warnings: ["No successful deployment execution is available for this run."],
    };
  }

  if (execution.status !== "succeeded") {
    return {
      ...base,
      deploymentExecutionId: execution.id,
      status: "not_checked",
      recommendedAction:
        "Deployment health policy requires a successful deployment execution.",
      warnings: [
        `Deployment execution is not successful (current status: ${execution.status}).`,
      ],
    };
  }

  const environment = execution.environmentId
    ? getDeploymentEnvironmentById(execution.environmentId)
    : null;
  const environmentName = environment?.name ?? null;
  const latestCheck = latestHealthCheckForExecution(input.runId, execution.id);

  const withExecution = {
    ...base,
    deploymentExecutionId: execution.id,
    environmentName,
  };

  if (!latestCheck) {
    const isProduction = environmentName === "production";
    return {
      ...withExecution,
      status: isProduction ? "needs_attention" : "not_checked",
      recommendedAction: isProduction
        ? "Run a post-deploy health check for production or document an approved exception."
        : "Run a post-deploy health check when ready to verify the deployment.",
      warnings: [
        isProduction
          ? "Production deployment has no recorded post-deploy health check."
          : "No post-deploy health check has been run for the latest successful deployment.",
      ],
    };
  }

  const withCheck = {
    ...withExecution,
    healthCheckId: latestCheck.id,
    healthProfile: latestCheck.healthProfile,
    healthCheckStatus: latestCheck.status,
    responseStatus: latestCheck.responseStatus,
    responseTimeMs: latestCheck.responseTimeMs,
  };

  if (latestCheck.status === "healthy") {
    return {
      ...withCheck,
      status: "healthy",
      recommendedAction: "Deployment health policy is satisfied for the latest health check.",
    };
  }

  if (latestCheck.status === "unhealthy") {
    return {
      ...withCheck,
      status: "unhealthy",
      blockers: ["Latest deployment health check reported an unhealthy HTTP response."],
      recommendedAction:
        "Investigate the deployment target and re-run health checks after remediation.",
    };
  }

  if (latestCheck.status === "failed") {
    return {
      ...withCheck,
      status: "needs_attention",
      warnings: ["Latest deployment health check failed (timeout or network error)."],
      recommendedAction:
        "Re-run the health check or verify connectivity to the configured health endpoint.",
    };
  }

  return {
    ...withCheck,
    status: "needs_attention",
    warnings: [`Latest health check is incomplete (status: ${latestCheck.status}).`],
    recommendedAction: "Wait for the health check to complete or run a new health check.",
  };
}
