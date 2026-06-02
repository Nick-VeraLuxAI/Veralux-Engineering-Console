import fs from "fs";
import path from "path";
import { markCommitCandidateProductionReadinessRecorded } from "./commit-candidate-manager";
import {
  auditProductionReadinessRecorded,
  auditProductionReadinessRejected,
  auditProductionReadinessRequested,
  auditProductionReadinessValidated,
} from "./production-readiness-audit-lifecycle";
import { buildGovernedStagingVerificationSummary } from "./governed-staging-verification";
import { getRunById } from "../../run-manager/run-manager";
import {
  ProductionReadinessError,
  validateProductionReadinessForRun,
} from "./validate-production-readiness-for-run";
import { ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA } from "./production-readiness-types";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import type { ProductionReadinessDecision } from "./production-readiness-types";

export interface RecordProductionReadinessInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision: ProductionReadinessDecision;
  verificationNotes?: string;
}

export interface RecordProductionReadinessResult {
  runId: string;
  candidateId: string;
  status: "production_readiness_recorded";
  decision: ProductionReadinessDecision;
  productionReadinessEvidencePath: string;
  notProductionDeployed: true;
  notComplete: true;
}

export async function recordProductionReadinessForRun(
  input: RecordProductionReadinessInput,
): Promise<RecordProductionReadinessResult> {
  let ctx;
  try {
    ctx = await validateProductionReadinessForRun(input);
    auditProductionReadinessRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.reviewedBy,
      ctx.decision,
    );
    auditProductionReadinessValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      decision: ctx.decision,
      reviewedBy: ctx.reviewedBy,
      reason: ctx.reviewedReason,
      stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof ProductionReadinessError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditProductionReadinessRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  let stagingVerificationSummary;
  try {
    stagingVerificationSummary = await buildGovernedStagingVerificationSummary({
      stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
      deploymentPacketPath: ctx.deploymentPacketPath,
    });
  } catch (error) {
    if (error instanceof ProductionReadinessError) {
      auditProductionReadinessRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        error.message,
        error.code,
        ctx.reviewedBy,
      );
      throw error;
    }
    stagingVerificationSummary = {
      stagingDeploymentEvidence: {
        schema: ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA,
        exitCode: ctx.stagingDeploymentExitCode,
        targetEnvironment: "staging",
        mergeCommitSha: ctx.mergeCommitSha,
      },
      deploymentPacketEvidence: {
        schema: "unknown",
        targetEnvironment: "staging",
        notDeployed: true,
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
  const productionReadinessEvidencePath = path.join(
    ctx.artifactDirectory,
    "production-readiness-result.json",
  );

  const evidence = {
    schema: ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    decision: ctx.decision,
    verificationNotes: ctx.verificationNotes,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    deploymentPacketPath: ctx.deploymentPacketPath,
    deploymentPlanPath: ctx.deploymentPlanPath,
    stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    stagingDeploymentStatus: ctx.stagingDeploymentStatus,
    stagingDeploymentExitCode: ctx.stagingDeploymentExitCode,
    stagingVerificationSummary,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    reviewedBy: ctx.reviewedBy,
    reviewedReason: ctx.reviewedReason,
    reviewedAt,
    notProductionDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(productionReadinessEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidateProductionReadinessRecorded({
    candidateId: ctx.candidate.id,
    productionReadinessDecision: ctx.decision,
    productionReadinessReviewedAt: reviewedAt,
    productionReadinessReviewedBy: ctx.reviewedBy,
    productionReadinessReason: ctx.reviewedReason,
    productionReadinessEvidencePath: productionReadinessEvidencePath,
  });

  auditProductionReadinessRecorded(ctx.runId, ctx.taskId, ctx.candidate.id, {
    decision: ctx.decision,
    reviewedBy: ctx.reviewedBy,
    reason: ctx.reviewedReason,
    stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    productionReadinessEvidencePath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "production_readiness_recorded",
    decision: ctx.decision,
    productionReadinessEvidencePath,
    notProductionDeployed: true,
    notComplete: true,
  };
}
