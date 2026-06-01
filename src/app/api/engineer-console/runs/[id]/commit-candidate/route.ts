import { NextResponse } from "next/server";
import { listCommitCandidatesForRun } from "@/lib/engineer-console/governance/commit-candidate/commit-candidate-manager";
import { isGovernedGithubPrClientEnabled } from "@/lib/engineer-console/governance/commit-candidate/governed-github-pr";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
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
    notPushed: row.notPushed,
    notMerged: row.notMerged,
    notDeployed: true as const,
    notComplete: true as const,
  }));

  return NextResponse.json({
    runId,
    githubPrCreationAvailable: isGovernedGithubPrClientEnabled(),
    latest: candidates[0] ?? null,
    history: candidates,
  });
}
