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
  ENGINEERING_PULL_REQUEST_RESULT_SCHEMA,
  ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA,
  type EngineeringCommitPrCandidatePacketV1,
} from "./commit-candidate-types";
import { ENGINEERING_MERGE_READINESS_RESULT_SCHEMA } from "./merge-readiness-types";
import {
  GOVERNED_PR_MERGE_METHODS,
  DEFAULT_GOVERNED_PR_MERGE_METHOD,
  type GovernedPrMergeMethod,
} from "./governed-pr-merge-types";
import { validateGovernedPrBaseBranch } from "./validate-pr-title-body";
import { isGovernedGithubPrClientEnabled } from "./governed-github-pr";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class GovernedPrMergeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "GovernedPrMergeError";
    this.code = code;
    this.status = status;
  }
}

const PR_NUMBER_PATTERN = /^\d+$/;

function qualityGatesCompleted(summary: {
  status?: string;
  overallStatus?: string;
  failedCount?: number;
  passedCount?: number;
}): boolean {
  if (summary.status !== "completed") return false;
  return (summary.passedCount ?? 0) > 0 && (summary.failedCount ?? 0) === 0;
}

export interface ValidatedGovernedPrMergeContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  mergeMethod: GovernedPrMergeMethod;
  prUrl: string;
  prNumber: string;
  baseBranch: string;
  headBranch: string;
  commitHash: string;
  qualityGateSummary: unknown;
  signOffSummary: {
    decision: string;
    reviewer: string;
    evidenceSnapshotHash: string;
    createdAt: string;
  };
  mergeReadinessSummary: unknown;
  patchApplicationSummary: unknown;
  remotePushSummary: unknown;
  artifactDirectory: string;
  mergedBy: string;
  mergedReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
}

