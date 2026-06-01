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
import { ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA } from "./governed-pr-merge-types";
import {
  DEPLOY_READINESS_DECISIONS,
  type DeployReadinessDecision,
} from "./deploy-readiness-types";
import { isGovernedGithubPrClientEnabled } from "./governed-github-pr";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class DeployReadinessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "DeployReadinessError";
    this.code = code;
    this.status = status;
  }
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

export interface ValidatedDeployReadinessContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  decision: DeployReadinessDecision;
  notes: string;
  prUrl: string;
  prNumber: string;
  baseBranch: string;
  headBranch: string;
  mergeMethod: string | null;
  mergeCommitSha: string | null;
  mergedAt: string | null;
  qualityGateSummary: unknown;
  signOffSummary: {
    decision: string;
    reviewer: string;
    evidenceSnapshotHash: string;
    createdAt: string;
  };
  mergeSummary: unknown;
  artifactDirectory: string;
  reviewedBy: string;
  reviewedReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
  livePrInspectionAvailable: boolean;
}

export async function validateDeployReadinessForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision?: string;
  notes?: string;
}): Promise<ValidatedDeployReadinessContext> {
  if (!input.operatorApproval.approved) {
    throw new DeployReadinessError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const reviewedBy = input.operatorApproval.approvedBy?.trim();
  if (!reviewedBy) {
    throw new DeployReadinessError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const reviewedReason = input.operatorApproval.reason?.trim();
  if (!reviewedReason) {
    throw new DeployReadinessError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const decision = input.decision?.trim() as DeployReadinessDecision | undefined;
  if (!decision || !DEPLOY_READINESS_DECISIONS.includes(decision)) {
    throw new DeployReadinessError(
      "decision must be ready, not_ready, or blocked",
      "INVALID_DECISION",
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new DeployReadinessError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new DeployReadinessError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "deploy_readiness_recorded";

  if (!isMerged) {
    throw new DeployReadinessError(
      "Governed pull request merge must exist before deploy readiness review",
      "MERGE_REQUIRED",
    );
  }

  if (candidate.prStatus !== "pull_request_created") {
    throw new DeployReadinessError(
      "Live governed pull request is required for deploy readiness",
      "PR_REQUIRED",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new DeployReadinessError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new DeployReadinessError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
    mergeMethod?: string;
    mergedAt?: string;
    baseBranch?: string;
    headBranch?: string;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new DeployReadinessError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha =
    candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new DeployReadinessError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new DeployReadinessError("Latest review sign-off must be approved", "SIGNOFF_NOT_APPROVED");
  }
  if (signoff.id !== candidate.signoffId) {
    throw new DeployReadinessError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new DeployReadinessError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new DeployReadinessError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (!qualityGatesCompleted(qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number })) {
    throw new DeployReadinessError("Quality gates must have completed with evidence", "QUALITY_GATES_MISSING");
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DeployReadinessError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new DeployReadinessError(message, "REPO_POLICY_VIOLATION");
  }

  const baseBranch = candidate.prBaseBranch ?? mergeSummary.baseBranch ?? "main";
  const headBranch = candidate.prHeadBranch ?? mergeSummary.headBranch ?? candidate.remoteBranchName ?? candidate.branchName;
  const artifactDirectory = path.dirname(candidate.mergeEvidencePath);
  const livePrInspectionAvailable =
    isGovernedGithubPrClientEnabled() && Boolean(candidate.prUrl);

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
    mergeMethod: candidate.mergeMethod ?? mergeSummary.mergeMethod ?? null,
    mergeCommitSha,
    mergedAt: candidate.mergedAt ?? mergeSummary.mergedAt ?? null,
    qualityGateSummary,
    signOffSummary: {
      decision: signoff.decision,
      reviewer: signoff.reviewer,
      evidenceSnapshotHash: signoff.evidenceSnapshotHash,
      createdAt: signoff.createdAt,
    },
    mergeSummary,
    artifactDirectory,
    reviewedBy,
    reviewedReason,
    packet,
    livePrInspectionAvailable,
  };
}
