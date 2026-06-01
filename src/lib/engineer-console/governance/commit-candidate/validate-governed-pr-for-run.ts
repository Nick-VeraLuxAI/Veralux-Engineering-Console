import fs from "fs";
import path from "path";
import { getLatestEngineeringReviewSignoffForRun } from "../engineering-review-signoff/engineering-review-signoff-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { validateRegistrationPath } from "../../repo-intelligence/registered-repos/repo-path-policy";
import { getHermesPatchApplicationForRun } from "../../hermes-worker/hermes-patch-application-manager";
import { ingestHermesWorkerEvidenceForRun } from "../../hermes-worker/hermes-evidence-ingest";
import {
  getCommitCandidateById,
  getLatestCommitCandidateForRun,
} from "./commit-candidate-manager";
import {
  ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA,
  ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA,
  type EngineeringCommitPrCandidatePacketV1,
} from "./commit-candidate-types";
import { validateCommitCandidateBranchName } from "./branch-name";
import { deriveGovernedPrContent } from "./derive-governed-pr-content";
import { resolveGithubOwnerRepo } from "./parse-github-origin";
import {
  GovernedPrContentError,
  validateGovernedPrBaseBranch,
} from "./validate-pr-title-body";
import { isGovernedGithubPrClientEnabled } from "./governed-github-pr";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";
import type { GovernedPrContent } from "./derive-governed-pr-content";

export class GovernedPullRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "GovernedPullRequestError";
    this.code = code;
    this.status = status;
  }
}

export type GovernedPullRequestMode = "create_pr" | "prepare_packet";

function qualityGatesOkFromPacket(packet: EngineeringCommitPrCandidatePacketV1): boolean {
  const summary = packet.qualityGateSummary as {
    status?: string;
    overallStatus?: string;
    failedCount?: number;
    passedCount?: number;
  };
  if (summary.status !== "completed") return false;
  if (summary.overallStatus === "passed") return true;
  return (summary.failedCount ?? 0) === 0 && (summary.passedCount ?? 0) > 0;
}

export interface ValidatedGovernedPullRequestContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  mode: GovernedPullRequestMode;
  baseBranch: string;
  headBranch: string;
  remoteName: string;
  remoteRef: string;
  commitHash: string;
  prContent: GovernedPrContent;
  owner: string | null;
  repo: string | null;
  evidenceSnapshotHash: string;
  commitPacketPath: string;
  prDraftPath: string;
  remotePushEvidencePath: string;
  artifactDirectory: string;
  createdBy: string;
  createdReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
}

