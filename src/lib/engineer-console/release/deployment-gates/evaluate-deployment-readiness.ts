import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getRegisteredRepoById } from "../../repo-intelligence/registered-repos/get-repo";
import { getTaskById } from "../../task-manager/task-manager";
import type { ApprovalReport } from "../../types";
import { assessChangedFiles } from "../../governance/governance-engine";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { listDecisionRecords } from "../../governance/decision-records/decision-record-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";
import { listPrRequestsForRun } from "../pr-creation/pr-request-manager";
import { listMergeRequestsForRun } from "../merge-controls/merge-request-manager";
import { getDeploymentEnvironmentById } from "./deployment-environments";
import type { DeploymentReadinessResult, DeploymentReadinessSignals } from "./deployment-gate-types";
import { DEPLOYMENT_STRATEGIES } from "./deployment-gate-types";

function buildSignals(
  partial: Partial<DeploymentReadinessSignals> &
    Pick<
      DeploymentReadinessSignals,
      "runId" | "runStatus" | "environmentId" | "environmentName" | "environmentType" | "deploymentStrategy"
    >,
): DeploymentReadinessSignals {
  return {
    hasApprovedDecision: false,
    hasPrCreated: false,
    mergeRequestId: null,
    mergeRequestStatus: null,
    mergeSha: null,
    hasEvidenceBundle: false,
    policyStatus: null,
    replayStatus: null,
    reviewStagesApproved: 0,
    reviewStagesPending: 0,
    reviewStagesRejected: 0,
    qualityGatesFailed: 0,
    governanceRiskLevel: null,
    ...partial,
  };
}

export function resolveLatestMergedMergeRequest(runId: string) {
  return listMergeRequestsForRun(runId).find((m) => m.status === "merged") ?? null;
}

