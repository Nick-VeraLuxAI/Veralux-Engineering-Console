import fs from "fs";
import path from "path";
import {
  markCommitCandidateStagingDeployed,
  markCommitCandidateStagingDeploymentFailed,
} from "./commit-candidate-manager";
import {
  auditStagingDeploymentFailed,
  auditStagingDeploymentRejected,
  auditStagingDeploymentRequested,
  auditStagingDeploymentStarted,
  auditStagingDeploymentSucceeded,
  auditStagingDeploymentValidated,
} from "./staging-deployment-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  StagingDeploymentError,
  validateStagingDeploymentForRun,
} from "./validate-staging-deployment-for-run";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import type { GovernedStagingDeploymentAdapter } from "./staging-deployment-types";
import { executeLocalScriptStagingDeployment } from "./local-script-staging-deployment-adapter";

export interface ExecuteStagingDeploymentInput {
  runId: string;
  candidateId?: string;
  targetEnvironment?: "staging";
  deploymentAdapter?: GovernedStagingDeploymentAdapter;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
}

export interface ExecuteStagingDeploymentResult {
  runId: string;
  candidateId: string;
  status: "staging_deployed" | "staging_deployment_failed";
  targetEnvironment: "staging";
  deploymentEvidencePath: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  notProduction: true;
  notComplete: true;
}

function summarizeOutput(text: string, maxLen = 4000): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}\n…[truncated]`;
}

export async function executeStagingDeploymentForRun(
  input: ExecuteStagingDeploymentInput,
): Promise<ExecuteStagingDeploymentResult> {
  let ctx;
  try {
    ctx = await validateStagingDeploymentForRun(input);
    auditStagingDeploymentRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.deployedBy,
      ctx.targetEnvironment,
      ctx.deploymentAdapter,
    );
    auditStagingDeploymentValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      targetEnvironment: ctx.targetEnvironment,
      deploymentAdapter: ctx.deploymentAdapter,
      deployedBy: ctx.deployedBy,
      reason: ctx.deployReason,
      mergeCommitSha: ctx.mergeCommitSha,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof StagingDeploymentError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditStagingDeploymentRejected(
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

  auditStagingDeploymentStarted(ctx.runId, ctx.taskId, ctx.candidate.id, {
    targetEnvironment: ctx.targetEnvironment,
    deploymentAdapter: ctx.deploymentAdapter,
    deployedBy: ctx.deployedBy,
  });

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  let adapterResult;
  if (ctx.deploymentAdapter === "local-script") {
    adapterResult = await executeLocalScriptStagingDeployment(ctx.repoPath, ctx.mergeCommitSha);
  } else {
    throw new StagingDeploymentError("Unsafe deployment adapter requested", "UNSAFE_DEPLOYMENT_ADAPTER");
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const deploymentEvidencePath = path.join(ctx.artifactDirectory, "staging-deployment-result.json");

  const evidence = {
    schema: ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    targetEnvironment: ctx.targetEnvironment,
    deploymentAdapter: ctx.deploymentAdapter,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    deploymentPacketPath: ctx.deploymentPacketPath,
    deploymentPlanPath: ctx.deploymentPlanPath,
    deployReadinessEvidencePath: ctx.deployReadinessEvidencePath,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: adapterResult.exitCode,
    stdoutSummary: summarizeOutput(adapterResult.stdout),
    stderrSummary: summarizeOutput(adapterResult.stderr),
    deployedBy: ctx.deployedBy,
    deployReason: ctx.deployReason,
    notProduction: true as const,
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
    markCommitCandidateStagingDeployed({
      candidateId: ctx.candidate.id,
      stagingDeploymentAdapter: ctx.deploymentAdapter,
      stagingDeploymentStartedAt: startedAt,
      stagingDeploymentFinishedAt: finishedAt,
      stagingDeploymentExitCode: adapterResult.exitCode,
      stagingDeploymentEvidencePath: deploymentEvidencePath,
      stagingDeployedBy: ctx.deployedBy,
      stagingDeployReason: ctx.deployReason,
    });
    auditStagingDeploymentSucceeded(ctx.runId, ctx.taskId, ctx.candidate.id, auditDetail);
    return {
      runId: ctx.runId,
      candidateId: ctx.candidate.id,
      status: "staging_deployed",
      targetEnvironment: ctx.targetEnvironment,
      deploymentEvidencePath,
      startedAt,
      finishedAt,
      exitCode: adapterResult.exitCode,
      notProduction: true,
      notComplete: true,
    };
  }

  markCommitCandidateStagingDeploymentFailed({
    candidateId: ctx.candidate.id,
    stagingDeploymentAdapter: ctx.deploymentAdapter,
    stagingDeploymentStartedAt: startedAt,
    stagingDeploymentFinishedAt: finishedAt,
    stagingDeploymentExitCode: adapterResult.exitCode,
    stagingDeploymentEvidencePath: deploymentEvidencePath,
    stagingDeployedBy: ctx.deployedBy,
    stagingDeployReason: ctx.deployReason,
  });
  auditStagingDeploymentFailed(ctx.runId, ctx.taskId, ctx.candidate.id, auditDetail);

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "staging_deployment_failed",
    targetEnvironment: ctx.targetEnvironment,
    deploymentEvidencePath,
    startedAt,
    finishedAt,
    exitCode: adapterResult.exitCode,
    notProduction: true,
    notComplete: true,
  };
}
