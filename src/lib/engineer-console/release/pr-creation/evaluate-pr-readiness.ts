import { getEngineerConsoleDb } from "../../db/client";
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
import {
  getCommitChangedFiles,
  getCurrentBranch,
  getLocalBranchRef,
  getRefCommitSha,
  getRemoteBranchRef,
  isCommitReachableFromRef,
  listCommitsOnRef,
} from "./controlled-git-executor";
import type {
  PrReadinessResult,
  PrReadinessSignals,
  PrReusableCommitSource,
} from "./pr-creation-types";

interface RecordedCommitState {
  commitSha: string | null;
  commitMessage: string | null;
}

interface RecordedPrState {
  prUrl: string | null;
  prNumber: string | null;
}

interface ReusableCommitDetection {
  commitSha: string | null;
  commitMessage: string | null;
  source: PrReusableCommitSource;
  reason: string | null;
  staleRecordedCommitReason: string | null;
}

function getLatestRecordedCommit(runId: string, branchName: string | null): RecordedCommitState {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT commit_sha, commit_message
       FROM engineer_pr_requests
       WHERE run_id = ?
         AND commit_sha IS NOT NULL
         AND (? IS NULL OR branch_name = ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(runId, branchName, branchName) as
    | { commit_sha: string | null; commit_message: string | null }
    | undefined;

  return {
    commitSha: row?.commit_sha ?? null,
    commitMessage: row?.commit_message ?? null,
  };
}

function getLatestRecordedPr(runId: string, branchName: string | null): RecordedPrState {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT pr_url, pr_number
       FROM engineer_pr_requests
       WHERE run_id = ?
         AND pr_url IS NOT NULL
         AND (? IS NULL OR branch_name = ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(runId, branchName, branchName) as
    | { pr_url: string | null; pr_number: string | null }
    | undefined;

  return {
    prUrl: row?.pr_url ?? null,
    prNumber: row?.pr_number ?? null,
  };
}

function normalizePathForComparison(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function buildExpectedCommitFiles(
  workerPlanPaths: string[] | undefined,
  approvalReport: ApprovalReport | null,
): Set<string> {
  return new Set(
    [...(workerPlanPaths ?? []), ...(approvalReport?.changedFiles ?? [])]
      .map((value) => normalizePathForComparison(value))
      .filter((value) => value.length > 0),
  );
}

function commitMatchesApprovedScope(commitFiles: string[], expectedFiles: Set<string>): boolean {
  if (commitFiles.length === 0) {
    return false;
  }
  if (expectedFiles.size === 0) {
    return true;
  }
  return commitFiles.every((file) => expectedFiles.has(normalizePathForComparison(file)));
}

async function detectReusableCommit(input: {
  repoPath: string;
  runId: string;
  runBranchName: string | null;
  currentBranchName: string | null;
  recordedCommit: RecordedCommitState;
  expectedCommitFiles: Set<string>;
}): Promise<ReusableCommitDetection> {
  const { repoPath, runId, runBranchName, currentBranchName, recordedCommit, expectedCommitFiles } = input;
  if (!runBranchName) {
    return {
      commitSha: null,
      commitMessage: null,
      source: "none",
      reason: null,
      staleRecordedCommitReason: null,
    };
  }

  const runBranchRef = getLocalBranchRef(runBranchName);
  const localRunBranchSha = await getRefCommitSha(repoPath, runBranchRef);
  if (!localRunBranchSha) {
    return {
      commitSha: null,
      commitMessage: null,
      source: "none",
      reason: null,
      staleRecordedCommitReason: null,
    };
  }

  let staleRecordedCommitReason: string | null = null;
  if (recordedCommit.commitSha) {
    const recordedCommitReachable = await isCommitReachableFromRef(repoPath, recordedCommit.commitSha, runBranchRef);
    if (recordedCommitReachable) {
      return {
        commitSha: recordedCommit.commitSha,
        commitMessage: recordedCommit.commitMessage,
        source: "request_history",
        reason: "Ready to resume PR creation using the existing run commit recorded in PR history.",
        staleRecordedCommitReason: null,
      };
    }
    staleRecordedCommitReason =
      "A previously recorded run commit is no longer reachable from the run branch. Manual recovery is required before retrying PR creation.";
  }

  const shortRunId = runId.slice(0, 8);
  const commits = await listCommitsOnRef(repoPath, runBranchRef, 50);
  for (const candidate of commits) {
    if (!candidate.subject.includes(`[run:${shortRunId}]`) && !candidate.subject.includes(runId)) {
      continue;
    }
    const commitFiles = await getCommitChangedFiles(repoPath, candidate.sha);
    if (!commitMatchesApprovedScope(commitFiles, expectedCommitFiles)) {
      continue;
    }
    const source: PrReusableCommitSource =
      currentBranchName === runBranchName && candidate.sha === localRunBranchSha
        ? "current_head"
        : "run_branch_history";
    return {
      commitSha: candidate.sha,
      commitMessage: candidate.subject,
      source,
      reason:
        source === "current_head"
          ? "Ready to resume PR creation using the current run-branch HEAD commit."
          : "Ready to resume PR creation using the existing run commit detected on the run branch.",
      staleRecordedCommitReason,
    };
  }

  return {
    commitSha: null,
    commitMessage: null,
    source: "none",
    reason: null,
    staleRecordedCommitReason,
  };
}

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
    runBranchName: null,
    currentBranchName: null,
    currentBranchMatchesRunBranch: false,
    localRunBranchExists: false,
    localRunBranchSha: null,
    remoteBranchExists: false,
    remoteBranchSha: null,
    remoteBranchMatchesReusableCommit: false,
    cleanTree: false,
    reusableCommitSha: null,
    reusableCommitShaPrefix: null,
    reusableCommitMessage: null,
    reusableCommitSource: "none",
    canResume: false,
    resumeReason: null,
    manualRecoveryRequired: false,
    manualRecoveryReason: null,
    existingPrUrl: null,
    existingPrNumber: null,
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
  const recordedCommit = getLatestRecordedCommit(runId, run.branchName ?? null);
  const existingPrState = getLatestRecordedPr(runId, run.branchName ?? null);

  let changedFiles: string[] = [];
  let currentBranch: string | null = null;
  let localRunBranchSha: string | null = null;
  let remoteRunBranchSha: string | null = null;
  let gitReadOk = false;
  const repoPath = resolveTaskTargetRepoPath(task);
  const workerPlanScope = getWorkerPlanChangedFilesScope(runId);

  const reportJson = getApprovalReportJson(runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;
  const expectedCommitFiles = buildExpectedCommitFiles(workerPlanScope?.workerPlanPaths, approvalReport);

  let reusableCommit: ReusableCommitDetection = {
    commitSha: null,
    commitMessage: null,
    source: "none" as PrReusableCommitSource,
    reason: null,
    staleRecordedCommitReason: null,
  };

  try {
    changedFiles = await getChangedFiles(repoPath, workerPlanScope ?? {});
    currentBranch = await getCurrentBranch(repoPath);
    if (run.branchName) {
      localRunBranchSha = await getRefCommitSha(repoPath, getLocalBranchRef(run.branchName));
      remoteRunBranchSha = await getRefCommitSha(repoPath, getRemoteBranchRef(run.branchName));
    }
    reusableCommit = await detectReusableCommit({
      repoPath,
      runId,
      runBranchName: run.branchName ?? null,
      currentBranchName: currentBranch,
      recordedCommit,
      expectedCommitFiles,
    });
    gitReadOk = true;
  } catch {
    blockers.push("Unable to read git workspace state.");
  }

  const governance = assessChangedFiles(changedFiles.length > 0 ? changedFiles : (approvalReport?.changedFiles ?? []));
  const currentBranchMatchesRunBranch =
    run.branchName !== null && currentBranch !== null ? currentBranch === run.branchName : false;
  const cleanTree = gitReadOk
    ? changedFiles.length === 0
    : (approvalReport?.changedFiles.length ?? 0) === 0;
  const canAssessManualRecoveryFromCurrentTree =
    run.branchName === null || currentBranch === null || currentBranchMatchesRunBranch;
  const manualRecoveryReason =
    reusableCommit.staleRecordedCommitReason ??
    (canAssessManualRecoveryFromCurrentTree && cleanTree && reusableCommit.commitSha === null
      ? "No changed files are available to commit and no reusable run commit could be found. Restore the approved changes or resume from the existing run branch/commit before retrying PR creation."
      : null);
  const manualRecoveryRequired = manualRecoveryReason !== null;
  const remoteBranchExists = remoteRunBranchSha !== null;
  const remoteBranchMatchesReusableCommit =
    remoteRunBranchSha !== null && reusableCommit.commitSha !== null && remoteRunBranchSha === reusableCommit.commitSha;
  const canResume = reusableCommit.commitSha !== null && !manualRecoveryRequired && existingPrState.prUrl === null;

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
    runBranchName: run.branchName ?? null,
    currentBranchName: currentBranch,
    currentBranchMatchesRunBranch,
    localRunBranchExists: localRunBranchSha !== null,
    localRunBranchSha,
    remoteBranchExists,
    remoteBranchSha: remoteRunBranchSha,
    remoteBranchMatchesReusableCommit,
    cleanTree,
    reusableCommitSha: reusableCommit.commitSha,
    reusableCommitShaPrefix: reusableCommit.commitSha?.slice(0, 12) ?? null,
    reusableCommitMessage: reusableCommit.commitMessage,
    reusableCommitSource: reusableCommit.source,
    canResume,
    resumeReason: reusableCommit.reason,
    manualRecoveryRequired,
    manualRecoveryReason,
    existingPrUrl: existingPrState.prUrl,
    existingPrNumber: existingPrState.prNumber,
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

  const hasRecordedCommit = reusableCommit.commitSha !== null;
  const hasRecordedPr = existingPrState.prUrl !== null;
  if (manualRecoveryRequired) {
    blockers.push(
      manualRecoveryReason ??
        "No changed files detected for commit and no reusable run commit is recorded. Recovery required before retrying PR creation.",
    );
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
    warnings.push(
      `Current checkout differs from the run branch. Retry will first checkout ${run.branchName} before continuing.`,
    );
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
      : hasRecordedPr
        ? "Ready to resume PR creation by reusing the existing PR record."
        : hasRecordedCommit
          ? remoteBranchMatchesReusableCommit
            ? "Ready to resume PR creation using the existing run commit. The remote branch already matches it, so push can be skipped."
            : "Ready to resume PR creation using the existing run commit."
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
