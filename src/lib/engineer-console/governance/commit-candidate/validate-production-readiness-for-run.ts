import fs from "fs";
import path from "path";
import { getLatestEngineeringReviewSignoffForRun } from "../engineering-review-signoff/engineering-review-signoff-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
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
import { ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA } from "./deploy-readiness-types";
import { ENGINEERING_DEPLOYMENT_PACKET_SCHEMA } from "./deployment-packet-types";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import {
  PRODUCTION_READINESS_DECISIONS,
  type ProductionReadinessDecision,
} from "./production-readiness-types";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class ProductionReadinessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "ProductionReadinessError";
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

export interface ValidatedProductionReadinessContext {
  runId: string;
  taskId: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  decision: ProductionReadinessDecision;
  verificationNotes: string;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  deployReadinessEvidencePath: string;
  deploymentPacketPath: string;
  deploymentPlanPath: string;
  stagingDeploymentEvidencePath: string;
  stagingDeploymentStatus: string;
  stagingDeploymentExitCode: number;
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

export async function validateProductionReadinessForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  decision?: string;
  verificationNotes?: string;
}): Promise<ValidatedProductionReadinessContext> {
  if (!input.operatorApproval.approved) {
    throw new ProductionReadinessError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const reviewedBy = input.operatorApproval.approvedBy?.trim();
  if (!reviewedBy) {
    throw new ProductionReadinessError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const reviewedReason = input.operatorApproval.reason?.trim();
  if (!reviewedReason) {
    throw new ProductionReadinessError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const decision = input.decision?.trim() as ProductionReadinessDecision | undefined;
  if (!decision || !PRODUCTION_READINESS_DECISIONS.includes(decision)) {
    throw new ProductionReadinessError(
      "decision must be ready, not_ready, or blocked",
      "INVALID_DECISION",
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new ProductionReadinessError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new ProductionReadinessError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "deploy_readiness_recorded" ||
    candidate.status === "deployment_packet_prepared" ||
    candidate.status === "staging_deployed" ||
    candidate.status === "staging_deployment_failed" ||
    candidate.status === "production_readiness_recorded";

  if (!isMerged) {
    throw new ProductionReadinessError(
      "Governed pull request merge is required before production readiness review",
      "MERGE_REQUIRED",
    );
  }

  if (candidate.deployReadinessDecision !== "ready") {
    throw new ProductionReadinessError(
      "Deploy readiness decision must be ready",
      "DEPLOY_READINESS_NOT_READY",
    );
  }

  if (
    !candidate.deployReadinessEvidencePath ||
    !fs.existsSync(candidate.deployReadinessEvidencePath)
  ) {
    throw new ProductionReadinessError(
      "Deploy readiness evidence artifact is missing",
      "DEPLOY_READINESS_EVIDENCE_MISSING",
    );
  }

  const deployReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.deployReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (deployReadinessSummary.schema !== ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA) {
    throw new ProductionReadinessError(
      "Invalid deploy readiness evidence schema",
      "INVALID_DEPLOY_READINESS_EVIDENCE",
    );
  }
  if (deployReadinessSummary.decision !== "ready") {
    throw new ProductionReadinessError(
      "Deploy readiness evidence is not ready",
      "DEPLOY_READINESS_NOT_READY",
    );
  }

  const hasDeploymentPacket = candidate.deploymentPacketStatus === "deployment_packet_prepared";

  if (!hasDeploymentPacket) {
    throw new ProductionReadinessError(
      "Governed deployment packet must exist before production readiness review",
      "DEPLOYMENT_PACKET_REQUIRED",
    );
  }

  if (!candidate.deploymentPacketPath || !fs.existsSync(candidate.deploymentPacketPath)) {
    throw new ProductionReadinessError(
      "Deployment packet evidence artifact is missing",
      "DEPLOYMENT_PACKET_EVIDENCE_MISSING",
    );
  }

  if (!candidate.deploymentPlanPath || !fs.existsSync(candidate.deploymentPlanPath)) {
    throw new ProductionReadinessError(
      "Deployment plan evidence artifact is missing",
      "DEPLOYMENT_PLAN_EVIDENCE_MISSING",
    );
  }

  const deploymentPacket = JSON.parse(
    fs.readFileSync(candidate.deploymentPacketPath, "utf8"),
  ) as { schema?: string; targetEnvironment?: string };
  if (deploymentPacket.schema !== ENGINEERING_DEPLOYMENT_PACKET_SCHEMA) {
    throw new ProductionReadinessError(
      "Invalid deployment packet evidence schema",
      "INVALID_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }

  const stagingDeployed =
    candidate.stagingDeploymentStatus === "staging_deployed" ||
    candidate.status === "staging_deployed" ||
    candidate.status === "production_readiness_recorded";

  if (!stagingDeployed) {
    if (
      candidate.stagingDeploymentStatus === "staging_deployment_failed" ||
      candidate.status === "staging_deployment_failed"
    ) {
      throw new ProductionReadinessError(
        "Staging deployment failed; production readiness cannot be recorded",
        "STAGING_DEPLOYMENT_FAILED",
      );
    }
    throw new ProductionReadinessError(
      "Successful staging deployment is required before production readiness review",
      "STAGING_DEPLOYMENT_REQUIRED",
    );
  }

  if (
    !candidate.stagingDeploymentEvidencePath ||
    !fs.existsSync(candidate.stagingDeploymentEvidencePath)
  ) {
    throw new ProductionReadinessError(
      "Staging deployment evidence artifact is missing",
      "STAGING_DEPLOYMENT_EVIDENCE_MISSING",
    );
  }

  const stagingDeploymentEvidence = JSON.parse(
    fs.readFileSync(candidate.stagingDeploymentEvidencePath, "utf8"),
  ) as { schema?: string; exitCode?: number; targetEnvironment?: string };
  if (stagingDeploymentEvidence.schema !== ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA) {
    throw new ProductionReadinessError(
      "Invalid staging deployment evidence schema",
      "INVALID_STAGING_DEPLOYMENT_EVIDENCE",
    );
  }
  if ((stagingDeploymentEvidence.exitCode ?? -1) !== 0) {
    throw new ProductionReadinessError(
      "Staging deployment evidence indicates a failed deployment",
      "STAGING_DEPLOYMENT_FAILED",
    );
  }
  if (stagingDeploymentEvidence.targetEnvironment !== "staging") {
    throw new ProductionReadinessError(
      "Staging deployment evidence target is not staging",
      "PRODUCTION_DEPLOY_FORBIDDEN",
    );
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new ProductionReadinessError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new ProductionReadinessError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha = candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new ProductionReadinessError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new ProductionReadinessError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new ProductionReadinessError(
      "Latest review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (signoff.id !== candidate.signoffId) {
    throw new ProductionReadinessError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new ProductionReadinessError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new ProductionReadinessError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (
    !qualityGatesCompleted(
      qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number },
    )
  ) {
    throw new ProductionReadinessError(
      "Quality gates must have completed with evidence",
      "QUALITY_GATES_MISSING",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new ProductionReadinessError("Task not found", "TASK_NOT_FOUND", 404);
  }

  const artifactDirectory = path.dirname(candidate.stagingDeploymentEvidencePath);

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
    deployReadinessEvidencePath: candidate.deployReadinessEvidencePath,
    deploymentPacketPath: candidate.deploymentPacketPath,
    deploymentPlanPath: candidate.deploymentPlanPath,
    stagingDeploymentEvidencePath: candidate.stagingDeploymentEvidencePath,
    stagingDeploymentStatus: candidate.stagingDeploymentStatus ?? "staging_deployed",
    stagingDeploymentExitCode:
      candidate.stagingDeploymentExitCode ?? stagingDeploymentEvidence.exitCode ?? 0,
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
