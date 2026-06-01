import fs from "fs";
import path from "path";
import {
  gitAddFile,
  gitCommit,
  gitRevParseHead,
  readCurrentBranchFromRepo,
} from "./governed-local-git";
import { markCommitCandidateLocalCommitCreated } from "./commit-candidate-manager";
import {
  auditLocalCommitCreated,
  auditLocalCommitRejected,
  auditLocalCommitRequested,
  auditLocalCommitValidated,
} from "./local-commit-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import { validateLocalCommitForRun, LocalCommitError } from "./validate-local-commit-for-run";
import { ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA } from "./commit-candidate-types";

export interface CreateLocalCommitInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  commitMessageOverride?: string;
}

export interface CreateLocalCommitResult {
  runId: string;
  candidateId: string;
  status: "local_commit_created";
  commitHash: string;
  branchName: string;
  currentBranch: string;
  recommendedBranch: string;
  branchMismatchWarning: string | null;
  changedFiles: string[];
  commitEvidencePath: string;
  notPushed: true;
  notPrCreated: true;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}

export async function createLocalCommitForRun(
  input: CreateLocalCommitInput,
): Promise<CreateLocalCommitResult> {
  let ctx;
  try {
    ctx = await validateLocalCommitForRun(input);
    auditLocalCommitRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.createdBy,
    );
    auditLocalCommitValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      changedFiles: ctx.changedFiles,
      createdBy: ctx.createdBy,
      reason: ctx.createdReason,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof LocalCommitError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditLocalCommitRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  const currentBranch = readCurrentBranchFromRepo(ctx.repoPath);
  const branchMismatchWarning =
    currentBranch !== ctx.recommendedBranch
      ? `Current branch "${currentBranch}" differs from recommended "${ctx.recommendedBranch}". Local commit proceeds on current branch only (no branch switch in Phase 12B).`
      : null;

  const gitLogs: Array<{ command: string; stdout: string; stderr: string; exitCode: number }> = [];

  for (const file of ctx.changedFiles) {
    const addResult = await gitAddFile(ctx.repoPath, file);
    gitLogs.push({
      command: `git add -- ${file}`,
      stdout: addResult.stdout.slice(0, 4000),
      stderr: addResult.stderr.slice(0, 4000),
      exitCode: addResult.exitCode,
    });
    if (addResult.exitCode !== 0) {
      const err = new LocalCommitError(
        addResult.stderr || `git add failed for ${file}`,
        "GIT_ADD_FAILED",
      );
      auditLocalCommitRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        err.message,
        err.code,
        ctx.createdBy,
      );
      throw err;
    }
  }

  const commitResult = await gitCommit(ctx.repoPath, ctx.commitMessage);
  gitLogs.push({
    command: "git commit -m <message>",
    stdout: commitResult.stdout.slice(0, 4000),
    stderr: commitResult.stderr.slice(0, 4000),
    exitCode: commitResult.exitCode,
  });
  if (commitResult.exitCode !== 0) {
    const err = new LocalCommitError(
      commitResult.stderr || "git commit failed",
      "GIT_COMMIT_FAILED",
    );
    auditLocalCommitRejected(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      err.message,
      err.code,
      ctx.createdBy,
    );
    throw err;
  }

  let commitHash: string;
  try {
    commitHash = await gitRevParseHead(ctx.repoPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read commit hash";
    auditLocalCommitRejected(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      message,
      "GIT_REV_PARSE_FAILED",
      ctx.createdBy,
    );
    throw new LocalCommitError(message, "GIT_REV_PARSE_FAILED");
  }

  const createdAt = new Date().toISOString();
  const commitEvidencePath = path.join(ctx.artifactDirectory, "local-commit-result.json");

  const evidence = {
    schema: ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    commitHash,
    commitMessage: ctx.commitMessage,
    changedFiles: ctx.changedFiles,
    repoPath: ctx.repoPath,
    currentBranch,
    recommendedBranch: ctx.recommendedBranch,
    branchMismatchWarning,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    signOffId: ctx.signoff.id,
    qualityGateSummary: ctx.packet.qualityGateSummary,
    patchApplicationSummary: ctx.packet.patchApplicationSummary,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
    createdAt,
    gitCommandSummaries: gitLogs,
    notPushed: true as const,
    notPrCreated: true as const,
    notMerged: true as const,
    notDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(commitEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidateLocalCommitCreated({
    candidateId: ctx.candidate.id,
    localCommitHash: commitHash,
    localCommitCreatedAt: createdAt,
    localCommitCreatedBy: ctx.createdBy,
    localCommitReason: ctx.createdReason,
    localCommitEvidencePath: commitEvidencePath,
  });

  auditLocalCommitCreated(ctx.runId, ctx.taskId, ctx.candidate.id, {
    commitHash,
    changedFiles: ctx.changedFiles,
    createdBy: ctx.createdBy,
    reason: ctx.createdReason,
    commitEvidencePath,
    currentBranch,
    recommendedBranch: ctx.recommendedBranch,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "local_commit_created",
    commitHash,
    branchName: currentBranch,
    currentBranch,
    recommendedBranch: ctx.recommendedBranch,
    branchMismatchWarning,
    changedFiles: ctx.changedFiles,
    commitEvidencePath,
    notPushed: true,
    notPrCreated: true,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}
