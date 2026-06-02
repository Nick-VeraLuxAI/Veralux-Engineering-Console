import { NextResponse } from "next/server";
import { listCommitCandidatesForRun } from "@/lib/engineer-console/governance/commit-candidate/commit-candidate-manager";
import { isLocalScriptStagingAdapterAvailable } from "@/lib/engineer-console/governance/commit-candidate/local-script-staging-deployment-adapter";
import { isGovernedGithubPrClientEnabled } from "@/lib/engineer-console/governance/commit-candidate/governed-github-pr";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { getTaskById } from "@/lib/engineer-console/task-manager/task-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const candidates = listCommitCandidatesForRun(runId).map((row) => ({
    id: row.id,
    runId: row.runId,
    status: row.status,
    branchName: row.branchName,
    commitMessage: row.commitMessage,
    changedFiles: JSON.parse(row.changedFilesJson) as string[],
    evidenceSnapshotHash: row.evidenceSnapshotHash,
    commitPacketPath: row.commitPacketPath,
    prDraftPath: row.prDraftPath,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    notCommitted: row.notCommitted,
    localCommitHash: row.localCommitHash,
    localCommitCreatedAt: row.localCommitCreatedAt,
    localCommitCreatedBy: row.localCommitCreatedBy,
    localCommitEvidencePath: row.localCommitEvidencePath,
    remotePushStatus: row.remotePushStatus,
    remoteName: row.remoteName,
    remoteBranchName: row.remoteBranchName,
    remoteRef: row.remoteRef,
    remotePushedAt: row.remotePushedAt,
    remotePushedBy: row.remotePushedBy,
    remotePushEvidencePath: row.remotePushEvidencePath,
    prStatus: row.prStatus,
    prProvider: row.prProvider,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    prBaseBranch: row.prBaseBranch,
    prHeadBranch: row.prHeadBranch,
    prEvidencePath: row.prEvidencePath,
    mergeReadinessStatus: row.mergeReadinessStatus,
    mergeReadinessDecision: row.mergeReadinessDecision,
    mergeReadinessReviewedAt: row.mergeReadinessReviewedAt,
    mergeReadinessReviewedBy: row.mergeReadinessReviewedBy,
    mergeReadinessReason: row.mergeReadinessReason,
    mergeReadinessEvidencePath: row.mergeReadinessEvidencePath,
    mergeStatus: row.mergeStatus,
    mergeMethod: row.mergeMethod,
    mergeCommitSha: row.mergeCommitSha,
    mergedAt: row.mergedAt,
    mergedBy: row.mergedBy,
    mergeEvidencePath: row.mergeEvidencePath,
    deployReadinessStatus: row.deployReadinessStatus,
    deployReadinessDecision: row.deployReadinessDecision,
    deployReadinessReviewedAt: row.deployReadinessReviewedAt,
    deployReadinessReviewedBy: row.deployReadinessReviewedBy,
    deployReadinessReason: row.deployReadinessReason,
    deployReadinessEvidencePath: row.deployReadinessEvidencePath,
    deploymentPacketStatus: row.deploymentPacketStatus,
    deploymentTargetEnvironment: row.deploymentTargetEnvironment,
    deploymentPacketPath: row.deploymentPacketPath,
    deploymentPlanPath: row.deploymentPlanPath,
    deploymentPacketCreatedAt: row.deploymentPacketCreatedAt,
    deploymentPacketCreatedBy: row.deploymentPacketCreatedBy,
    deploymentPacketReason: row.deploymentPacketReason,
    stagingDeploymentStatus: row.stagingDeploymentStatus,
    stagingDeploymentAdapter: row.stagingDeploymentAdapter,
    stagingDeploymentStartedAt: row.stagingDeploymentStartedAt,
    stagingDeploymentFinishedAt: row.stagingDeploymentFinishedAt,
    stagingDeploymentExitCode: row.stagingDeploymentExitCode,
    stagingDeploymentEvidencePath: row.stagingDeploymentEvidencePath,
    stagingDeployedBy: row.stagingDeployedBy,
    stagingDeployReason: row.stagingDeployReason,
    productionReadinessStatus: row.productionReadinessStatus,
    productionReadinessDecision: row.productionReadinessDecision,
    productionReadinessReviewedAt: row.productionReadinessReviewedAt,
    productionReadinessReviewedBy: row.productionReadinessReviewedBy,
    productionReadinessReason: row.productionReadinessReason,
    productionReadinessEvidencePath: row.productionReadinessEvidencePath,
    productionDeploymentPacketStatus: row.productionDeploymentPacketStatus,
    productionDeploymentTargetEnvironment: row.productionDeploymentTargetEnvironment,
    productionDeploymentPacketPath: row.productionDeploymentPacketPath,
    productionDeploymentPlanPath: row.productionDeploymentPlanPath,
    productionDeploymentPacketCreatedAt: row.productionDeploymentPacketCreatedAt,
    productionDeploymentPacketCreatedBy: row.productionDeploymentPacketCreatedBy,
    productionDeploymentPacketReason: row.productionDeploymentPacketReason,
    productionDeploymentRollbackNotes: row.productionDeploymentRollbackNotes,
    notPushed: row.notPushed,
    notMerged: row.notMerged,
    notDeployed: true as const,
    notComplete: true as const,
  }));

  const task = getTaskById(run.taskId);
  const stagingDeployAdapterAvailable = task
    ? isLocalScriptStagingAdapterAvailable(task.targetRepoPath)
    : false;

  return NextResponse.json({
    runId,
    githubPrCreationAvailable: isGovernedGithubPrClientEnabled(),
    stagingDeployAdapterAvailable,
    latest: candidates[0] ?? null,
    history: candidates,
  });
}
