import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getDeploymentEnvironmentById } from "../deployment-gates/deployment-environments";
import {
  getDeploymentApprovalById,
  getDeploymentReadinessCheckById,
} from "../deployment-gates/deployment-gate-manager";
import type { DeploymentReadinessResult } from "../deployment-gates/deployment-gate-types";
import { evaluateDeploymentReadiness, resolveLatestMergedMergeRequest } from "../deployment-gates/evaluate-deployment-readiness";
import {
  getDeploymentProfileByName,
  listDeploymentProfiles,
  listPublicDeploymentProfiles,
} from "./deployment-profile-config";
import { getEngineerConsoleDb } from "../../db/client";
import type { DeploymentExecutionReadinessResult } from "./deployment-execution-types";

function hasSucceededDeploymentExecutionForApproval(approvalId: string): boolean {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT id FROM engineer_deployment_executions
       WHERE deployment_approval_id = ? AND status = 'succeeded' LIMIT 1`,
    )
    .get(approvalId);
  return !!row;
}

export function evaluateDeploymentExecutionReadiness(
  runId: string,
  deploymentApprovalId: string,
  deploymentProfileName: string,
): DeploymentExecutionReadinessResult {
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

  const approval = getDeploymentApprovalById(deploymentApprovalId);
  if (!approval || approval.runId !== runId) {
    blockers.push("Deployment approval not found for this run.");
  } else if (approval.decision !== "approved") {
    blockers.push(`Deployment approval must be approved (current: ${approval.decision}).`);
  }

  const profile = getDeploymentProfileByName(deploymentProfileName);
  const publicProfile = listPublicDeploymentProfiles().find((p) => p.name === deploymentProfileName) ?? null;

  if (listDeploymentProfiles().length === 0) {
    blockers.push("No deployment profiles are configured.");
  } else if (!profile) {
    blockers.push(`Deployment profile not found: ${deploymentProfileName}`);
  } else if (!profile.allowed) {
    blockers.push(`Deployment profile is disabled: ${deploymentProfileName}`);
  } else if (profile.strategy !== "fixed_command") {
    blockers.push(`Deployment profile strategy is not executable: ${profile.strategy}`);
  }

  const environment = approval ? getDeploymentEnvironmentById(approval.environmentId) : null;
  if (approval && profile && environment && profile.environmentName !== environment.name) {
    blockers.push(
      `Profile environment (${profile.environmentName}) does not match approval environment (${environment.name}).`,
    );
  }

  if (approval && environment && !environment.isActive) {
    blockers.push("Deployment environment is not active.");
  }

  const readinessCheck = approval ? getDeploymentReadinessCheckById(approval.readinessCheckId) : null;
  if (readinessCheck) {
    try {
      JSON.parse(readinessCheck.readinessJson) as DeploymentReadinessResult;
    } catch {
      blockers.push("Stored deployment readiness JSON is invalid.");
    }
  } else if (approval) {
    blockers.push("Deployment readiness check not found for approval.");
  }

  if (readinessCheck) {
    if (readinessCheck.status === "blocked") {
      blockers.push("Deployment readiness check is blocked.");
    } else if (readinessCheck.status === "requires_review" && !approval?.rationale?.trim()) {
      blockers.push(
        "Deployment approval requires admin rationale when readiness was requires_review.",
      );
    }
  }

  if (approval?.environmentId) {
    const currentReadiness = evaluateDeploymentReadiness(runId, approval.environmentId);
    if (currentReadiness.status === "blocked") {
      blockers.push(
        `Current deployment readiness blocked: ${currentReadiness.blockers[0] ?? "check failed"}`,
      );
    } else if (currentReadiness.status === "requires_review") {
      warnings.push("Current deployment readiness requires review.");
    }
  }

  const merged = resolveLatestMergedMergeRequest(runId);
  if (!merged || merged.status !== "merged") {
    blockers.push("A merged merge request is required before deployment execution.");
  } else if (!merged.mergeSha) {
    blockers.push("Merge SHA is required before deployment execution.");
  }

  if (!getEvidenceBundleForRun(runId)) {
    blockers.push("Evidence bundle is required before deployment execution.");
  }

  const policy = getLatestPolicyEvaluationResult(runId);
  if (policy?.status === "blocked") {
    blockers.push(`Policy evaluation blocked: ${policy.blockers[0] ?? policy.summary}`);
  }

  const replay = getLatestReplayVerificationResult(runId);
  if (!replay) {
    blockers.push("Replay verification has not been run.");
  } else if (replay.status !== "passed") {
    blockers.push(`Replay verification must pass (current: ${replay.status}).`);
  }

  const reviewSummary = summarizeReviewStages(listReviewStagesForRun(runId));
  if (reviewSummary.pendingCount > 0) {
    blockers.push("Required review stages are still pending.");
  }
  if (reviewSummary.rejectedCount > 0) {
    blockers.push("Required review stages were rejected.");
  }

  if (approval && hasSucceededDeploymentExecutionForApproval(approval.id)) {
    blockers.push("A successful deployment execution already exists for this approval.");
  }

  const status = blockers.length > 0 ? "blocked" : "ready";
  const recommendedAction =
    status === "blocked"
      ? "Resolve blockers before executing deployment."
      : "Ready to execute deployment using the selected profile.";

  return {
    status,
    blockers,
    warnings,
    recommendedAction,
    profile: publicProfile,
  };
}
