import fs from "fs";
import path from "path";
import { createGovernedGithubPr } from "./governed-github-pr";
import { markCommitCandidatePullRequestCreated } from "./commit-candidate-manager";
import {
  auditPullRequestCreateRejected,
  auditPullRequestCreateRequested,
  auditPullRequestCreateValidated,
  auditPullRequestCreated,
  auditPullRequestPacketPrepared,
} from "./pull-request-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  GovernedPullRequestError,
  validateGovernedPullRequestForRun,
  type GovernedPullRequestMode,
} from "./validate-governed-pr-for-run";
import { ENGINEERING_PULL_REQUEST_RESULT_SCHEMA } from "./commit-candidate-types";
import { PrCreationError } from "../../release/pr-creation/pr-creation-types";

export interface CreateGovernedPullRequestInput {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  baseBranch?: string;
  titleOverride?: string;
  bodyOverride?: string;
  mode?: GovernedPullRequestMode;
}

export interface CreateGovernedPullRequestResult {
  runId: string;
  candidateId: string;
  status: "pull_request_created" | "pull_request_packet_prepared";
  provider: "github";
  remoteBranchName: string;
  baseBranch: string;
  pullRequestUrl: string | null;
  pullRequestNumber: number | null;
  prEvidencePath: string;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}

export async function createGovernedPullRequestForRun(
  input: CreateGovernedPullRequestInput,
): Promise<CreateGovernedPullRequestResult> {
  let ctx;
  try {
    ctx = await validateGovernedPullRequestForRun(input);
    auditPullRequestCreateRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.createdBy,
      ctx.mode,
      ctx.baseBranch,
      ctx.headBranch,
    );
    auditPullRequestCreateValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      mode: ctx.mode,
      baseBranch: ctx.baseBranch,
      headBranch: ctx.headBranch,
      createdBy: ctx.createdBy,
      reason: ctx.createdReason,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof GovernedPullRequestError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditPullRequestCreateRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  let pullRequestUrl: string | null = null;
  let pullRequestNumber: number | null = null;
  let githubApiSummary: unknown = null;
  const status =
    ctx.mode === "create_pr" ? "pull_request_created" : "pull_request_packet_prepared";

  if (ctx.mode === "create_pr") {
    try {
      const pr = await createGovernedGithubPr({
        repoPath: ctx.repoPath,
        title: ctx.prContent.title,
        body: ctx.prContent.body,
        baseBranch: ctx.baseBranch,
        headBranch: ctx.headBranch,
      });
      pullRequestUrl = pr.prUrl;
      pullRequestNumber = pr.prNumber ? Number.parseInt(pr.prNumber, 10) : null;
      githubApiSummary = {
        command: "gh pr create --title … --body … --base … --head …",
        createdNewPr: pr.createdNewPr,
      };
    } catch (error) {
      const message =
        error instanceof PrCreationError
          ? error.message
          : error instanceof Error
            ? error.message
            : "GitHub PR creation failed";
      auditPullRequestCreateRejected(
        ctx.runId,
        ctx.taskId,
        ctx.candidate.id,
        message,
        "GITHUB_PR_CREATE_FAILED",
        ctx.createdBy,
      );
      throw new GovernedPullRequestError(message, "GITHUB_PR_CREATE_FAILED");
    }
  }

  const createdAt = new Date().toISOString();
  const prEvidencePath = path.join(ctx.artifactDirectory, "pull-request-result.json");

  const manualInstructions =
    ctx.mode === "prepare_packet"
      ? `Open GitHub and create a PR: base \`${ctx.baseBranch}\` ← head \`${ctx.headBranch}\`. Title: ${ctx.prContent.title}`
      : null;

  const evidence = {
    schema: ENGINEERING_PULL_REQUEST_RESULT_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    provider: "github" as const,
    owner: ctx.owner,
    repo: ctx.repo,
    baseBranch: ctx.baseBranch,
    headBranch: ctx.headBranch,
    remoteRef: ctx.remoteRef,
    commitHash: ctx.commitHash,
    title: ctx.prContent.title,
    bodySummary: ctx.prContent.bodySummary,
    pullRequestUrl,
    pullRequestNumber,
    mode: ctx.mode,
    noPullRequestCreated: ctx.mode === "prepare_packet",
    manualInstructions,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
    createdAt,
    evidenceSnapshotHash: ctx.evidenceSnapshotHash,
    commitPacketPath: ctx.commitPacketPath,
    prDraftPath: ctx.prDraftPath,
    remotePushEvidencePath: ctx.remotePushEvidencePath,
    githubApiSummary,
    notMerged: true as const,
    notDeployed: true as const,
    notComplete: true as const,
  };

  fs.writeFileSync(prEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

  markCommitCandidatePullRequestCreated({
    candidateId: ctx.candidate.id,
    status,
    prProvider: "github",
    prBaseBranch: ctx.baseBranch,
    prHeadBranch: ctx.headBranch,
    prUrl: pullRequestUrl,
    prNumber: pullRequestNumber !== null ? String(pullRequestNumber) : null,
    prCreatedAt: createdAt,
    prCreatedBy: ctx.createdBy,
    prCreateReason: ctx.createdReason,
    prEvidencePath,
  });

  if (ctx.mode === "create_pr") {
    auditPullRequestCreated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      baseBranch: ctx.baseBranch,
      headBranch: ctx.headBranch,
      prUrl: pullRequestUrl,
      prNumber: pullRequestNumber,
      createdBy: ctx.createdBy,
      reason: ctx.createdReason,
      prEvidencePath,
    });
  } else {
    auditPullRequestPacketPrepared(ctx.runId, ctx.taskId, ctx.candidate.id, {
      baseBranch: ctx.baseBranch,
      headBranch: ctx.headBranch,
      createdBy: ctx.createdBy,
      reason: ctx.createdReason,
      prEvidencePath,
    });
  }

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status,
    provider: "github",
    remoteBranchName: ctx.headBranch,
    baseBranch: ctx.baseBranch,
    pullRequestUrl,
    pullRequestNumber,
    prEvidencePath,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}