export async function validateGovernedPullRequestForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  baseBranch?: string;
  titleOverride?: string;
  bodyOverride?: string;
  mode?: GovernedPullRequestMode;
}): Promise<ValidatedGovernedPullRequestContext> {
  if (!input.operatorApproval.approved) {
    throw new GovernedPullRequestError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const createdBy = input.operatorApproval.approvedBy?.trim();
  if (!createdBy) {
    throw new GovernedPullRequestError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const createdReason = input.operatorApproval.reason?.trim();
  if (!createdReason) {
    throw new GovernedPullRequestError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const mode: GovernedPullRequestMode =
    input.mode === "prepare_packet" ? "prepare_packet" : "create_pr";
  if (mode === "create_pr" && !isGovernedGithubPrClientEnabled()) {
    throw new GovernedPullRequestError(
      "GitHub PR creation is disabled; use prepare_packet mode",
      "GITHUB_PR_DISABLED",
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new GovernedPullRequestError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new GovernedPullRequestError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  if (
    candidate.status === "pull_request_created" ||
    candidate.status === "pull_request_packet_prepared"
  ) {
    throw new GovernedPullRequestError(
      "Pull request already created or prepared for this candidate",
      "ALREADY_CREATED",
    );
  }

  if (candidate.status !== "remote_branch_pushed") {
    throw new GovernedPullRequestError(
      "Remote branch must be pushed before PR creation",
      "REMOTE_PUSH_REQUIRED",
    );
  }

  if (!candidate.localCommitHash?.trim()) {
    throw new GovernedPullRequestError("Local commit hash is missing", "LOCAL_COMMIT_HASH_MISSING");
  }
  if (!candidate.remoteBranchName?.trim() || !candidate.remoteRef?.trim()) {
    throw new GovernedPullRequestError("Remote branch metadata is missing", "REMOTE_BRANCH_MISSING");
  }
  if (!candidate.remotePushEvidencePath || !fs.existsSync(candidate.remotePushEvidencePath)) {
    throw new GovernedPullRequestError(
      "Remote push evidence artifact is missing",
      "REMOTE_PUSH_EVIDENCE_MISSING",
    );
  }

  const remotePushEvidence = JSON.parse(
    fs.readFileSync(candidate.remotePushEvidencePath, "utf8"),
  ) as { schema?: string; commitHash?: string; branchName?: string; remoteName?: string };
  if (remotePushEvidence.schema !== ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA) {
    throw new GovernedPullRequestError("Invalid remote push evidence schema", "INVALID_PUSH_EVIDENCE");
  }
  if (remotePushEvidence.branchName !== candidate.remoteBranchName) {
    throw new GovernedPullRequestError("Remote branch mismatch in push evidence", "REMOTE_BRANCH_MISMATCH");
  }
  if (remotePushEvidence.commitHash?.toLowerCase() !== candidate.localCommitHash.toLowerCase()) {
    throw new GovernedPullRequestError("Commit hash mismatch in push evidence", "COMMIT_HASH_MISMATCH");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new GovernedPullRequestError("Latest review sign-off must be approved", "SIGNOFF_NOT_APPROVED");
  }
  if (signoff.id !== candidate.signoffId) {
    throw new GovernedPullRequestError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new GovernedPullRequestError("Hermes patch must be applied", "PATCH_NOT_APPLIED");
  }

  if (!candidate.prDraftPath || !fs.existsSync(candidate.prDraftPath)) {
    throw new GovernedPullRequestError("PR draft artifact is missing", "PR_DRAFT_MISSING");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new GovernedPullRequestError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const gatesOverride = packet.riskNotes.some((n) => n.includes("Quality gate override"));
  if (!qualityGatesOkFromPacket(packet) && !gatesOverride) {
    const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
    if (hermes.postApplyQualityGates.status !== "completed") {
      throw new GovernedPullRequestError("Quality gates must be run", "QUALITY_GATES_NOT_RUN");
    }
    throw new GovernedPullRequestError(
      "Quality gates must pass or candidate must document override",
      "QUALITY_GATES_FAILED",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new GovernedPullRequestError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new GovernedPullRequestError(message, "REPO_POLICY_VIOLATION");
  }

  const remoteName = candidate.remoteName?.trim() || "origin";
  if (remoteName !== "origin") {
    throw new GovernedPullRequestError('Only remote "origin" is allowed', "REMOTE_NOT_ALLOWED");
  }

  let baseBranch: string;
  try {
    baseBranch = validateGovernedPrBaseBranch(input.baseBranch?.trim() || "main");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid base branch";
    const code = error instanceof GovernedPrContentError ? error.code : "UNSAFE_BASE_BRANCH";
    throw new GovernedPullRequestError(message, code);
  }

  const headBranch = candidate.remoteBranchName;
  try {
    validateCommitCandidateBranchName(headBranch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid head branch";
    throw new GovernedPullRequestError(message, "UNSAFE_HEAD_BRANCH");
  }

  let prContent: GovernedPrContent;
  try {
    prContent = deriveGovernedPrContent({
      runId: run.id,
      taskId: run.taskId,
      commitMessage: candidate.commitMessage,
      prDraftPath: candidate.prDraftPath,
      titleOverride: input.titleOverride,
      bodyOverride: input.bodyOverride,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid PR content";
    const code = error instanceof GovernedPrContentError ? error.code : "INVALID_PR_CONTENT";
    throw new GovernedPullRequestError(message, code);
  }

  const githubRepo = resolveGithubOwnerRepo(repoPath);
  if (mode === "create_pr" && !githubRepo) {
    throw new GovernedPullRequestError(
      "Could not resolve GitHub owner/repo from origin remote",
      "GITHUB_REPO_UNRESOLVED",
    );
  }

  const artifactDirectory = path.dirname(candidate.remotePushEvidencePath);

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath,
    candidate,
    signoff,
    mode,
    baseBranch,
    headBranch,
    remoteName,
    remoteRef: candidate.remoteRef,
    commitHash: candidate.localCommitHash,
    prContent,
    owner: githubRepo?.owner ?? null,
    repo: githubRepo?.repo ?? null,
    evidenceSnapshotHash: candidate.evidenceSnapshotHash,
    commitPacketPath: candidate.commitPacketPath,
    prDraftPath: candidate.prDraftPath,
    remotePushEvidencePath: candidate.remotePushEvidencePath,
    artifactDirectory,
    createdBy,
    createdReason,
    packet,
  };
}
