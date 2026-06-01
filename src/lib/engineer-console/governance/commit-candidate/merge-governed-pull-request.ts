import fs from "fs";
import path from "path";
import { mergeGithubPr, viewGithubPr } from "../../release/merge-controls/controlled-gh-merge";
import { MergeControlError } from "../../release/merge-controls/merge-control-types";
import { markCommitCandidatePullRequestMerged } from "./commit-candidate-manager";
import {
  auditGovernedPrMergeRejected,
  auditGovernedPrMergeRequested,
  auditGovernedPrMergeValidated,
  auditGovernedPrMerged,
} from "./pr-merge-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  GovernedPrMergeError,
  validateGovernedPrMergeForRun,
} from "./validate-governed-pr-merge-for-run";
import { ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA } from "./governed-pr-merge-types";
import type { GovernedPrMergeMethod } from "./governed-pr-merge-types";

export interface MergeGovernedPullRequestInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  mergeMethod?: GovernedPrMergeMethod;
}

export interface MergeGovernedPullRequestResult {
  runId: string;
  candidateId: string;
  status: "pull_request_merged";
  provider: "github";
  pullRequestUrl: string;
  pullRequestNumber: number;
  mergeCommitSha: string | null;
  mergedAt: string;
  mergeEvidencePath: string;
  notDeployed: true;
  notComplete: true;
}

export async function mergeGovernedPullRequestForRun(
  input: MergeGovernedPullRequestInput,
): Promise<MergeGovernedPullRequestResult> {
  let ctx;
  try {
    ctx = await validateGovernedPrMergeForRun(input);
    auditGovernedPrMergeRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.mergedBy,
      ctx.mergeMethod,
    );
    auditGovernedPrMergeValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      mergeMethod: ctx.mergeMethod,
      mergedBy: ctx.mergedBy,
      reason: ctx.mergedReason,
      prUrl: ctx.prUrl,
      prNumber: ctx.prNumber,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof GovernedPrMergeError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditGovernedPrMergeRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  let prInspectionBeforeMerge: unknown;
  try {
    const preView = await viewGithubPr(ctx.repoPath, ctx.prNumber, ctx.prUrl);
    prInspectionBeforeMerge = preView;
    if (preView.merged) {
      const err = new GovernedPrMergeError("Pull request is already merged", "PR_ALREADY_MERGED");
      auditGovernedPrMergeRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        err.message,
        err.code,
        ctx.mergedBy,
      );
      throw err;
    }
    if (preView.state === "CLOSED") {
      const err = new GovernedPrMergeError("Pull request is closed", "PR_CLOSED");
      auditGovernedPrMergeRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        err.message,
        err.code,
        ctx.mergedBy,
      );
      throw err;
    }
    if (preView.headRefName && preView.headRefName !== ctx.headBranch) {
      const err = new GovernedPrMergeError(
        "Live PR head branch does not match governed remote branch",
        "PR_BRANCH_MISMATCH",
      );
      auditGovernedPrMergeRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        err.message,
        err.code,
        ctx.mergedBy,
      );
      throw err;
    }
    if (
      preView.baseRefName &&
      preView.baseRefName !== ctx.baseBranch
    ) {
      const err = new GovernedPrMergeError(
        "Live PR base branch does not match governed base branch",
        "PR_BASE_BRANCH_MISMATCH",
      );
      auditGovernedPrMergeRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        err.message,
        err.code,
        ctx.mergedBy,
      );
      throw err;
    }
    if (
      preView.headRefOid &&
      preView.headRefOid.toLowerCase() !== ctx.commitHash.toLowerCase()
    ) {
      const err = new GovernedPrMergeError(
        "Live PR head commit does not match governed local commit hash",
        "COMMIT_HASH_MISMATCH",
      );
      auditGovernedPrMergeRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        err.message,
        err.code,
        ctx.mergedBy,
      );
      throw err;
    }
  } catch (error) {
    if (error instanceof GovernedPrMergeError) throw error;
    const message =
      error instanceof MergeControlError
        ? error.message
        : error instanceof Error
          ? error.message
          : "PR inspection failed";
    const err = new GovernedPrMergeError(message, "PR_INSPECTION_FAILED");
    auditGovernedPrMergeRejected(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      err.message,
      err.code,
      ctx.mergedBy,
    );
    throw err;
  }

  let mergeCommandResult: { stdout: string; stderr: string };
  try {
    mergeCommandResult = await mergeGithubPr(
      ctx.repoPath,
      ctx.prNumber,
      ctx.prUrl,
      ctx.mergeMethod,
    );
  } catch (error) {
    const message =
      error instanceof MergeControlError
        ? error.message
        : error instanceof Error
          ? error.message
          : "PR merge failed";
    auditGovernedPrMergeRejected(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      message,
      "PR_MERGE_FAILED",
      ctx.mergedBy,
    );
    throw new GovernedPrMergeError(message, "PR_MERGE_FAILED");
  }

  let mergeCommitSha: string | null = null;
  try {
    const postView = await viewGithubPr(ctx.repoPath, ctx.prNumber, ctx.prUrl);
    mergeCommitSha = postView.mergeCommitOid ?? postView.headRefOid ?? null;
  } catch {
    mergeCommitSha = null;
  }

  const mergedAt = new Date().toISOString();
  const mergeEvidencePath = path.join(ctx.artifactDirectory, "pull-request-merge-result.json");

  const evidence = {
    schema: ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    provider: "github" as const,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    baseBranch: ctx.baseBranch,
    headBranch: ctx.headBranch,
    commitHash: ctx.commitHash,
    mergeMethod: ctx.mergeMethod,
    mergeCommitSha,
    mergedBy: ctx.mergedBy,
    mergedReason: ctx.mergedReason,
    mergedAt,
    signOffSummary: ctx.signOffSummary,
    mergeReadinessSummary: ctx.mergeReadinessSummary,
    qualityGateSummary: ctx.qualityGateSummary,
    prInspectionBeforeMerge,
    ghMergeStdout: mergeCommandResult.stdout,
    ghMergeStderr: mergeCommandResult.stderr,
    notDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(mergeEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidatePullRequestMerged({
    candidateId: ctx.candidate.id,
    mergeMethod: ctx.mergeMethod,
    mergeCommitSha,
    mergedAt,
    mergedBy: ctx.mergedBy,
    mergeReason: ctx.mergedReason,
    mergeEvidencePath,
  });

  auditGovernedPrMerged(ctx.runId, ctx.taskId, ctx.candidate.id, {
    mergeMethod: ctx.mergeMethod,
    mergeCommitSha,
    mergedBy: ctx.mergedBy,
    reason: ctx.mergedReason,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeEvidencePath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "pull_request_merged",
    provider: "github",
    pullRequestUrl: ctx.prUrl,
    pullRequestNumber: Number.parseInt(ctx.prNumber, 10),
    mergeCommitSha,
    mergedAt,
    mergeEvidencePath,
    notDeployed: true,
    notComplete: true,
  };
}
