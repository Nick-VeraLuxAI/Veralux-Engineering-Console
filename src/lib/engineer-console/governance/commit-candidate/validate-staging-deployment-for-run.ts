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
import {
  GOVERNED_STAGING_DEPLOYMENT_ADAPTERS,
  DEFAULT_GOVERNED_STAGING_DEPLOYMENT_ADAPTER,
  type GovernedStagingDeploymentAdapter,
} from "./staging-deployment-types";
import {
  isLocalScriptStagingAdapterAvailable,
} from "./local-script-staging-deployment-adapter";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class StagingDeploymentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "StagingDeploymentError";
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

export function validateGovernedStagingDeploymentAdapter(
  value: string | undefined,
): GovernedStagingDeploymentAdapter {
  const adapter = (value?.trim() || DEFAULT_GOVERNED_STAGING_DEPLOYMENT_ADAPTER).toLowerCase();
  if (!GOVERNED_STAGING_DEPLOYMENT_ADAPTERS.includes(adapter as GovernedStagingDeploymentAdapter)) {
    throw new StagingDeploymentError(
      "Only the local-script staging deployment adapter is allowed in this phase",
      "UNSAFE_DEPLOYMENT_ADAPTER",
    );
  }
  if (adapter !== "local-script") {
    throw new StagingDeploymentError("Unsafe deployment adapter requested", "UNSAFE_DEPLOYMENT_ADAPTER");
  }
  return adapter as GovernedStagingDeploymentAdapter;
}

export function validateGovernedStagingTargetEnvironment(value: string | undefined): "staging" {
  const target = (value?.trim() || "staging").toLowerCase();
  if (target !== "staging") {
    throw new StagingDeploymentError(
      "Only staging is allowed as a governed deployment target in this phase",
      "PRODUCTION_TARGET_FORBIDDEN",
    );
  }
  return "staging";
}

export interface ValidatedStagingDeploymentContext {
  runId: string;
  taskId: string;
  repoPath: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  targetEnvironment: "staging";
  deploymentAdapter: GovernedStagingDeploymentAdapter;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  deployReadinessEvidencePath: string;
  deploymentPacketPath: string;
  deploymentPlanPath: string;
  artifactDirectory: string;
  deployedBy: string;
  deployReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
}

