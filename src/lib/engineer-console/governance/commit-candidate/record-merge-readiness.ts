import fs from "fs";
import path from "path";
import { viewGithubPr } from "../../release/merge-controls/controlled-gh-merge";
import { MergeControlError } from "../../release/merge-controls/merge-control-types";
import { markCommitCandidateMergeReadinessRecorded } from "./commit-candidate-manager";
import {
  auditMergeReadinessRecorded,
  auditMergeReadinessRejected,
  auditMergeReadinessRequested,
  auditMergeReadinessValidated,
} from "./merge-readiness-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  MergeReadinessError,
  validateMergeReadinessForRun,
} from "./validate-merge-readiness-for-run";
import { ENGINEERING_MERGE_READINESS_RESULT_SCHEMA } from "./merge-readiness-types";

export interface RecordMergeReadinessInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision: "ready" | "not_ready" | "blocked";
  notes?: string;
}

export interface RecordMergeReadinessResult {
  runId: string;
  candidateId: string;
  status: "merge_readiness_recorded";
  decision: "ready" | "not_ready" | "blocked";
  mergeReadinessPath: string;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}

export async function recordMergeReadinessForRun(
  input: RecordMergeReadinessInput,
): Promise<RecordMergeReadinessResult> {
  let ctx;
  try {
    ctx = await validateMergeReadinessForRun(input);
    auditMergeReadinessRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.reviewedBy,
      ctx.decision,
    );
    auditMergeReadinessValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      decision: ctx.decision,
      reviewedBy: ctx.reviewedBy,
      reason: ctx.reviewedReason,
      prUrl: ctx.prUrl,
      prNumber: ctx.prNumber,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof MergeReadinessError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditMergeReadinessRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  let prInspectionSummary: unknown = null;
  if (ctx.livePrInspectionAvailable && ctx.prUrl) {
    try {
      const snapshot = await viewGithubPr(ctx.repoPath, ctx.prNumber, ctx.prUrl);
      prInspectionSummary = snapshot;
      if (snapshot.merged) {
        const err = new MergeReadinessError(
          "Pull request is already merged; merge readiness cannot be recorded",
          "PR_ALREADY_MERGED",
        );
        auditMergeReadinessRejected(
          ctx.runId,
          ctx.taskId,
          ctx.candidate.id,
          err.message,
          err.code,
          ctx.reviewedBy,
        );
        throw err;
      }
      if (snapshot.state === "CLOSED" && ctx.decision === "ready") {
        const err = new MergeReadinessError(
          "Pull request is closed; cannot record ready decision",
          "PR_CLOSED",
        );
        auditMergeReadinessRejected(
          ctx.runId,
          ctx.taskId,
          ctx.candidate.id,
          err.message,
          err.code,
          ctx.reviewedBy,
        );
        throw err;
      }
      if (snapshot.headRefName && snapshot.headRefName !== ctx.headBranch) {
        const err = new MergeReadinessError(
          "Live PR head branch does not match governed remote branch",
          "PR_BRANCH_MISMATCH",
        );
        auditMergeReadinessRejected(
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
        snapshot.headRefOid &&
        snapshot.headRefOid.toLowerCase() !== ctx.commitHash.toLowerCase()
      ) {
        const err = new MergeReadinessError(
          "Live PR head commit does not match governed local commit hash",
          "COMMIT_HASH_MISMATCH",
        );
        auditMergeReadinessRejected(
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
      if (error instanceof MergeReadinessError) throw error;
      const message =
        error instanceof MergeControlError
          ? error.message
          : error instanceof Error
            ? error.message
            : "PR inspection failed";
      prInspectionSummary = { skipped: true, reason: message };
    }
  }

  const reviewedAt = new Date().toISOString();
  const mergeReadinessPath = path.join(ctx.artifactDirectory, "merge-readiness-result.json");

  const evidence = {
    schema: ENGINEERING_MERGE_READINESS_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    decision: ctx.decision,
    notes: ctx.notes,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    baseBranch: ctx.baseBranch,
    headBranch: ctx.headBranch,
    commitHash: ctx.commitHash,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    patchApplicationSummary: ctx.patchApplicationSummary,
    remotePushSummary: ctx.remotePushSummary,
    prInspectionSummary,
    reviewedBy: ctx.reviewedBy,
    reviewedReason: ctx.reviewedReason,
    reviewedAt,
    notMerged: true as const,
    notDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(mergeReadinessPath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidateMergeReadinessRecorded({
    candidateId: ctx.candidate.id,
    mergeReadinessDecision: ctx.decision,
    mergeReadinessReviewedAt: reviewedAt,
    mergeReadinessReviewedBy: ctx.reviewedBy,
    mergeReadinessReason: ctx.reviewedReason,
    mergeReadinessEvidencePath: mergeReadinessPath,
  });

  auditMergeReadinessRecorded(ctx.runId, ctx.taskId, ctx.candidate.id, {
    decision: ctx.decision,
    reviewedBy: ctx.reviewedBy,
    reason: ctx.reviewedReason,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeReadinessPath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "merge_readiness_recorded",
    decision: ctx.decision,
    mergeReadinessPath,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}
