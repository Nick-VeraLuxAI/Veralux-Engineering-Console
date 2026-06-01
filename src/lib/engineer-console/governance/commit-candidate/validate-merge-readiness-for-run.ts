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
import {
  MERGE_READINESS_DECISIONS,
  type MergeReadinessDecision,
} from "./merge-readiness-types";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class MergeReadinessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "MergeReadinessError";
    this.code = code;
    this.status = status;
  }
}

function isPrPreparedStatus(status: string): boolean {
  return status === "pull_request_created" || status === "pull_request_packet_prepared";
}

function qualityGatesCompleted(summary: {
  status?: string;
  overallStatus?: string;
  failedCount?: number;
  passedCount?: number;
}): boolean {
  if (summary.status !== "completed") return false;
  return (summary.passedCount ?? 0) > 0 && (summary.failedCount ?? 0) === 0;
}

export interface ValidatedMergeReadinessContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  decision: MergeReadinessDecision;
  notes: string;
  prUrl: string | null;
  prNumber: string | null;
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
  patchApplicationSummary: unknown;
  remotePushSummary: unknown;
  prEvidencePath: string;
  artifactDirectory: string;
  reviewedBy: string;
  reviewedReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
  livePrInspectionAvailable: boolean;
}

export async function validateMergeReadinessForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision?: string;
  notes?: string;
}): Promise<ValidatedMergeReadinessContext> {
  if (!input.operatorApproval.approved) {
    throw new MergeReadinessError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const reviewedBy = input.operatorApproval.approvedBy?.trim();
  if (!reviewedBy) {
    throw new MergeReadinessError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const reviewedReason = input.operatorApproval.reason?.trim();
  if (!reviewedReason) {
    throw new MergeReadinessError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const decision = input.decision?.trim() as MergeReadinessDecision | undefined;
  if (!decision || !MERGE_READINESS_DECISIONS.includes(decision)) {
    throw new MergeReadinessError(
      "decision must be ready, not_ready, or blocked",
      "INVALID_DECISION",
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new MergeReadinessError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new MergeReadinessError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  if (!isPrPreparedStatus(candidate.status) && candidate.status !== "merge_readiness_recorded") {
    throw new MergeReadinessError(
      "Governed pull request must exist before merge readiness review",
      "PR_REQUIRED",
    );
  }

  if (candidate.status === "pull_request_created" && !candidate.prUrl?.trim()) {
    throw new MergeReadinessError("PR URL is missing for live PR mode", "PR_URL_MISSING");
  }
  if (candidate.status === "pull_request_created" && !candidate.prNumber?.trim()) {
    throw new MergeReadinessError("PR number is missing for live PR mode", "PR_NUMBER_MISSING");
  }

  if (!candidate.prEvidencePath || !fs.existsSync(candidate.prEvidencePath)) {
    throw new MergeReadinessError("PR evidence artifact is missing", "PR_EVIDENCE_MISSING");
  }

  const prEvidence = JSON.parse(fs.readFileSync(candidate.prEvidencePath, "utf8")) as {
    schema?: string;
    headBranch?: string;
    baseBranch?: string;
  };
  if (prEvidence.schema !== ENGINEERING_PULL_REQUEST_RESULT_SCHEMA) {
    throw new MergeReadinessError("Invalid PR evidence schema", "INVALID_PR_EVIDENCE");
  }

  if (!candidate.localCommitHash?.trim()) {
    throw new MergeReadinessError("Local commit hash is missing", "LOCAL_COMMIT_HASH_MISSING");
  }
  if (!candidate.remoteBranchName?.trim() || !candidate.remotePushEvidencePath) {
    throw new MergeReadinessError("Remote branch push evidence is missing", "REMOTE_PUSH_MISSING");
  }
  if (!fs.existsSync(candidate.remotePushEvidencePath)) {
    throw new MergeReadinessError("Remote push evidence artifact is missing", "REMOTE_PUSH_EVIDENCE_MISSING");
  }

  const remotePushSummary = JSON.parse(
    fs.readFileSync(candidate.remotePushEvidencePath, "utf8"),
  ) as { schema?: string; branchName?: string; commitHash?: string };
  if (remotePushSummary.schema !== ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA) {
    throw new MergeReadinessError("Invalid remote push evidence schema", "INVALID_PUSH_EVIDENCE");
  }

  const headBranch = candidate.prHeadBranch ?? candidate.remoteBranchName;
  const baseBranch = candidate.prBaseBranch ?? prEvidence.baseBranch ?? "main";
  if (headBranch !== candidate.remoteBranchName) {
    throw new MergeReadinessError("PR head branch does not match remote push branch", "PR_BRANCH_MISMATCH");
  }
  if (prEvidence.headBranch && prEvidence.headBranch !== headBranch) {
    throw new MergeReadinessError("PR evidence head branch mismatch", "PR_BRANCH_MISMATCH");
  }
  if (
    remotePushSummary.commitHash &&
    remotePushSummary.commitHash.toLowerCase() !== candidate.localCommitHash.toLowerCase()
  ) {
    throw new MergeReadinessError("Remote push commit hash mismatch", "COMMIT_HASH_MISMATCH");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new MergeReadinessError("Latest review sign-off must be approved", "SIGNOFF_NOT_APPROVED");
  }
  if (signoff.id !== candidate.signoffId) {
    throw new MergeReadinessError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new MergeReadinessError("Hermes patch must be applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new MergeReadinessError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (!qualityGatesCompleted(qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number })) {
    throw new MergeReadinessError("Quality gates must have completed with evidence", "QUALITY_GATES_MISSING");
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new MergeReadinessError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new MergeReadinessError(message, "REPO_POLICY_VIOLATION");
  }

  const artifactDirectory = path.dirname(candidate.prEvidencePath);
  const livePrInspectionAvailable =
    candidate.status === "pull_request_created" && Boolean(candidate.prUrl);

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath,
    candidate,
    signoff,
    decision,
    notes: input.notes?.trim() ?? "",
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
    patchApplicationSummary: JSON.parse(signoff.patchApplicationSummaryJson),
    remotePushSummary,
    prEvidencePath: candidate.prEvidencePath,
    artifactDirectory,
    reviewedBy,
    reviewedReason,
    packet,
    livePrInspectionAvailable,
  };
}
