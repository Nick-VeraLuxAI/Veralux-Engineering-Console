import fs from "fs";
import path from "path";
import { gitPushHeadToRemoteBranch } from "./governed-remote-push-git";
import { markCommitCandidateRemoteBranchPushed } from "./commit-candidate-manager";
import {
  auditRemoteBranchPushCreated,
  auditRemoteBranchPushRejected,
  auditRemoteBranchPushRequested,
  auditRemoteBranchPushValidated,
} from "./remote-branch-push-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  RemoteBranchPushError,
  validateRemoteBranchPushForRun,
} from "./validate-remote-branch-push-for-run";
import { ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA } from "./commit-candidate-types";

export interface PushRemoteBranchInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  remoteName?: string;
  branchNameOverride?: string;
}

export interface PushRemoteBranchResult {
  runId: string;
  candidateId: string;
  status: "remote_branch_pushed";
  remoteName: string;
  branchName: string;
  commitHash: string;
  remoteRef: string;
  pushEvidencePath: string;
  notPrCreated: true;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}

export async function pushRemoteBranchForRun(
  input: PushRemoteBranchInput,
): Promise<PushRemoteBranchResult> {
  let ctx;
  try {
    ctx = await validateRemoteBranchPushForRun(input);
    auditRemoteBranchPushRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.pushedBy,
      ctx.remoteName,
      ctx.branchName,
    );
    auditRemoteBranchPushValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      commitHash: ctx.commitHash,
      remoteName: ctx.remoteName,
      branchName: ctx.branchName,
      pushedBy: ctx.pushedBy,
      reason: ctx.pushedReason,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof RemoteBranchPushError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditRemoteBranchPushRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  const pushResult = await gitPushHeadToRemoteBranch(
    ctx.repoPath,
    ctx.remoteName,
    ctx.branchName,
  );

  const gitLog = {
    command: `git push ${ctx.remoteName} HEAD:refs/heads/${ctx.branchName}`,
    stdout: pushResult.stdout.slice(0, 4000),
    stderr: pushResult.stderr.slice(0, 4000),
    exitCode: pushResult.exitCode,
  };

  if (pushResult.exitCode !== 0) {
    const err = new RemoteBranchPushError(
      pushResult.stderr || "git push failed",
      "GIT_PUSH_FAILED",
    );
    auditRemoteBranchPushRejected(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      err.message,
      err.code,
      ctx.pushedBy,
    );
    throw err;
  }

  const remoteRef = `${ctx.remoteName}/${ctx.branchName}`;
  const pushedAt = new Date().toISOString();
  const pushEvidencePath = path.join(ctx.artifactDirectory, "remote-branch-push-result.json");

  const evidence = {
    schema: ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    commitHash: ctx.commitHash,
    remoteName: ctx.remoteName,
    branchName: ctx.branchName,
    remoteRef,
    repoPath: ctx.repoPath,
    currentLocalBranch: ctx.currentLocalBranch,
    recommendedBranch: ctx.recommendedBranch,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    localCommitEvidencePath: ctx.localCommitEvidencePath,
    commitPacketPath: ctx.commitPacketPath,
    prDraftPath: ctx.prDraftPath,
    pushedBy: ctx.pushedBy,
    pushedReason: ctx.pushedReason,
    pushedAt,
    gitCommandSummaries: [gitLog],
    notPrCreated: true as const,
    notMerged: true as const,
    notDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(pushEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidateRemoteBranchPushed({
    candidateId: ctx.candidate.id,
    remoteName: ctx.remoteName,
    remoteBranchName: ctx.branchName,
    remoteRef,
    remotePushedAt: pushedAt,
    remotePushedBy: ctx.pushedBy,
    remotePushReason: ctx.pushedReason,
    remotePushEvidencePath: pushEvidencePath,
  });

  auditRemoteBranchPushCreated(ctx.runId, ctx.taskId, ctx.candidate.id, {
    commitHash: ctx.commitHash,
    remoteName: ctx.remoteName,
    branchName: ctx.branchName,
    remoteRef,
    pushedBy: ctx.pushedBy,
    reason: ctx.pushedReason,
    pushEvidencePath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "remote_branch_pushed",
    remoteName: ctx.remoteName,
    branchName: ctx.branchName,
    commitHash: ctx.commitHash,
    remoteRef,
    pushEvidencePath,
    notPrCreated: true,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}
