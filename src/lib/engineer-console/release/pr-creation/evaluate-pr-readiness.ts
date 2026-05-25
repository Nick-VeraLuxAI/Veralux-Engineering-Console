import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getRegisteredRepoById } from "../../repo-intelligence/registered-repos/get-repo";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { getTaskById } from "../../task-manager/task-manager";
import type { ApprovalReport } from "../../types";
import { getWorkerPlanChangedFilesScope } from "../../worker-plan/worker-plan-manager";
import { getChangedFiles } from "../../workspace/git-workspace";
import { assessChangedFiles } from "../../governance/governance-engine";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { listDecisionRecords } from "../../governance/decision-records/decision-record-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";
import { getCurrentBranch } from "./controlled-git-executor";
import type { PrReadinessResult, PrReadinessSignals } from "./pr-creation-types";

function buildSignals(
  runId: string,
  partial: Partial<PrReadinessSignals> & Pick<PrReadinessSignals, "runId" | "runStatus">,
): PrReadinessSignals {
  return {
    hasApprovedDecision: false,
    hasEvidenceBundle: false,
    policyStatus: null,
    replayStatus: null,
    reviewStagesApproved: 0,
    reviewStagesPending: 0,
    reviewStagesRejected: 0,
    changedFileCount: 0,
    branchName: null,
    governanceRiskLevel: null,
    qualityGatesFailed: 0,
    ...partial,
  };
}

export async function evaluatePrReadiness(runId: string): Promise<PrReadinessResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const requiredEvidence: string[] = [];

  const run = getRunById(runId);
  if (!run) {
    return {
      status: "blocked",
      blockers: ["Run not found."],
      warnings: [],
      requiredEvidence: [],
      recommendedAction: "Verify run id.",
      signals: buildSignals(runId, { runId, runStatus: "unknown" }),
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
      signals: buildSignals(runId, { runId, runStatus: run.status }),
    };
  }

  const decisions = listDecisionRecords(runId);
  const approvedDecision = decisions.find((d) => d.decision === "approved");
  const hasApprovedDecision = approvedDecision !== undefined;

  const evidence = getEvidenceBundleForRun(runId);
  const policy = getLatestPolicyEvaluationResult(runId);
  const replay = getLatestReplayVerificationResult(runId);
  const reviewSummary = summarizeReviewStages(listReviewStagesForRun(runId));

  const gates = getQualityGateResultsForRun(runId);
  const gatesFailed = gates.filter((g) => g.status === "failed").length;

  let changedFiles: string[] = [];
  let currentBranch: string | null = null;
  let gitReadOk = false;
  const repoPath = resolveTaskTargetRepoPath(task);

  try {
    const scope = getWorkerPlanChangedFilesScope(runId);
    changedFiles = await getChangedFiles(repoPath, scope ?? {});
    currentBranch = await getCurrentBranch(repoPath);
    gitReadOk = true;
  } catch {
    blockers.push("Unable to read git workspace state.");
  }

  const reportJson = getApprovalReportJson(runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const governance = assessChangedFiles(changedFiles.length > 0 ? changedFiles : (approvalReport?.changedFiles ?? []));

  const signals = buildSignals(runId, {
    runId,
    runStatus: run.status,
    hasApprovedDecision,
    hasEvidenceBundle: evidence !== null,
    policyStatus: policy?.status ?? null,
    replayStatus: replay?.status ?? null,
    reviewStagesApproved: reviewSummary.approvedCount,
    reviewStagesPending: reviewSummary.pendingCount,
    reviewStagesRejected: reviewSummary.rejectedCount,
    changedFileCount: gitReadOk
      ? changedFiles.length
      : changedFiles.length || (approvalReport?.changedFiles.length ?? 0),
    branchName: run.branchName ?? currentBranch,
    governanceRiskLevel: governance.riskLevel,
    qualityGatesFailed: gatesFailed,
  });

  if (!hasApprovedDecision) {
    blockers.push("Run requires an approved human decision before PR creation.");
  }

  if (!evidence) {
    blockers.push("Evidence bundle is required before PR creation.");
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
  } else if (replay.status === "failed") {
    blockers.push("Replay verification failed.");
  } else if (replay.status === "warning") {
    warnings.push("Replay verification reported warnings.");
  }

  if (gatesFailed > 0) {
    blockers.push(`${gatesFailed} quality gate(s) failed.`);
  }

  if (!run.branchName) {
    blockers.push("Run branch name is missing.");
  }

  if (gitReadOk && changedFiles.length === 0) {
    blockers.push("No changed files detected for commit.");
  } else if (!gitReadOk && (approvalReport?.changedFiles.length ?? 0) === 0) {
    blockers.push("No changed files detected for commit.");
  }

  if (governance.riskLevel === "blocked" || governance.blockedFiles.length > 0) {
    blockers.push("Protected path blockers present in change set.");
  }

  if (task.registeredRepoId) {
    const repo = getRegisteredRepoById(task.registeredRepoId);
    if (!repo) {
      blockers.push("Registered repository record not found.");
    } else if (repo.verificationStatus !== "ok") {
      blockers.push(`Registered repository verification status is ${repo.verificationStatus}.`);
    }
  }

  if (run.branchName && currentBranch && run.branchName !== currentBranch) {
    warnings.push(`Current branch (${currentBranch}) differs from run branch (${run.branchName}); checkout will be attempted.`);
  }

  if (run.status !== "completed") {
    warnings.push(`Run status is ${run.status}; approved decision is still required.`);
  }

  let status: PrReadinessResult["status"] = "passed";
  if (blockers.length > 0) {
    status = "blocked";
  } else if (warnings.length > 0 || policy?.status === "requires_review") {
    status = "requires_review";
  }

  const recommendedAction =
    status === "blocked"
      ? "Resolve blockers before creating a PR."
      : status === "requires_review"
        ? "Review warnings and provide rationale before creating a PR."
        : "Ready to create commit and draft PR.";

  return {
    status,
    blockers,
    warnings,
    requiredEvidence,
    recommendedAction,
    signals,
  };
}
