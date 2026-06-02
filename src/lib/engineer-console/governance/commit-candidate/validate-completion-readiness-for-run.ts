import fs from "fs";
import path from "path";
import { getLatestEngineeringReviewSignoffForRun } from "../engineering-review-signoff/engineering-review-signoff-manager";
import { getRunById } from "../../run-manager/run-manager";
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
import { ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA } from "./production-readiness-types";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA } from "./production-deployment-types";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA } from "./production-deployment-packet-types";
import {
  COMPLETION_READINESS_DECISIONS,
  type CompletionReadinessDecision,
} from "./completion-readiness-types";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class CompletionReadinessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "CompletionReadinessError";
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

export interface ValidatedCompletionReadinessContext {
  runId: string;
  taskId: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  decision: CompletionReadinessDecision;
  verificationNotes: string;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  productionDeploymentEvidencePath: string;
  productionDeploymentStatus: string;
  productionDeploymentExitCode: number;
  productionDeploymentPacketPath: string;
  productionReadinessEvidencePath: string;
  stagingDeploymentEvidencePath: string;
  qualityGateSummary: unknown;
  signOffSummary: {
    decision: string;
    reviewer: string;
    evidenceSnapshotHash: string;
    createdAt: string;
  };
  artifactDirectory: string;
  reviewedBy: string;
  reviewedReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
}

