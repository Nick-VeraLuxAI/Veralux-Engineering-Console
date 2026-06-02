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
import { ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA } from "./production-readiness-types";
import { ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA } from "./staging-deployment-types";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA } from "./production-deployment-packet-types";
import {
  GOVERNED_PRODUCTION_DEPLOYMENT_ADAPTERS,
  DEFAULT_GOVERNED_PRODUCTION_DEPLOYMENT_ADAPTER,
  type GovernedProductionDeploymentAdapter,
} from "./production-deployment-types";
import { isLocalScriptProductionAdapterAvailable } from "./local-script-production-deployment-adapter";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class ProductionDeploymentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "ProductionDeploymentError";
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

export function validateGovernedProductionDeploymentAdapter(
  value: string | undefined,
): GovernedProductionDeploymentAdapter {
  const adapter = (
    value?.trim() || DEFAULT_GOVERNED_PRODUCTION_DEPLOYMENT_ADAPTER
  ).toLowerCase();
  if (
    !GOVERNED_PRODUCTION_DEPLOYMENT_ADAPTERS.includes(
      adapter as GovernedProductionDeploymentAdapter,
    )
  ) {
    throw new ProductionDeploymentError(
      "Only the local-production-script adapter is allowed in this phase",
      "UNSAFE_DEPLOYMENT_ADAPTER",
    );
  }
  if (adapter !== "local-production-script") {
    throw new ProductionDeploymentError(
      "Unsafe deployment adapter requested",
      "UNSAFE_DEPLOYMENT_ADAPTER",
    );
  }
  return adapter as GovernedProductionDeploymentAdapter;
}

export function validateGovernedProductionDeploymentTargetEnvironment(
  value: string | undefined,
): "production" {
  const target = (value?.trim() || "production").toLowerCase();
  if (target !== "production") {
    throw new ProductionDeploymentError(
      "Only production is allowed as a governed production deployment target in this phase",
      "NON_PRODUCTION_TARGET_FORBIDDEN",
    );
  }
  return "production";
}

export interface ValidatedProductionDeploymentContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  targetEnvironment: "production";
  deploymentAdapter: GovernedProductionDeploymentAdapter;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  productionDeploymentPacketPath: string;
  productionDeploymentPlanPath: string;
  productionReadinessEvidencePath: string;
  stagingDeploymentEvidencePath: string;
  rollbackNotes: string;
  artifactDirectory: string;
  deployedBy: string;
  deployReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
}

