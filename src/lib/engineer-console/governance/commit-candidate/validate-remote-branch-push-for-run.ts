import fs from "fs";
import path from "path";
import { getLatestEngineeringReviewSignoffForRun } from "../engineering-review-signoff/engineering-review-signoff-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { validateRegistrationPath } from "../../repo-intelligence/registered-repos/repo-path-policy";
import { getHermesPatchApplicationForRun } from "../../hermes-worker/hermes-patch-application-manager";
import {
  getCommitCandidateById,
  getLatestCommitCandidateForRun,
} from "./commit-candidate-manager";
import { ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA } from "./commit-candidate-types";
import { validateCommitCandidateBranchName } from "./branch-name";
import {
  gitRemoteList,
  gitRevParseHeadForPush,
  gitStatusPorcelainForPush,
  validateGovernedRemoteName,
} from "./governed-remote-push-git";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class RemoteBranchPushError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "RemoteBranchPushError";
    this.code = code;
    this.status = status;
  }
}

export interface ValidatedRemoteBranchPushContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  commitHash: string;
  remoteName: string;
  branchName: string;
  recommendedBranch: string;
  currentLocalBranch: string;
  evidenceSnapshotHash: string;
  localCommitEvidencePath: string;
  commitPacketPath: string;
  prDraftPath: string;
  artifactDirectory: string;
  pushedBy: string;
  pushedReason: string;
}

export async function validateRemoteBranchPushForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  remoteName?: string;
  branchNameOverride?: string;
}): Promise<ValidatedRemoteBranchPushContext> {
  if (!input.operatorApproval.approved) {
    throw new RemoteBranchPushError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const pushedBy = input.operatorApproval.approvedBy?.trim();
  if (!pushedBy) {
    throw new RemoteBranchPushError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const pushedReason = input.operatorApproval.reason?.trim();
  if (!pushedReason) {
    throw new RemoteBranchPushError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new RemoteBranchPushError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new RemoteBranchPushError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }
  if (candidate.status === "remote_branch_pushed") {
    throw new RemoteBranchPushError(
      "Remote branch already pushed for this candidate",
      "ALREADY_PUSHED",
    );
  }
  if (candidate.status !== "local_commit_created") {
    throw new RemoteBranchPushError(
      "Local commit must exist before remote push",
      "LOCAL_COMMIT_REQUIRED",
    );
  }

  if (!candidate.localCommitHash?.trim()) {
    throw new RemoteBranchPushError("Local commit hash is missing", "LOCAL_COMMIT_HASH_MISSING");
  }
  if (!candidate.localCommitEvidencePath || !fs.existsSync(candidate.localCommitEvidencePath)) {
    throw new RemoteBranchPushError(
      "Local commit evidence artifact is missing",
      "LOCAL_COMMIT_EVIDENCE_MISSING",
    );
  }

  const localEvidence = JSON.parse(
    fs.readFileSync(candidate.localCommitEvidencePath, "utf8"),
  ) as { schema?: string };
  if (localEvidence.schema !== ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA) {
    throw new RemoteBranchPushError("Invalid local commit evidence schema", "INVALID_LOCAL_EVIDENCE");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new RemoteBranchPushError("Latest review sign-off must be approved", "SIGNOFF_NOT_APPROVED");
  }
  if (signoff.id !== candidate.signoffId) {
    throw new RemoteBranchPushError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new RemoteBranchPushError("Hermes patch must be applied", "PATCH_NOT_APPLIED");
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new RemoteBranchPushError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new RemoteBranchPushError(message, "REPO_POLICY_VIOLATION");
  }

  let remoteName: string;
  try {
    remoteName = validateGovernedRemoteName(input.remoteName?.trim() || "origin");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote not allowed";
    throw new RemoteBranchPushError(message, "REMOTE_NOT_ALLOWED");
  }

  let branchName: string;
  const recommendedBranch = candidate.branchName;
  if (input.branchNameOverride?.trim()) {
    branchName = input.branchNameOverride.trim();
    try {
      validateCommitCandidateBranchName(branchName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid branch name";
      throw new RemoteBranchPushError(message, "UNSAFE_BRANCH_NAME");
    }
  } else {
    branchName = recommendedBranch;
    try {
      validateCommitCandidateBranchName(branchName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid recommended branch";
      throw new RemoteBranchPushError(message, "UNSAFE_BRANCH_NAME");
    }
  }

  const remotes = await gitRemoteList(repoPath);
  if (!remotes.includes(remoteName)) {
    throw new RemoteBranchPushError(
      `Remote "${remoteName}" is not configured for this repository`,
      "REMOTE_NOT_CONFIGURED",
    );
  }

  const headHash = await gitRevParseHeadForPush(repoPath);
  const expectedHash = candidate.localCommitHash.trim().toLowerCase();
  if (headHash.toLowerCase() !== expectedHash) {
    throw new RemoteBranchPushError(
      "Current HEAD does not match governed local commit hash",
      "COMMIT_HASH_MISMATCH",
    );
  }

  const porcelain = await gitStatusPorcelainForPush(repoPath);
  if (porcelain.trim().length > 0) {
    throw new RemoteBranchPushError(
      "Working tree must be clean after local commit before remote push",
      "DIRTY_WORKING_TREE",
    );
  }

  const { gitRevParseAbbrevRefHead } = await import("./governed-remote-push-git");
  const currentLocalBranch = await gitRevParseAbbrevRefHead(repoPath);

  const artifactDirectory = path.dirname(candidate.commitPacketPath);

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath,
    candidate,
    signoff,
    commitHash: headHash,
    remoteName,
    branchName,
    recommendedBranch,
    currentLocalBranch,
    evidenceSnapshotHash: candidate.evidenceSnapshotHash,
    localCommitEvidencePath: candidate.localCommitEvidencePath,
    commitPacketPath: candidate.commitPacketPath,
    prDraftPath: candidate.prDraftPath,
    artifactDirectory,
    pushedBy,
    pushedReason,
  };
}