export function evaluateDeploymentReadiness(
  runId: string,
  environmentId: string,
): DeploymentReadinessResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const requiredEvidence: string[] = [];

  const environment = getDeploymentEnvironmentById(environmentId);
  if (!environment) {
    return {
      status: "blocked",
      blockers: ["Deployment environment not found."],
      warnings: [],
      requiredEvidence: [],
      recommendedAction: "Select a valid environment.",
      environment: {
        id: environmentId,
        name: "unknown",
        environmentType: "staging",
        deploymentStrategy: "manual",
      },
      signals: buildSignals({
        runId,
        runStatus: "unknown",
        environmentId,
        environmentName: "unknown",
        environmentType: "staging",
        deploymentStrategy: "manual",
      }),
    };
  }

  const envMeta = {
    id: environment.id,
    name: environment.name,
    environmentType: environment.environmentType,
    deploymentStrategy: environment.deploymentStrategy,
  };

  const run = getRunById(runId);
  if (!run) {
    return {
      status: "blocked",
      blockers: ["Run not found."],
      warnings: [],
      requiredEvidence: [],
      recommendedAction: "Verify run id.",
      environment: envMeta,
      signals: buildSignals({
        runId,
        runStatus: "unknown",
        environmentId: environment.id,
        environmentName: environment.name,
        environmentType: environment.environmentType,
        deploymentStrategy: environment.deploymentStrategy,
      }),
    };
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    return {
      status: "blocked",
      blockers: ["Task not found for run."],
      warnings: [],
      requiredEvidence: [],
      recommendedAction: "Verify task linkage.",
      environment: envMeta,
      signals: buildSignals({
        runId,
        runStatus: run.status,
        environmentId: environment.id,
        environmentName: environment.name,
        environmentType: environment.environmentType,
        deploymentStrategy: environment.deploymentStrategy,
      }),
    };
  }

  const decisions = listDecisionRecords(runId);
  const hasApprovedDecision = decisions.some((d) => d.decision === "approved");
  const prRequests = listPrRequestsForRun(runId);
  const hasPrCreated = prRequests.some((p) => p.status === "pr_created");
  const mergedRequest = resolveLatestMergedMergeRequest(runId);
  const evidence = getEvidenceBundleForRun(runId);
  const policy = getLatestPolicyEvaluationResult(runId);
  const replay = getLatestReplayVerificationResult(runId);
  const reviewSummary = summarizeReviewStages(listReviewStagesForRun(runId));
  const gates = getQualityGateResultsForRun(runId);
  const gatesFailed = gates.filter((g) => g.status === "failed").length;

  const reportJson = getApprovalReportJson(runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;
  const governance = assessChangedFiles(approvalReport?.changedFiles ?? []);

  const signals = buildSignals({
    runId,
    runStatus: run.status,
    environmentId: environment.id,
    environmentName: environment.name,
    environmentType: environment.environmentType,
    deploymentStrategy: environment.deploymentStrategy,
    hasApprovedDecision,
    hasPrCreated,
    mergeRequestId: mergedRequest?.id ?? null,
    mergeRequestStatus: mergedRequest?.status ?? null,
    mergeSha: mergedRequest?.mergeSha ?? null,
    hasEvidenceBundle: evidence !== null,
    policyStatus: policy?.status ?? null,
    replayStatus: replay?.status ?? null,
    reviewStagesApproved: reviewSummary.approvedCount,
    reviewStagesPending: reviewSummary.pendingCount,
    reviewStagesRejected: reviewSummary.rejectedCount,
    qualityGatesFailed: gatesFailed,
    governanceRiskLevel: governance.riskLevel,
  });

  if (!environment.isActive) {
    blockers.push("Deployment environment is not active.");
  }

  if (!DEPLOYMENT_STRATEGIES.includes(environment.deploymentStrategy)) {
    blockers.push(`Unsupported deployment strategy: ${environment.deploymentStrategy}.`);
  }

  if (!hasApprovedDecision) {
    blockers.push("Run requires an approved human decision before deployment readiness.");
  }

  if (!hasPrCreated) {
    blockers.push("A created pull request (pr_created) is required before deployment readiness.");
  }

  if (!mergedRequest) {
    blockers.push("A merged merge request is required before deployment readiness.");
  } else if (mergedRequest.status !== "merged") {
    blockers.push(`Merge request must be merged (current: ${mergedRequest.status}).`);
  }

  if (mergedRequest && !mergedRequest.mergeSha) {
    blockers.push("Merge SHA is required on the merged merge request.");
  }

  if (
    environment.requiredBranch &&
    mergedRequest?.baseBranch &&
    mergedRequest.baseBranch !== environment.requiredBranch
  ) {
    blockers.push(
      `Merge base branch (${mergedRequest.baseBranch}) does not match environment required branch (${environment.requiredBranch}).`,
    );
  }

  if (!evidence) {
    blockers.push("Evidence bundle is required before deployment readiness.");
    requiredEvidence.push("evidence_bundle");
  } else {
    requiredEvidence.push(`evidence_bundle:${evidence.bundleHash.slice(0, 12)}`);
  }

  if (policy?.status === "blocked") {
    blockers.push(`Policy evaluation blocked: ${policy.blockers[0] ?? policy.summary}`);
  } else if (policy?.status === "requires_review") {
    warnings.push("Policy evaluation requires senior review.");
  }

  if (reviewSummary.pendingCount > 0) {
    blockers.push("Required review stages are still pending.");
  }
  if (reviewSummary.rejectedCount > 0) {
    blockers.push("Required review stages were rejected.");
  }

  if (!replay) {
    blockers.push("Replay verification has not been run.");
    requiredEvidence.push("replay_verification");
  } else if (replay.status !== "passed") {
    blockers.push(`Replay verification must pass (current: ${replay.status}).`);
  }

  if (gatesFailed > 0) {
    blockers.push(`${gatesFailed} quality gate(s) failed.`);
  }

  if (governance.riskLevel === "blocked" || governance.blockedFiles.length > 0) {
    blockers.push("Protected path blockers present in governance assessment.");
  }

  if (task.registeredRepoId) {
    const repo = getRegisteredRepoById(task.registeredRepoId);
    if (!repo) {
      blockers.push("Registered repository record not found.");
    } else if (repo.verificationStatus !== "ok") {
      blockers.push(`Registered repository verification status is ${repo.verificationStatus}.`);
    }
  }

  if (environment.environmentType === "production") {
    warnings.push("Production environment requires explicit admin rationale on deployment approval.");
  }

  let status: DeploymentReadinessResult["status"] = "passed";
  if (blockers.length > 0) {
    status = "blocked";
  } else if (warnings.length > 0 || policy?.status === "requires_review") {
    status = "requires_review";
  }

  const recommendedAction =
    status === "blocked"
      ? "Resolve blockers before recording deployment approval."
      : status === "requires_review"
        ? "Review warnings and provide admin rationale before deployment approval."
        : "Ready to record deployment approval (no deploy execution in this phase).";

  return {
    status,
    blockers,
    warnings,
    requiredEvidence,
    recommendedAction,
    environment: envMeta,
    signals,
  };
}