export async function validateCompletionReadinessForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision?: string;
  verificationNotes?: string;
  completeRun?: boolean;
  completeNow?: boolean;
}): Promise<ValidatedCompletionReadinessContext> {
  if (input.completeRun === true || input.completeNow === true) {
    throw new CompletionReadinessError(
      "Run completion is not allowed in this phase",
      "RUN_COMPLETION_FORBIDDEN",
    );
  }

  if (!input.operatorApproval.approved) {
    throw new CompletionReadinessError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const reviewedBy = input.operatorApproval.approvedBy?.trim();
  if (!reviewedBy) {
    throw new CompletionReadinessError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const reviewedReason = input.operatorApproval.reason?.trim();
  if (!reviewedReason) {
    throw new CompletionReadinessError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const decision = input.decision?.trim() as CompletionReadinessDecision | undefined;
  if (!decision || !COMPLETION_READINESS_DECISIONS.includes(decision)) {
    throw new CompletionReadinessError(
      "decision must be ready, not_ready, or blocked",
      "INVALID_DECISION",
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new CompletionReadinessError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new CompletionReadinessError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "production_deployed" ||
    candidate.status === "completion_readiness_recorded";

  if (!isMerged) {
    throw new CompletionReadinessError(
      "Governed pull request merge is required before completion readiness",
      "MERGE_REQUIRED",
    );
  }

  if (
    candidate.productionDeploymentStatus === "production_deployment_failed" ||
    candidate.status === "production_deployment_failed"
  ) {
    throw new CompletionReadinessError(
      "Production deployment failed; completion readiness cannot be recorded",
      "PRODUCTION_DEPLOYMENT_FAILED",
    );
  }

  const productionDeployed =
    candidate.productionDeploymentStatus === "production_deployed" ||
    candidate.status === "production_deployed" ||
    candidate.status === "completion_readiness_recorded";

  if (!productionDeployed) {
    throw new CompletionReadinessError(
      "Successful production deployment is required before completion readiness",
      "PRODUCTION_DEPLOYMENT_REQUIRED",
    );
  }

  const exitCode = candidate.productionDeploymentExitCode;
  if (exitCode !== 0) {
    throw new CompletionReadinessError(
      "Production deployment exit code must be 0",
      "PRODUCTION_DEPLOYMENT_FAILED",
    );
  }

  if (
    !candidate.productionDeploymentEvidencePath ||
    !fs.existsSync(candidate.productionDeploymentEvidencePath)
  ) {
    throw new CompletionReadinessError(
      "Production deployment evidence artifact is missing",
      "PRODUCTION_DEPLOYMENT_EVIDENCE_MISSING",
    );
  }

  const productionDeploymentSummary = JSON.parse(
    fs.readFileSync(candidate.productionDeploymentEvidencePath, "utf8"),
  ) as { schema?: string; exitCode?: number; targetEnvironment?: string };
  if (productionDeploymentSummary.schema !== ENGINEERING_PRODUCTION_DEPLOYMENT_RESULT_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid production deployment evidence schema",
      "INVALID_PRODUCTION_DEPLOYMENT_EVIDENCE",
    );
  }
  if ((productionDeploymentSummary.exitCode ?? -1) !== 0) {
    throw new CompletionReadinessError(
      "Production deployment evidence indicates failure",
      "PRODUCTION_DEPLOYMENT_FAILED",
    );
  }

  if (
    !candidate.productionDeploymentPacketPath ||
    !fs.existsSync(candidate.productionDeploymentPacketPath)
  ) {
    throw new CompletionReadinessError(
      "Production deployment packet evidence is missing",
      "PRODUCTION_DEPLOYMENT_PACKET_REQUIRED",
    );
  }

  const productionDeploymentPacket = JSON.parse(
    fs.readFileSync(candidate.productionDeploymentPacketPath, "utf8"),
  ) as { schema?: string; targetEnvironment?: string };
  if (productionDeploymentPacket.schema !== ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid production deployment packet evidence schema",
      "INVALID_PRODUCTION_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }

  if (candidate.productionReadinessDecision !== "ready") {
    throw new CompletionReadinessError(
      "Production readiness decision must be ready",
      "PRODUCTION_READINESS_NOT_READY",
    );
  }

  if (
    !candidate.productionReadinessEvidencePath ||
    !fs.existsSync(candidate.productionReadinessEvidencePath)
  ) {
    throw new CompletionReadinessError(
      "Production readiness evidence artifact is missing",
      "PRODUCTION_READINESS_EVIDENCE_MISSING",
    );
  }

  const productionReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.productionReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (productionReadinessSummary.schema !== ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid production readiness evidence schema",
      "INVALID_PRODUCTION_READINESS_EVIDENCE",
    );
  }
  if (productionReadinessSummary.decision !== "ready") {
    throw new CompletionReadinessError(
      "Production readiness evidence is not ready",
      "PRODUCTION_READINESS_NOT_READY",
    );
  }

  const stagingDeployed = candidate.stagingDeploymentStatus === "staging_deployed";

  if (!stagingDeployed) {
    throw new CompletionReadinessError(
      "Successful staging deployment is required before completion readiness",
      "STAGING_DEPLOYMENT_REQUIRED",
    );
  }

  if (
    !candidate.stagingDeploymentEvidencePath ||
    !fs.existsSync(candidate.stagingDeploymentEvidencePath)
  ) {
    throw new CompletionReadinessError(
      "Staging deployment evidence artifact is missing",
      "STAGING_DEPLOYMENT_EVIDENCE_MISSING",
    );
  }

  const stagingDeploymentSummary = JSON.parse(
    fs.readFileSync(candidate.stagingDeploymentEvidencePath, "utf8"),
  ) as { schema?: string; exitCode?: number };
  if (stagingDeploymentSummary.schema !== ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA) {
    throw new CompletionReadinessError(
      "Invalid staging deployment evidence schema",
      "INVALID_STAGING_DEPLOYMENT_EVIDENCE",
    );
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new CompletionReadinessError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new CompletionReadinessError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha = candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new CompletionReadinessError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new CompletionReadinessError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new CompletionReadinessError(
      "Latest review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (signoff.id !== candidate.signoffId) {
    throw new CompletionReadinessError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new CompletionReadinessError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new CompletionReadinessError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (
    !qualityGatesCompleted(
      qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number },
    )
  ) {
    throw new CompletionReadinessError(
      "Quality gates must have completed with evidence",
      "QUALITY_GATES_MISSING",
    );
  }

  const artifactDirectory = path.dirname(candidate.productionDeploymentEvidencePath);

  return {
    runId: run.id,
    taskId: run.taskId,
    candidate,
    signoff,
    decision,
    verificationNotes: input.verificationNotes?.trim() ?? "",
    prUrl: candidate.prUrl,
    prNumber: candidate.prNumber,
    mergeCommitSha,
    productionDeploymentEvidencePath: candidate.productionDeploymentEvidencePath,
    productionDeploymentStatus: candidate.productionDeploymentStatus ?? "production_deployed",
    productionDeploymentExitCode: exitCode ?? 0,
    productionDeploymentPacketPath: candidate.productionDeploymentPacketPath,
    productionReadinessEvidencePath: candidate.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: candidate.stagingDeploymentEvidencePath,
    qualityGateSummary,
    signOffSummary: {
      decision: signoff.decision,
      reviewer: signoff.reviewer,
      evidenceSnapshotHash: signoff.evidenceSnapshotHash,
      createdAt: signoff.createdAt,
    },
    artifactDirectory,
    reviewedBy,
    reviewedReason,
    packet,
  };
}