export async function validateProductionDeploymentForRun(input: {
  runId: string;
  candidateId?: string;
  targetEnvironment?: string;
  deploymentAdapter?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  customCommand?: string;
  deployCommand?: string;
}): Promise<ValidatedProductionDeploymentContext> {
  if (input.customCommand?.trim() || input.deployCommand?.trim()) {
    throw new ProductionDeploymentError(
      "Arbitrary deployment commands are not allowed in this phase",
      "ARBITRARY_COMMAND_FORBIDDEN",
    );
  }

  if (!input.operatorApproval.approved) {
    throw new ProductionDeploymentError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const deployedBy = input.operatorApproval.approvedBy?.trim();
  if (!deployedBy) {
    throw new ProductionDeploymentError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const deployReason = input.operatorApproval.reason?.trim();
  if (!deployReason) {
    throw new ProductionDeploymentError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const targetEnvironment = validateGovernedProductionDeploymentTargetEnvironment(
    input.targetEnvironment,
  );
  const deploymentAdapter = validateGovernedProductionDeploymentAdapter(input.deploymentAdapter);

  const run = getRunById(input.runId);
  if (!run) {
    throw new ProductionDeploymentError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new ProductionDeploymentError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "deploy_readiness_recorded" ||
    candidate.status === "deployment_packet_prepared" ||
    candidate.status === "staging_deployed" ||
    candidate.status === "production_readiness_recorded" ||
    candidate.status === "production_deployment_packet_prepared" ||
    candidate.status === "production_deployed" ||
    candidate.status === "production_deployment_failed";

  if (!isMerged) {
    throw new ProductionDeploymentError(
      "Governed pull request merge is required before production deployment",
      "MERGE_REQUIRED",
    );
  }

  const hasProductionDeploymentPacket =
    candidate.productionDeploymentPacketStatus === "production_deployment_packet_prepared" ||
    candidate.status === "production_deployment_packet_prepared" ||
    candidate.status === "production_deployed" ||
    candidate.status === "production_deployment_failed";

  if (!hasProductionDeploymentPacket) {
    throw new ProductionDeploymentError(
      "Governed production deployment packet must be prepared before production deployment",
      "PRODUCTION_DEPLOYMENT_PACKET_REQUIRED",
    );
  }

  if (candidate.productionReadinessDecision !== "ready") {
    throw new ProductionDeploymentError(
      "Production readiness decision must be ready",
      "PRODUCTION_READINESS_NOT_READY",
    );
  }

  if (
    !candidate.productionReadinessEvidencePath ||
    !fs.existsSync(candidate.productionReadinessEvidencePath)
  ) {
    throw new ProductionDeploymentError(
      "Production readiness evidence artifact is missing",
      "PRODUCTION_READINESS_EVIDENCE_MISSING",
    );
  }

  const productionReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.productionReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (productionReadinessSummary.schema !== ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA) {
    throw new ProductionDeploymentError(
      "Invalid production readiness evidence schema",
      "INVALID_PRODUCTION_READINESS_EVIDENCE",
    );
  }
  if (productionReadinessSummary.decision !== "ready") {
    throw new ProductionDeploymentError(
      "Production readiness evidence is not ready",
      "PRODUCTION_READINESS_NOT_READY",
    );
  }

  const stagingDeployed = candidate.stagingDeploymentStatus === "staging_deployed";

  if (!stagingDeployed) {
    throw new ProductionDeploymentError(
      "Successful staging deployment is required before production deployment",
      "STAGING_DEPLOYMENT_REQUIRED",
    );
  }

  if (
    !candidate.stagingDeploymentEvidencePath ||
    !fs.existsSync(candidate.stagingDeploymentEvidencePath)
  ) {
    throw new ProductionDeploymentError(
      "Staging deployment evidence artifact is missing",
      "STAGING_DEPLOYMENT_EVIDENCE_MISSING",
    );
  }

  const stagingDeploymentSummary = JSON.parse(
    fs.readFileSync(candidate.stagingDeploymentEvidencePath, "utf8"),
  ) as { schema?: string; exitCode?: number };
  if (stagingDeploymentSummary.schema !== ENGINEERING_STAGING_DEPLOYMENT_RESULT_SCHEMA) {
    throw new ProductionDeploymentError(
      "Invalid staging deployment evidence schema",
      "INVALID_STAGING_DEPLOYMENT_EVIDENCE",
    );
  }
  if ((stagingDeploymentSummary.exitCode ?? -1) !== 0) {
    throw new ProductionDeploymentError(
      "Staging deployment must have succeeded before production deployment",
      "STAGING_DEPLOYMENT_NOT_SUCCESSFUL",
    );
  }

  const rollbackNotes = candidate.productionDeploymentRollbackNotes?.trim() ?? "";
  if (!rollbackNotes) {
    throw new ProductionDeploymentError(
      "Rollback notes from production deployment packet are required",
      "ROLLBACK_NOTES_REQUIRED",
    );
  }

  if (
    !candidate.productionDeploymentPacketPath ||
    !fs.existsSync(candidate.productionDeploymentPacketPath)
  ) {
    throw new ProductionDeploymentError(
      "Production deployment packet evidence artifact is missing",
      "PRODUCTION_DEPLOYMENT_PACKET_EVIDENCE_MISSING",
    );
  }

  if (
    !candidate.productionDeploymentPlanPath ||
    !fs.existsSync(candidate.productionDeploymentPlanPath)
  ) {
    throw new ProductionDeploymentError(
      "Production deployment plan evidence artifact is missing",
      "PRODUCTION_DEPLOYMENT_PLAN_EVIDENCE_MISSING",
    );
  }

  const productionDeploymentPacket = JSON.parse(
    fs.readFileSync(candidate.productionDeploymentPacketPath, "utf8"),
  ) as { schema?: string; targetEnvironment?: string; rollbackNotes?: string };
  if (productionDeploymentPacket.schema !== ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA) {
    throw new ProductionDeploymentError(
      "Invalid production deployment packet evidence schema",
      "INVALID_PRODUCTION_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }
  if (productionDeploymentPacket.targetEnvironment !== "production") {
    throw new ProductionDeploymentError(
      "Production deployment packet target is not production",
      "NON_PRODUCTION_TARGET_FORBIDDEN",
    );
  }
  if (!productionDeploymentPacket.rollbackNotes?.trim()) {
    throw new ProductionDeploymentError(
      "Production deployment packet rollback notes are missing",
      "ROLLBACK_NOTES_REQUIRED",
    );
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new ProductionDeploymentError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new ProductionDeploymentError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha = candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new ProductionDeploymentError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new ProductionDeploymentError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new ProductionDeploymentError(
      "Latest review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (signoff.id !== candidate.signoffId) {
    throw new ProductionDeploymentError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new ProductionDeploymentError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new ProductionDeploymentError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (
    !qualityGatesCompleted(
      qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number },
    )
  ) {
    throw new ProductionDeploymentError(
      "Quality gates must have completed with evidence",
      "QUALITY_GATES_MISSING",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new ProductionDeploymentError("Task not found", "TASK_NOT_FOUND", 404);
  }

  if (
    deploymentAdapter === "local-production-script" &&
    !isLocalScriptProductionAdapterAvailable(task.targetRepoPath)
  ) {
    throw new ProductionDeploymentError(
      "Production deploy script is not available at scripts/deploy-production.sh",
      "PRODUCTION_ADAPTER_UNAVAILABLE",
    );
  }

  const artifactDirectory = path.dirname(candidate.productionDeploymentPacketPath);

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath: task.targetRepoPath,
    candidate,
    signoff,
    targetEnvironment,
    deploymentAdapter,
    prUrl: candidate.prUrl,
    prNumber: candidate.prNumber,
    mergeCommitSha,
    productionDeploymentPacketPath: candidate.productionDeploymentPacketPath,
    productionDeploymentPlanPath: candidate.productionDeploymentPlanPath,
    productionReadinessEvidencePath: candidate.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: candidate.stagingDeploymentEvidencePath,
    rollbackNotes,
    artifactDirectory,
    deployedBy,
    deployReason,
    packet,
  };
}