export async function validateGovernedPrMergeForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  mergeMethod?: string;
}): Promise<ValidatedGovernedPrMergeContext> {
  if (!isGovernedGithubPrClientEnabled()) {
    throw new GovernedPrMergeError(
      "GitHub PR merge is disabled on this host",
      "GITHUB_MERGE_DISABLED",
    );
  }

  if (!input.operatorApproval.approved) {
    throw new GovernedPrMergeError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const mergedBy = input.operatorApproval.approvedBy?.trim();
  if (!mergedBy) {
    throw new GovernedPrMergeError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const mergedReason = input.operatorApproval.reason?.trim();
  if (!mergedReason) {
    throw new GovernedPrMergeError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const mergeMethodInput = input.mergeMethod?.trim() || DEFAULT_GOVERNED_PR_MERGE_METHOD;
  if (!GOVERNED_PR_MERGE_METHODS.includes(mergeMethodInput as GovernedPrMergeMethod)) {
    throw new GovernedPrMergeError(
      "mergeMethod must be squash, merge, or rebase",
      "INVALID_MERGE_METHOD",
    );
  }
  const mergeMethod = mergeMethodInput as GovernedPrMergeMethod;

  const run = getRunById(input.runId);
  if (!run) {
    throw new GovernedPrMergeError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new GovernedPrMergeError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  if (candidate.status === "pull_request_merged") {
    throw new GovernedPrMergeError("Pull request is already merged", "PR_ALREADY_MERGED");
  }

  if (candidate.status === "pull_request_packet_prepared") {
    throw new GovernedPrMergeError(
      "Packet-only PR mode has no live GitHub PR to merge",
      "PR_PACKET_ONLY",
    );
  }

  if (candidate.status !== "merge_readiness_recorded") {
    throw new GovernedPrMergeError(
      "Merge readiness must be recorded before governed merge",
      "MERGE_READINESS_REQUIRED",
    );
  }

  if (candidate.mergeReadinessDecision !== "ready") {
    throw new GovernedPrMergeError(
      "Merge readiness decision must be ready",
      "MERGE_READINESS_NOT_READY",
    );
  }

  if (!candidate.mergeReadinessEvidencePath || !fs.existsSync(candidate.mergeReadinessEvidencePath)) {
    throw new GovernedPrMergeError("Merge readiness evidence is missing", "MERGE_READINESS_MISSING");
  }

  const mergeReadinessEvidence = JSON.parse(
    fs.readFileSync(candidate.mergeReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (mergeReadinessEvidence.schema !== ENGINEERING_MERGE_READINESS_RESULT_SCHEMA) {
    throw new GovernedPrMergeError("Invalid merge readiness evidence schema", "INVALID_READINESS_EVIDENCE");
  }
  if (mergeReadinessEvidence.decision !== "ready") {
    throw new GovernedPrMergeError("Merge readiness evidence is not ready", "MERGE_READINESS_NOT_READY");
  }

  if (candidate.prStatus !== "pull_request_created" && candidate.status !== "merge_readiness_recorded") {
    throw new GovernedPrMergeError("Governed pull request must exist", "PR_REQUIRED");
  }

  if (!candidate.prUrl?.trim()) {
    throw new GovernedPrMergeError("PR URL is missing", "PR_URL_MISSING");
  }
  if (!candidate.prNumber?.trim()) {
    throw new GovernedPrMergeError("PR number is missing", "PR_NUMBER_MISSING");
  }
  if (!PR_NUMBER_PATTERN.test(candidate.prNumber.trim())) {
    throw new GovernedPrMergeError("PR number is invalid", "INVALID_PR_NUMBER");
  }

  if (!candidate.prEvidencePath || !fs.existsSync(candidate.prEvidencePath)) {
    throw new GovernedPrMergeError("PR evidence artifact is missing", "PR_EVIDENCE_MISSING");
  }

  const prEvidence = JSON.parse(fs.readFileSync(candidate.prEvidencePath, "utf8")) as {
    schema?: string;
    headBranch?: string;
    baseBranch?: string;
    noPullRequestCreated?: boolean;
  };
  if (prEvidence.schema !== ENGINEERING_PULL_REQUEST_RESULT_SCHEMA) {
    throw new GovernedPrMergeError("Invalid PR evidence schema", "INVALID_PR_EVIDENCE");
  }
  if (prEvidence.noPullRequestCreated) {
    throw new GovernedPrMergeError("Packet-only PR cannot be merged", "PR_PACKET_ONLY");
  }

  if (!candidate.localCommitHash?.trim()) {
    throw new GovernedPrMergeError("Local commit hash is missing", "LOCAL_COMMIT_HASH_MISSING");
  }
  if (!candidate.remoteBranchName?.trim() || !candidate.remotePushEvidencePath) {
    throw new GovernedPrMergeError("Remote branch push evidence is missing", "REMOTE_PUSH_MISSING");
  }
  if (!fs.existsSync(candidate.remotePushEvidencePath)) {
    throw new GovernedPrMergeError("Remote push evidence artifact is missing", "REMOTE_PUSH_EVIDENCE_MISSING");
  }

  const remotePushSummary = JSON.parse(
    fs.readFileSync(candidate.remotePushEvidencePath, "utf8"),
  ) as { schema?: string; branchName?: string; commitHash?: string };
  if (remotePushSummary.schema !== ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA) {
    throw new GovernedPrMergeError("Invalid remote push evidence schema", "INVALID_PUSH_EVIDENCE");
  }

  const headBranch = candidate.prHeadBranch ?? candidate.remoteBranchName;
  let baseBranch: string;
  try {
    baseBranch = validateGovernedPrBaseBranch(candidate.prBaseBranch ?? prEvidence.baseBranch ?? "main");
  } catch {
    throw new GovernedPrMergeError("Invalid base branch name", "UNSAFE_BASE_BRANCH");
  }

  if (headBranch !== candidate.remoteBranchName) {
    throw new GovernedPrMergeError("PR head branch does not match remote push branch", "PR_BRANCH_MISMATCH");
  }
  if (prEvidence.headBranch && prEvidence.headBranch !== headBranch) {
    throw new GovernedPrMergeError("PR evidence head branch mismatch", "PR_BRANCH_MISMATCH");
  }
  if (
    remotePushSummary.commitHash &&
    remotePushSummary.commitHash.toLowerCase() !== candidate.localCommitHash.toLowerCase()
  ) {
    throw new GovernedPrMergeError("Remote push commit hash mismatch", "COMMIT_HASH_MISMATCH");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new GovernedPrMergeError("Latest review sign-off must be approved", "SIGNOFF_NOT_APPROVED");
  }
  if (signoff.id !== candidate.signoffId) {
    throw new GovernedPrMergeError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new GovernedPrMergeError("Hermes patch must be applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new GovernedPrMergeError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (!qualityGatesCompleted(qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number })) {
    throw new GovernedPrMergeError("Quality gates must have completed with evidence", "QUALITY_GATES_MISSING");
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new GovernedPrMergeError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new GovernedPrMergeError(message, "REPO_POLICY_VIOLATION");
  }

  const mergeReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.mergeReadinessEvidencePath, "utf8"),
  );

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath,
    candidate,
    signoff,
    mergeMethod,
    prUrl: candidate.prUrl,
    prNumber: candidate.prNumber,
    baseBranch,
    headBranch,
    commitHash: candidate.localCommitHash,
    qualityGateSummary,
    signOffSummary: {
      decision: signoff.decision,
      reviewer: signoff.reviewer,
      evidenceSnapshotHash: signoff.evidenceSnapshotHash,
      createdAt: signoff.createdAt,
    },
    mergeReadinessSummary,
    patchApplicationSummary: JSON.parse(signoff.patchApplicationSummaryJson),
    remotePushSummary,
    artifactDirectory: path.dirname(candidate.prEvidencePath),
    mergedBy,
    mergedReason,
    packet,
  };
}
