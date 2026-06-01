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
  type EngineeringCommitPrCandidatePacketV1,
} from "./commit-candidate-types";
import { validateCommitCandidateMessage } from "./validate-commit-message";
import { assertWorkingTreeMatchesCandidate } from "./validate-working-tree-for-candidate";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class LocalCommitError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "LocalCommitError";
    this.code = code;
    this.status = status;
  }
}

function isCandidatePreparedStatus(status: string): boolean {
  return status === "commit_candidate_prepared" || status === "prepared";
}

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

export interface ValidatedLocalCommitContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  commitMessage: string;
  changedFiles: string[];
  evidenceSnapshotHash: string;
  recommendedBranch: string;
  packet: EngineeringCommitPrCandidatePacketV1;
  artifactDirectory: string;
  createdBy: string;
  createdReason: string;
}

export async function validateLocalCommitForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  commitMessageOverride?: string;
}): Promise<ValidatedLocalCommitContext> {
  if (!input.operatorApproval.approved) {
    throw new LocalCommitError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const createdBy = input.operatorApproval.approvedBy?.trim();
  if (!createdBy) {
    throw new LocalCommitError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const createdReason = input.operatorApproval.reason?.trim();
  if (!createdReason) {
    throw new LocalCommitError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new LocalCommitError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new LocalCommitError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }
  if (!isCandidatePreparedStatus(candidate.status)) {
    throw new LocalCommitError(
      candidate.status === "local_commit_created"
        ? "Local commit already created for this candidate"
        : "Commit candidate is not in prepared state",
      candidate.status === "local_commit_created" ? "ALREADY_COMMITTED" : "CANDIDATE_NOT_READY",
    );
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new LocalCommitError("Latest review sign-off must be approved", "SIGNOFF_NOT_APPROVED");
  }
  if (signoff.id !== candidate.signoffId) {
    throw new LocalCommitError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }
  if (candidate.evidenceSnapshotHash !== signoff.evidenceSnapshotHash) {
    throw new LocalCommitError(
      "Commit candidate evidence hash does not match sign-off snapshot",
      "EVIDENCE_HASH_MISMATCH",
    );
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new LocalCommitError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new LocalCommitError("Hermes patch must be applied", "PATCH_NOT_APPLIED");
  }

  const gatesOverride = packet.riskNotes.some((n) => n.includes("Quality gate override"));
  if (!qualityGatesOkFromPacket(packet) && !gatesOverride) {
    const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
    if (hermes.postApplyQualityGates.status !== "completed") {
      throw new LocalCommitError("Quality gates must be run", "QUALITY_GATES_NOT_RUN");
    }
    throw new LocalCommitError("Quality gates must pass or candidate must document override", "QUALITY_GATES_FAILED");
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new LocalCommitError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new LocalCommitError(message, "REPO_POLICY_VIOLATION");
  }

  if (path.resolve(packet.repoPath) !== path.resolve(repoPath)) {
    throw new LocalCommitError("Candidate repo path mismatch", "REPO_MISMATCH");
  }

  const candidateFiles = JSON.parse(candidate.changedFilesJson) as string[];
  const changedFiles = await assertWorkingTreeMatchesCandidate({
    runId: run.id,
    repoPath,
    candidateChangedFiles: candidateFiles,
  });

  let commitMessage: string;
  try {
    commitMessage = validateCommitCandidateMessage(
      input.commitMessageOverride?.trim() || candidate.commitMessage,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid commit message";
    throw new LocalCommitError(message, "INVALID_COMMIT_MESSAGE");
  }

  const artifactDirectory = path.dirname(candidate.commitPacketPath);

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath,
    candidate,
    signoff,
    commitMessage,
    changedFiles,
    evidenceSnapshotHash: candidate.evidenceSnapshotHash,
    recommendedBranch: candidate.branchName,
    packet,
    artifactDirectory,
    createdBy,
    createdReason,
  };
}
