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
import { ENGINEERING_DEPLOYMENT_PACKET_SCHEMA } from "./deployment-packet-types";
import { ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA } from "./production-readiness-types";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import {
  GOVERNED_PRODUCTION_DEPLOYMENT_PACKET_ENVIRONMENTS,
  DEFAULT_GOVERNED_PRODUCTION_DEPLOYMENT_TARGET_ENVIRONMENT,
  type GovernedProductionDeploymentTargetEnvironment,
} from "./production-deployment-packet-types";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class ProductionDeploymentPacketError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "ProductionDeploymentPacketError";
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

export function validateGovernedProductionDeploymentTargetEnvironment(
  value: string | undefined,
): GovernedProductionDeploymentTargetEnvironment {
  const target = (
    value?.trim() || DEFAULT_GOVERNED_PRODUCTION_DEPLOYMENT_TARGET_ENVIRONMENT
  ).toLowerCase();
  if (
    !GOVERNED_PRODUCTION_DEPLOYMENT_PACKET_ENVIRONMENTS.includes(
      target as GovernedProductionDeploymentTargetEnvironment,
    )
  ) {
    throw new ProductionDeploymentPacketError(
      "Only production is allowed as a governed production deployment packet target in this phase",
      "UNSAFE_TARGET_ENVIRONMENT",
    );
  }
  if (target !== "production") {
    throw new ProductionDeploymentPacketError(
      "Production deployment packet target must be production",
      "UNSAFE_TARGET_ENVIRONMENT",
    );
  }
  return target as GovernedProductionDeploymentTargetEnvironment;
}

export interface ValidatedProductionDeploymentPacketContext {
  runId: string;
  taskId: string;
  taskTitle: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  targetEnvironment: GovernedProductionDeploymentTargetEnvironment;
  deploymentNotes: string;
  rollbackNotes: string;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  mergedAt: string | null;
  mergeMethod: string | null;
  productionReadinessDecision: string;
  productionReadinessEvidencePath: string;
  stagingDeploymentEvidencePath: string;
  stagingDeploymentExitCode: number;
  deploymentPacketPath: string;
  deploymentPlanPath: string;
  qualityGateSummary: unknown;
  signOffSummary: {
    decision: string;
    reviewer: string;
    evidenceSnapshotHash: string;
    createdAt: string;
  };
  mergeSummary: unknown;
  productionReadinessSummary: unknown;
  stagingDeploymentSummary: unknown;
  artifactDirectory: string;
  createdBy: string;
  createdReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
}

