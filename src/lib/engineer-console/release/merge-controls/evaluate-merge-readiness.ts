import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getRegisteredRepoById } from "../../repo-intelligence/registered-repos/get-repo";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
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
import { getPrRequestById, listPrRequestsForRun } from "../pr-creation/pr-request-manager";
import type { PrRequestRecord } from "../pr-creation/pr-creation-types";
import { viewGithubPr } from "./controlled-gh-merge";
import type { MergeReadinessResult, MergeReadinessSignals } from "./merge-control-types";

function buildSignals(
  partial: Partial<MergeReadinessSignals> & Pick<MergeReadinessSignals, "runId" | "runStatus">,
): MergeReadinessSignals {
  return {
    hasApprovedDecision: false,
    hasEvidenceBundle: false,
    policyStatus: null,
    replayStatus: null,
    reviewStagesApproved: 0,
    reviewStagesPending: 0,
    reviewStagesRejected: 0,
    qualityGatesFailed: 0,
    governanceRiskLevel: null,
    prRequestId: null,
    prRequestStatus: null,
    prState: null,
    prMerged: false,
    headBranchMatches: null,
    ...partial,
  };
}

export function resolvePrRequestForMerge(
  runId: string,
  prRequestId?: string | null,
): PrRequestRecord | null {
  if (prRequestId) {
    const record = getPrRequestById(prRequestId);
    if (!record || record.runId !== runId) return null;
    return record;
  }
  return listPrRequestsForRun(runId).find((r) => r.status === "pr_created") ?? null;
}

export async function evaluateMergeReadiness(
  runId: string,
  prRequestId?: string | null,
  options: { inspectGithub?: boolean } = {},
): Promise<MergeReadinessResult> {
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
      signals: buildSignals({ runId, runStatus: "unknown" }),
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
      signals: buildSignals({ runId, runStatus: run.status }),
    };
  }

  const prRequest = resolvePrRequestForMerge(runId, prRequestId);
  const decisions = listDecisionRecords(runId);
  const hasApprovedDecision = decisions.some((d) => d.decision === "approved");
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

  let prState: string | null = null;
  let prMerged = false;
  let headBranchMatches: boolean | null = null;

  const signals = buildSignals({
    runId,
    runStatus: run.status,
    prRequestId: prRequest?.id ?? null,
    prRequestStatus: prRequest?.status ?? null,
    hasApprovedDecision,
    hasEvidenceBundle: evidence !== null,
    policyStatus: policy?.status ?? null,
    replayStatus: replay?.status ?? null,
    reviewStagesApproved: reviewSummary.approvedCount,
    reviewStagesPending: reviewSummary.pendingCount,
    reviewStagesRejected: reviewSummary.rejectedCount,
    qualityGatesFailed: gatesFailed,
    governanceRiskLevel: governance.riskLevel,
    prState,
    prMerged,
    headBranchMatches,
  });

  if (!hasApprovedDecision) {
    blockers.push("Run requires an approved human decision before merge.");
  }

  if (!prRequest) {
    blockers.push("A completed PR request (pr_created) is required before merge.");
  } else if (prRequest.status !== "pr_created") {
    blockers.push(`PR request status must be pr_created (current: ${prRequest.status}).`);
  }

  if (!evidence) {
    blockers.push("Evidence bundle is required before merge.");
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

  if (prRequest && options.inspectGithub !== false) {
    try {
      const repoPath = resolveTaskTargetRepoPath(task);
      const view = await viewGithubPr(repoPath, prRequest.prNumber, prRequest.prUrl);
      prState = view.state;
      prMerged = view.merged;
      headBranchMatches =
        prRequest.branchName && view.headRefName
          ? prRequest.branchName === view.headRefName
          : null;

      signals.prState = prState;
      signals.prMerged = prMerged;
      signals.headBranchMatches = headBranchMatches;

      if (view.merged) {
        blockers.push("Pull request is already merged on GitHub.");
      }
      if (view.state === "CLOSED" && !view.merged) {
        blockers.push("Pull request is closed without merge.");
      }
      if (headBranchMatches === false) {
        blockers.push(
          `PR head branch (${view.headRefName}) does not match recorded branch (${prRequest.branchName}).`,
        );
      }
      if (
        prRequest.commitSha &&
        view.headRefOid &&
        prRequest.commitSha !== view.headRefOid
      ) {
        warnings.push("PR head commit differs from recorded PR request commit SHA.");
      }
    } catch {
      warnings.push("Unable to verify PR state via GitHub CLI; merge may fail at execution.");
    }
  }

  let status: MergeReadinessResult["status"] = "passed";
  if (blockers.length > 0) {
    status = "blocked";
  } else if (warnings.length > 0 || policy?.status === "requires_review") {
    status = "requires_review";
  }

  const recommendedAction =
    status === "blocked"
      ? "Resolve blockers before merging."
      : status === "requires_review"
        ? "Review warnings and provide admin rationale before merging."
        : "Ready to merge pull request.";

  return {
    status,
    blockers,
    warnings,
    requiredEvidence,
    recommendedAction,
    signals,
  };
}
