import fs from "fs";
import path from "path";
import {
  markCommitCandidateProductionDeployed,
  markCommitCandidateProductionDeploymentFailed,
} from "./commit-candidate-manager";
import {
  auditProductionDeploymentFailed,
  auditProductionDeploymentRejected,
  auditProductionDeploymentRequested,
  auditProductionDeploymentStarted,
  auditProductionDeploymentSucceeded,
  auditProductionDeploymentValidated,
} from "./production-deployment-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  ProductionDeploymentError,
  validateProductionDeploymentForRun,
} from "./validate-production-deployment-for-run";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA } from "./production-deployment-types";
import type { GovernedProductionDeploymentAdapter } from "./production-deployment-types";
import { executeLocalScriptProductionDeployment } from "./local-script-production-deployment-adapter";

export interface ExecuteProductionDeploymentInput {
  runId: string;
  candidateId?: string;
  targetEnvironment?: "production";
  deploymentAdapter?: GovernedProductionDeploymentAdapter;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  customCommand?: string;
  deployCommand?: string;
}

export interface ExecuteProductionDeploymentResult {
  runId: string;
  candidateId: string;
  status: "production_deployed" | "production_deployment_failed";
  targetEnvironment: "production";
  deploymentEvidencePath: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  notComplete: true;
}

function summarizeOutput(text: string, maxLen = 4000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}\n…[truncated]`;
}

export async function executeProductionDeploymentForRun(
  input: ExecuteProductionDeploymentInput,
): Promise<ExecuteProductionDeploymentResult> {
  let ctx;
  try {
    ctx = await validateProductionDeploymentForRun(input);
    auditProductionDeploymentRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.deployedBy,
      ctx.targetEnvironment,
      ctx.deploymentAdapter,
    );
    auditProductionDeploymentValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      targetEnvironment: ctx.targetEnvironment,
      deploymentAdapter: ctx.deploymentAdapter,
      deployedBy: ctx.deployedBy,
      reason: ctx.deployReason,
      mergeCommitSha: ctx.mergeCommitSha,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof ProductionDeploymentError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditProductionDeploymentRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
      input.deploymentAdapter,
    );
    throw error;
  }

  auditProductionDeploymentStarted(ctx.runId, ctx.taskId, ctx.candidate.id, {
    targetEnvironment: ctx.targetEnvironment,
    deploymentAdapter: ctx.deploymentAdapter,
    deployedBy: ctx.deployedBy,
  });

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  let adapterResult;
  if (ctx.deploymentAdapter === "local-production-script") {
    adapterResult = await executeLocalScriptProductionDeployment(
      ctx.repoPath,
      ctx.mergeCommitSha,
    );
  } else {
    throw new ProductionDeploymentError(
      "Unsafe deployment adapter requested",
      "UNSAFE_DEPLOYMENT_ADAPTER",
    );
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const deploymentEvidencePath = path.join(ctx.artifactDirectory, "production-deployment-result.json");

  const evidence = {
    schema: ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    targetEnvironment: ctx.targetEnvironment,
    deploymentAdapter: ctx.deploymentAdapter,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    productionDeploymentPacketPath: ctx.productionDeploymentPacketPath,
    productionDeploymentPlanPath: ctx.productionDeploymentPlanPath,
    productionReadinessEvidencePath: ctx.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    rollbackNotes: ctx.rollbackNotes,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: adapterResult.exitCode,
    stdoutSummary: summarizeOutput(adapterResult.stdout),
    stderrSummary: summarizeOutput(adapterResult.stderr),
    deployedBy: ctx.deployedBy,
    deployReason: ctx.deployReason,
    notComplete: true as const,
  };

  fs.writeFileSync(deploymentEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  const auditDetail = {
    targetEnvironment: ctx.targetEnvironment,
    deploymentAdapter: ctx.deploymentAdapter,
    deployedBy: ctx.deployedBy,
    reason: ctx.deployReason,
    exitCode: adapterResult.exitCode,
    deploymentEvidencePath,
  };

  if (adapterResult.exitCode === 0) {
    markCommitCandidateProductionDeployed({
      candidateId: ctx.candidate.id,
      productionDeploymentAdapter: ctx.deploymentAdapter,
      productionDeploymentStartedAt: startedAt,
      productionDeploymentFinishedAt: finishedAt,
      productionDeploymentExitCode: adapterResult.exitCode,
      productionDeploymentEvidencePath: deploymentEvidencePath,
      productionDeployedBy: ctx.deployedBy,
      productionDeployReason: ctx.deployReason,
    });
    auditProductionDeploymentSucceeded(ctx.runId, ctx.taskId, ctx.candidate.id, auditDetail);
    return {
      runId: ctx.runId,
      candidateId: ctx.candidate.id,
      status: "production_deployed",
      targetEnvironment: ctx.targetEnvironment,
      deploymentEvidencePath,
      startedAt,
      finishedAt,
      exitCode: adapterResult.exitCode,
      notComplete: true,
    };
  }

  markCommitCandidateProductionDeploymentFailed({
    candidateId: ctx.candidate.id,
    productionDeploymentAdapter: ctx.deploymentAdapter,
    productionDeploymentStartedAt: startedAt,
    productionDeploymentFinishedAt: finishedAt,
    productionDeploymentExitCode: adapterResult.exitCode,
    productionDeploymentEvidencePath: deploymentEvidencePath,
    productionDeployedBy: ctx.deployedBy,
    productionDeployReason: ctx.deployReason,
  });
  auditProductionDeploymentFailed(ctx.runId, ctx.taskId, ctx.candidate.id, auditDetail);

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "production_deployment_failed",
    targetEnvironment: ctx.targetEnvironment,
    deploymentEvidencePath,
    startedAt,
    finishedAt,
    exitCode: adapterResult.exitCode,
    notComplete: true,
  };
}
