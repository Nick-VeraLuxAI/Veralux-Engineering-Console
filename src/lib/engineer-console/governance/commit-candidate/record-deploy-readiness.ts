import fs from "fs";
import path from "path";
import { viewGithubPr } from "../../release/merge-controls/controlled-gh-merge";
import { MergeControlError } from "../../release/merge-controls/merge-control-types";
import { markCommitCandidateDeployReadinessRecorded } from "./commit-candidate-manager";
import {
  auditDeployReadinessRecorded,
  auditDeployReadinessRejected,
  auditDeployReadinessRequested,
  auditDeployReadinessValidated,
} from "./deploy-readiness-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  DeployReadinessError,
  validateDeployReadinessForRun,
} from "./validate-deploy-readiness-for-run";
import { ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA } from "./deploy-readiness-types";
import {
  readGovernedRepoHeadSha,
  readGovernedRepoPorcelainStatus,
} from "./governed-post-merge-git";

export interface RecordDeployReadinessInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision: "ready" | "not_ready" | "blocked";
  notes?: string;
}

export interface RecordDeployReadinessResult {
  runId: string;
  candidateId: string;
  status: "deploy_readiness_recorded";
  decision: "ready" | "not_ready" | "blocked";
  deployReadinessPath: string;
  notDeployed: true;
  notComplete: true;
}

export async function recordDeployReadinessForRun(
  input: RecordDeployReadinessInput,
): Promise<RecordDeployReadinessResult> {
  let ctx;
  try {
    ctx = await validateDeployReadinessForRun(input);
    auditDeployReadinessRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.reviewedBy,
      ctx.decision,
    );
    auditDeployReadinessValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      decision: ctx.decision,
      reviewedBy: ctx.reviewedBy,
      reason: ctx.reviewedReason,
      prUrl: ctx.prUrl,
      prNumber: ctx.prNumber,
      mergeCommitSha: ctx.mergeCommitSha,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof DeployReadinessError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditDeployReadinessRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  let postMergeInspectionSummary: unknown = null;
  if (ctx.livePrInspectionAvailable) {
    try {
      const prView = await viewGithubPr(ctx.repoPath, ctx.prNumber, ctx.prUrl);
      const localHeadSha = await readGovernedRepoHeadSha(ctx.repoPath);
      const porcelainStatus = await readGovernedRepoPorcelainStatus(ctx.repoPath);

      postMergeInspectionSummary = {
        prView,
        localHeadSha,
        porcelainStatus,
      };

      if (!prView.merged) {
        const err = new DeployReadinessError(
          "Pull request is not merged; deploy readiness cannot be recorded",
          "PR_NOT_MERGED",
        );
        auditDeployReadinessRejected(
          ctx.runId,
          ctx.taskId,
          ctx.candidate.id,
          err.message,
          err.code,
          ctx.reviewedBy,
        );
        throw err;
      }

      if (prView.baseRefName && prView.baseRefName !== ctx.baseBranch) {
        const err = new DeployReadinessError(
          "Live PR base branch does not match governed base branch",
          "PR_BASE_BRANCH_MISMATCH",
        );
        auditDeployReadinessRejected(
          ctx.runId,
          ctx.taskId,
          ctx.candidate.id,
          err.message,
          err.code,
          ctx.reviewedBy,
        );
        throw err;
      }

      if (
        prView.mergeCommitOid &&
        ctx.mergeCommitSha &&
        prView.mergeCommitOid.toLowerCase() !== ctx.mergeCommitSha.toLowerCase()
      ) {
        const err = new DeployReadinessError(
          "Live PR merge commit does not match stored merge evidence",
          "MERGE_COMMIT_MISMATCH",
        );
        auditDeployReadinessRejected(
          ctx.runId,
          ctx.taskId,
          ctx.candidate.id,
          err.message,
          err.code,
          ctx.reviewedBy,
        );
        throw err;
      }

      if (ctx.decision === "ready" && porcelainStatus.length > 0) {
        const err = new DeployReadinessError(
          "Working tree is not clean; cannot record ready deploy readiness",
          "WORKING_TREE_DIRTY",
        );
        auditDeployReadinessRejected(
          ctx.runId,
          ctx.taskId,
          ctx.candidate.id,
          err.message,
          err.code,
          ctx.reviewedBy,
        );
        throw err;
      }
    } catch (error) {
      if (error instanceof DeployReadinessError) throw error;
      const message =
        error instanceof MergeControlError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Post-merge inspection failed";
      postMergeInspectionSummary = { skipped: true, reason: message };
    }
  }

  const reviewedAt = new Date().toISOString();
  const deployReadinessPath = path.join(ctx.artifactDirectory, "deploy-readiness-result.json");

  const evidence = {
    schema: ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    decision: ctx.decision,
    notes: ctx.notes,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    baseBranch: ctx.baseBranch,
    headBranch: ctx.headBranch,
    mergeMethod: ctx.mergeMethod,
    mergeCommitSha: ctx.mergeCommitSha,
    mergedAt: ctx.mergedAt,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    mergeSummary: ctx.mergeSummary,
    postMergeInspectionSummary,
    reviewedBy: ctx.reviewedBy,
    reviewedReason: ctx.reviewedReason,
    reviewedAt,
    notDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(deployReadinessPath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidateDeployReadinessRecorded({
    candidateId: ctx.candidate.id,
    deployReadinessDecision: ctx.decision,
    deployReadinessReviewedAt: reviewedAt,
    deployReadinessReviewedBy: ctx.reviewedBy,
    deployReadinessReason: ctx.reviewedReason,
    deployReadinessEvidencePath: deployReadinessPath,
  });

  auditDeployReadinessRecorded(ctx.runId, ctx.taskId, ctx.candidate.id, {
    decision: ctx.decision,
    reviewedBy: ctx.reviewedBy,
    reason: ctx.reviewedReason,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    deployReadinessPath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "deploy_readiness_recorded",
    decision: ctx.decision,
    deployReadinessPath,
    notDeployed: true,
    notComplete: true,
  };
}
