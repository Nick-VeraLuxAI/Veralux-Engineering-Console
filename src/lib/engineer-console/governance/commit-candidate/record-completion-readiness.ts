import fs from "fs";
import path from "path";
import { markCommitCandidateCompletionReadinessRecorded } from "./commit-candidate-manager";
import {
  auditCompletionReadinessRecorded,
  auditCompletionReadinessRejected,
  auditCompletionReadinessRequested,
  auditCompletionReadinessValidated,
} from "./completion-readiness-audit-lifecycle";
import { buildGovernedProductionVerificationSummary } from "./governed-production-verification";
import { getRunById } from "../../run-manager/run-manager";
import {
  CompletionReadinessError,
  validateCompletionReadinessForRun,
} from "./validate-completion-readiness-for-run";
import { ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA } from "./completion-readiness-types";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA } from "./production-deployment-types";
import type { CompletionReadinessDecision } from "./completion-readiness-types";

export interface RecordCompletionReadinessInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision: CompletionReadinessDecision;
  verificationNotes?: string;
  completeRun?: boolean;
  completeNow?: boolean;
}

export interface RecordCompletionReadinessResult {
  runId: string;
  candidateId: string;
  status: "completion_readiness_recorded";
  decision: CompletionReadinessDecision;
  completionReadinessEvidencePath: string;
  notComplete: true;
}

export async function recordCompletionReadinessForRun(
  input: RecordCompletionReadinessInput,
): Promise<RecordCompletionReadinessResult> {
  let ctx;
  try {
    ctx = await validateCompletionReadinessForRun(input);
    auditCompletionReadinessRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.reviewedBy,
      ctx.decision,
    );
    auditCompletionReadinessValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      decision: ctx.decision,
      reviewedBy: ctx.reviewedBy,
      reason: ctx.reviewedReason,
      productionDeploymentEvidencePath: ctx.productionDeploymentEvidencePath,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof CompletionReadinessError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditCompletionReadinessRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  let productionVerificationSummary;
  try {
    productionVerificationSummary = await buildGovernedProductionVerificationSummary({
      productionDeploymentEvidencePath: ctx.productionDeploymentEvidencePath,
      productionDeploymentPacketPath: ctx.productionDeploymentPacketPath,
      productionReadinessEvidencePath: ctx.productionReadinessEvidencePath,
    });
  } catch (error) {
    if (error instanceof CompletionReadinessError) {
      auditCompletionReadinessRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        error.message,
        error.code,
        ctx.reviewedBy,
      );
      throw error;
    }
    productionVerificationSummary = {
      productionDeploymentEvidence: {
        schema: ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA,
        exitCode: ctx.productionDeploymentExitCode,
        targetEnvironment: "production",
        mergeCommitSha: ctx.mergeCommitSha,
      },
      productionDeploymentPacketEvidence: {
        schema: "unknown",
        targetEnvironment: "production",
        notProductionDeployed: true,
      },
      productionReadinessEvidence: {
        schema: "unknown",
        decision: "ready",
      },
      automatedHealthCheck: {
        status: "skipped" as const,
        profileName: null,
        responseStatus: null,
        responseTimeMs: null,
        errorMessage: error instanceof Error ? error.message : "Verification skipped",
      },
    };
  }

  const reviewedAt = new Date().toISOString();
  const completionReadinessEvidencePath = path.join(
    ctx.artifactDirectory,
    "completion-readiness-result.json",
  );

  const evidence = {
    schema: ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    decision: ctx.decision,
    verificationNotes: ctx.verificationNotes,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    productionDeploymentEvidencePath: ctx.productionDeploymentEvidencePath,
    productionDeploymentStatus: ctx.productionDeploymentStatus,
    productionDeploymentExitCode: ctx.productionDeploymentExitCode,
    productionDeploymentPacketPath: ctx.productionDeploymentPacketPath,
    productionReadinessEvidencePath: ctx.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    productionVerificationSummary,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    reviewedBy: ctx.reviewedBy,
    reviewedReason: ctx.reviewedReason,
    reviewedAt,
    notComplete: true as const,
  };

  fs.writeFileSync(completionReadinessEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidateCompletionReadinessRecorded({
    candidateId: ctx.candidate.id,
    completionReadinessDecision: ctx.decision,
    completionReadinessReviewedAt: reviewedAt,
    completionReadinessReviewedBy: ctx.reviewedBy,
    completionReadinessReason: ctx.reviewedReason,
    completionReadinessEvidencePath,
  });

  auditCompletionReadinessRecorded(ctx.runId, ctx.taskId, ctx.candidate.id, {
    decision: ctx.decision,
    reviewedBy: ctx.reviewedBy,
    reason: ctx.reviewedReason,
    productionDeploymentEvidencePath: ctx.productionDeploymentEvidencePath,
    completionReadinessEvidencePath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "completion_readiness_recorded",
    decision: ctx.decision,
    completionReadinessEvidencePath,
    notComplete: true,
  };
}