export async function validateProductionDeploymentPacketForRun(input: {
  runId: string;
  candidateId?: string;
  targetEnvironment?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  deploymentNotes?: string;
  rollbackNotes?: string;
  deployNow?: boolean;
}): Promise<ValidatedProductionDeploymentPacketContext> {
  if (input.deployNow === true) {
    throw new ProductionDeploymentPacketError(
      "Immediate production deployment is not allowed in this phase",
      "DEPLOY_NOW_FORBIDDEN",
    );
  }

  if (!input.operatorApproval.approved) {
    throw new ProductionDeploymentPacketError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const createdBy = input.operatorApproval.approvedBy?.trim();
  if (!createdBy) {
    throw new ProductionDeploymentPacketError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const createdReason = input.operatorApproval.reason?.trim();
  if (!createdReason) {
    throw new ProductionDeploymentPacketError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const rollbackNotes = input.rollbackNotes?.trim() ?? "";
  if (!rollbackNotes) {
    throw new ProductionDeploymentPacketError(
      "Rollback notes are required for production deployment packet preparation",
      "ROLLBACK_NOTES_REQUIRED",
    );
  }

  const targetEnvironment = validateGovernedProductionDeploymentTargetEnvironment(
    input.targetEnvironment,
  );

  const run = getRunById(input.runId);
  if (!run) {
    throw new ProductionDeploymentPacketError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new ProductionDeploymentPacketError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "deploy_readiness_recorded" ||
    candidate.status === "deployment_packet_prepared" ||
    candidate.status === "staging_deployed" ||
    candidate.status === "production_readiness_recorded" ||
    candidate.status === "production_deployment_packet_prepared";

  if (!isMerged) {
    throw new ProductionDeploymentPacketError(
      "Governed pull request merge is required before production deployment packet preparation",
      "MERGE_REQUIRED",
    );
  }

  const hasProductionReadiness =
    candidate.productionReadinessStatus === "production_readiness_recorded" ||
    candidate.status === "production_readiness_recorded" ||
    candidate.status === "production_deployment_packet_prepared";

  if (!hasProductionReadiness) {
    throw new ProductionDeploymentPacketError(
      "Production readiness must be recorded before production deployment packet preparation",
      "PRODUCTION_READINESS_REQUIRED",
    );
  }

  if (candidate.productionReadinessDecision !== "ready") {
    throw new ProductionDeploymentPacketError(
      "Production readiness decision must be ready",
      "PRODUCTION_READINESS_NOT_READY",
    );
  }

  if (
    !candidate.productionReadinessEvidencePath ||
    !fs.existsSync(candidate.productionReadinessEvidencePath)
  ) {
    throw new ProductionDeploymentPacketError(
      "Production readiness evidence artifact is missing",
      "PRODUCTION_READINESS_EVIDENCE_MISSING",
    );
  }

  const productionReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.productionReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (productionReadinessSummary.schema !== ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA) {
    throw new ProductionDeploymentPacketError(
      "Invalid production readiness evidence schema",
      "INVALID_PRODUCTION_READINESS_EVIDENCE",
    );
  }
  if (productionReadinessSummary.decision !== "ready") {
    throw new ProductionDeploymentPacketError(
      "Production readiness evidence is not ready",
      "PRODUCTION_READINESS_NOT_READY",
    );
  }

  const stagingDeployed =
    candidate.stagingDeploymentStatus === "staging_deployed" ||
    candidate.status === "staging_deployed";

  if (!stagingDeployed) {
    throw new ProductionDeploymentPacketError(
      "Successful staging deployment is required before production deployment packet preparation",
      "STAGING_DEPLOYMENT_REQUIRED",
    );
  }

  if (
    !candidate.stagingDeploymentEvidencePath ||
    !fs.existsSync(candidate.stagingDeploymentEvidencePath)
  ) {
    throw new ProductionDeploymentPacketError(
      "Staging deployment evidence artifact is missing",
      "STAGING_DEPLOYMENT_EVIDENCE_MISSING",
    );
  }

  const stagingDeploymentSummary = JSON.parse(
    fs.readFileSync(candidate.stagingDeploymentEvidencePath, "utf8"),
  ) as { schema?: string; exitCode?: number; targetEnvironment?: string };
  if (stagingDeploymentSummary.schema !== ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA) {
    throw new ProductionDeploymentPacketError(
      "Invalid staging deployment evidence schema",
      "INVALID_STAGING_DEPLOYMENT_EVIDENCE",
    );
  }
  if ((stagingDeploymentSummary.exitCode ?? -1) !== 0) {
    throw new ProductionDeploymentPacketError(
      "Staging deployment must have succeeded before production deployment packet preparation",
      "STAGING_DEPLOYMENT_NOT_SUCCESSFUL",
    );
  }

  if (candidate.deploymentPacketStatus !== "deployment_packet_prepared") {
    throw new ProductionDeploymentPacketError(
      "Governed staging deployment packet must exist before production deployment packet preparation",
      "DEPLOYMENT_PACKET_REQUIRED",
    );
  }

  if (!candidate.deploymentPacketPath || !fs.existsSync(candidate.deploymentPacketPath)) {
    throw new ProductionDeploymentPacketError(
      "Deployment packet evidence artifact is missing",
      "DEPLOYMENT_PACKET_EVIDENCE_MISSING",
    );
  }

  if (!candidate.deploymentPlanPath || !fs.existsSync(candidate.deploymentPlanPath)) {
    throw new ProductionDeploymentPacketError(
      "Deployment plan evidence artifact is missing",
      "DEPLOYMENT_PLAN_EVIDENCE_MISSING",
    );
  }

  const deploymentPacket = JSON.parse(
    fs.readFileSync(candidate.deploymentPacketPath, "utf8"),
  ) as { schema?: string; targetEnvironment?: string };
  if (deploymentPacket.schema !== ENGINEERING_DEPLOYMENT_PACKET_SCHEMA) {
    throw new ProductionDeploymentPacketError(
      "Invalid deployment packet evidence schema",
      "INVALID_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new ProductionDeploymentPacketError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
    mergedAt?: string;
    mergeMethod?: string;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new ProductionDeploymentPacketError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha = candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new ProductionDeploymentPacketError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new ProductionDeploymentPacketError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new ProductionDeploymentPacketError(
      "Latest review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (signoff.id !== candidate.signoffId) {
    throw new ProductionDeploymentPacketError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new ProductionDeploymentPacketError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new ProductionDeploymentPacketError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (
    !qualityGatesCompleted(
      qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number },
    )
  ) {
    throw new ProductionDeploymentPacketError(
      "Quality gates must have completed with evidence",
      "QUALITY_GATES_MISSING",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new ProductionDeploymentPacketError("Task not found", "TASK_NOT_FOUND", 404);
  }

  const artifactDirectory = path.dirname(candidate.productionReadinessEvidencePath);

  return {
    runId: run.id,
    taskId: run.taskId,
    taskTitle: task.title,
    candidate,
    signoff,
    targetEnvironment,
    deploymentNotes: input.deploymentNotes?.trim() ?? "",
    rollbackNotes,
    prUrl: candidate.prUrl,
    prNumber: candidate.prNumber,
    mergeCommitSha,
    mergedAt: candidate.mergedAt ?? mergeSummary.mergedAt ?? null,
    mergeMethod: candidate.mergeMethod ?? mergeSummary.mergeMethod ?? null,
    productionReadinessDecision: candidate.productionReadinessDecision ?? "ready",
    productionReadinessEvidencePath: candidate.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: candidate.stagingDeploymentEvidencePath,
    stagingDeploymentExitCode:
      candidate.stagingDeploymentExitCode ?? stagingDeploymentSummary.exitCode ?? 0,
    deploymentPacketPath: candidate.deploymentPacketPath,
    deploymentPlanPath: candidate.deploymentPlanPath,
    qualityGateSummary,
    signOffSummary: {
      decision: signoff.decision,
      reviewer: signoff.reviewer,
      evidenceSnapshotHash: signoff.evidenceSnapshotHash,
      createdAt: signoff.createdAt,
    },
    mergeSummary,
    productionReadinessSummary,
    stagingDeploymentSummary,
    artifactDirectory,
    createdBy,
    createdReason,
    packet,
  };
}