export async function validateStagingDeploymentForRun(input: {
  runId: string;
  candidateId?: string;
  targetEnvironment?: string;
  deploymentAdapter?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
}): Promise<ValidatedStagingDeploymentContext> {
  if (!input.operatorApproval.approved) {
    throw new StagingDeploymentError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const deployedBy = input.operatorApproval.approvedBy?.trim();
  if (!deployedBy) {
    throw new StagingDeploymentError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const deployReason = input.operatorApproval.reason?.trim();
  if (!deployReason) {
    throw new StagingDeploymentError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const targetEnvironment = validateGovernedStagingTargetEnvironment(input.targetEnvironment);
  const deploymentAdapter = validateGovernedStagingDeploymentAdapter(input.deploymentAdapter);

  const run = getRunById(input.runId);
  if (!run) {
    throw new StagingDeploymentError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new StagingDeploymentError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "deploy_readiness_recorded" ||
    candidate.status === "deployment_packet_prepared" ||
    candidate.status === "staging_deployed" ||
    candidate.status === "staging_deployment_failed";

  if (!isMerged) {
    throw new StagingDeploymentError(
      "Governed pull request merge is required before staging deployment",
      "MERGE_REQUIRED",
    );
  }

  if (candidate.deployReadinessDecision !== "ready") {
    throw new StagingDeploymentError(
      "Deploy readiness decision must be ready",
      "DEPLOY_READINESS_NOT_READY",
    );
  }

  const hasDeploymentPacket =
    candidate.deploymentPacketStatus === "deployment_packet_prepared" ||
    candidate.status === "deployment_packet_prepared" ||
    candidate.status === "staging_deployed" ||
    candidate.status === "staging_deployment_failed";

  if (!hasDeploymentPacket) {
    throw new StagingDeploymentError(
      "Governed deployment packet must be prepared before staging deployment",
      "DEPLOYMENT_PACKET_REQUIRED",
    );
  }

  if (candidate.deploymentTargetEnvironment !== "staging") {
    throw new StagingDeploymentError(
      "Deployment packet target environment must be staging",
      "PRODUCTION_TARGET_FORBIDDEN",
    );
  }

  if (!candidate.deploymentPacketPath || !fs.existsSync(candidate.deploymentPacketPath)) {
    throw new StagingDeploymentError(
      "Deployment packet evidence artifact is missing",
      "DEPLOYMENT_PACKET_EVIDENCE_MISSING",
    );
  }

  if (!candidate.deploymentPlanPath || !fs.existsSync(candidate.deploymentPlanPath)) {
    throw new StagingDeploymentError(
      "Deployment plan evidence artifact is missing",
      "DEPLOYMENT_PLAN_EVIDENCE_MISSING",
    );
  }

  const deploymentPacket = JSON.parse(
    fs.readFileSync(candidate.deploymentPacketPath, "utf8"),
  ) as { schema?: string; targetEnvironment?: string; notDeployed?: boolean };
  if (deploymentPacket.schema !== ENGINEERING_DEPLOYMENT_PACKET_SCHEMA) {
    throw new StagingDeploymentError(
      "Invalid deployment packet evidence schema",
      "INVALID_DEPLOYMENT_PACKET_EVIDENCE",
    );
  }
  if (deploymentPacket.targetEnvironment !== "staging") {
    throw new StagingDeploymentError(
      "Deployment packet target is not staging",
      "PRODUCTION_TARGET_FORBIDDEN",
    );
  }

  if (
    !candidate.deployReadinessEvidencePath ||
    !fs.existsSync(candidate.deployReadinessEvidencePath)
  ) {
    throw new StagingDeploymentError(
      "Deploy readiness evidence artifact is missing",
      "DEPLOY_READINESS_EVIDENCE_MISSING",
    );
  }

  const deployReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.deployReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (deployReadinessSummary.schema !== ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA) {
    throw new StagingDeploymentError(
      "Invalid deploy readiness evidence schema",
      "INVALID_DEPLOY_READINESS_EVIDENCE",
    );
  }
  if (deployReadinessSummary.decision !== "ready") {
    throw new StagingDeploymentError(
      "Deploy readiness evidence is not ready",
      "DEPLOY_READINESS_NOT_READY",
    );
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new StagingDeploymentError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new StagingDeploymentError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha = candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new StagingDeploymentError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new StagingDeploymentError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new StagingDeploymentError(
      "Latest review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (signoff.id !== candidate.signoffId) {
    throw new StagingDeploymentError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new StagingDeploymentError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const packet = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (packet.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new StagingDeploymentError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = packet.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (
    !qualityGatesCompleted(
      qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number },
    )
  ) {
    throw new StagingDeploymentError(
      "Quality gates must have completed with evidence",
      "QUALITY_GATES_MISSING",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new StagingDeploymentError("Task not found", "TASK_NOT_FOUND", 404);
  }

  if (deploymentAdapter === "local-script" && !isLocalScriptStagingAdapterAvailable(task.targetRepoPath)) {
    throw new StagingDeploymentError(
      "Staging deploy script is not available at scripts/deploy-staging.sh",
      "ADAPTER_UNAVAILABLE",
    );
  }

  const artifactDirectory = path.dirname(candidate.deploymentPacketPath);

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
    deployReadinessEvidencePath: candidate.deployReadinessEvidencePath,
    deploymentPacketPath: candidate.deploymentPacketPath,
    deploymentPlanPath: candidate.deploymentPlanPath,
    artifactDirectory,
    deployedBy,
    deployReason,
    packet,
  };
}
