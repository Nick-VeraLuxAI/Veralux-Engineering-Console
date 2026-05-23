import { getRunById } from "../../run-manager/run-manager";
import { getDeploymentEnvironmentById } from "../deployment-gates/deployment-environments";
import {
  getDeploymentExecutionById,
} from "../deployment-execution/deployment-execution-manager";
import {
  getHealthCheckProfileByName,
  listHealthCheckProfiles,
  listPublicHealthCheckProfiles,
} from "./health-profile-config";
import type { DeploymentHealthCheckReadinessResult } from "./deployment-health-check-types";

export function evaluateDeploymentHealthCheckReadiness(
  runId: string,
  deploymentExecutionId: string,
  healthProfileName: string,
): DeploymentHealthCheckReadinessResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const run = getRunById(runId);
  if (!run) {
    return {
      status: "blocked",
      blockers: ["Run not found."],
      warnings: [],
      recommendedAction: "Verify run id.",
      profile: null,
    };
  }

  const execution = getDeploymentExecutionById(deploymentExecutionId);
  if (!execution || execution.runId !== runId) {
    blockers.push("Deployment execution not found for this run.");
  } else if (execution.status !== "succeeded") {
    blockers.push(
      `Deployment execution must have succeeded (current: ${execution.status}).`,
    );
  }

  const profile = getHealthCheckProfileByName(healthProfileName);
  const publicProfile =
    listPublicHealthCheckProfiles().find((p) => p.name === healthProfileName) ?? null;

  if (listHealthCheckProfiles().length === 0) {
    blockers.push("No health check profiles are configured.");
  } else if (!profile) {
    blockers.push(`Health profile not found: ${healthProfileName}`);
  } else if (!profile.allowed) {
    blockers.push(`Health profile is disabled: ${healthProfileName}`);
  } else if (profile.type !== "http") {
    blockers.push(`Health profile type is not supported: ${profile.type}`);
  }

  const environment = execution?.environmentId
    ? getDeploymentEnvironmentById(execution.environmentId)
    : null;
  if (execution && profile && environment && profile.environmentName !== environment.name) {
    blockers.push(
      `Health profile environment (${profile.environmentName}) does not match deployment environment (${environment.name}).`,
    );
  }

  const status = blockers.length > 0 ? "blocked" : "ready";
  const recommendedAction =
    status === "blocked"
      ? "Resolve blockers before running a health check."
      : "Ready to run read-only HTTP health check for this deployment.";

  return {
    status,
    blockers,
    warnings,
    recommendedAction,
    profile: publicProfile,
  };
}
