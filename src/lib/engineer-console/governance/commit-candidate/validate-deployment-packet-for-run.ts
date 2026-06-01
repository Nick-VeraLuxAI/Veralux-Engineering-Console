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
import {
  GOVERNED_DEPLOYMENT_PACKET_ENVIRONMENTS,
  DEFAULT_GOVERNED_DEPLOYMENT_TARGET_ENVIRONMENT,
  type GovernedDeploymentTargetEnvironment,
} from "./deployment-packet-types";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";

export class DeploymentPacketError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "DeploymentPacketError";
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

export function validateGovernedDeploymentTargetEnvironment(
  value: string | undefined,
): GovernedDeploymentTargetEnvironment {
  const target = (value?.trim() || DEFAULT_GOVERNED_DEPLOYMENT_TARGET_ENVIRONMENT).toLowerCase();
  if (!GOVERNED_DEPLOYMENT_PACKET_ENVIRONMENTS.includes(target as GovernedDeploymentTargetEnvironment)) {
    throw new DeploymentPacketError(
      "Only staging is allowed as a governed deployment packet target in this phase",
      "UNSAFE_TARGET_ENVIRONMENT",
    );
  }
  if (!/^[a-z][a-z0-9-]*$/.test(target)) {
    throw new DeploymentPacketError("Invalid target environment name", "UNSAFE_TARGET_ENVIRONMENT");
  }
  return target as GovernedDeploymentTargetEnvironment;
}

export interface ValidatedDeploymentPacketContext {
  runId: string;
  taskId: string;
  taskTitle: string;
  candidate: CommitCandidateRecord;
  signoff: EngineeringReviewSignoffRecord;
  targetEnvironment: GovernedDeploymentTargetEnvironment;
  deploymentNotes: string;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  mergedAt: string | null;
  mergeMethod: string | null;
  deployReadinessDecision: string;
  deployReadinessEvidencePath: string;
  qualityGateSummary: unknown;
  signOffSummary: {
    decision: string;
    reviewer: string;
    evidenceSnapshotHash: string;
    createdAt: string;
  };
  mergeSummary: unknown;
  deployReadinessSummary: unknown;
  artifactDirectory: string;
  createdBy: string;
  createdReason: string;
  packet: EngineeringCommitPrCandidatePacketV1;
  riskNotes: string[];
}

export async function validateDeploymentPacketForRun(input: {
  runId: string;
  candidateId?: string;
  targetEnvironment?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  deploymentNotes?: string;
}): Promise<ValidatedDeploymentPacketContext> {
  if (!input.operatorApproval.approved) {
    throw new DeploymentPacketError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const createdBy = input.operatorApproval.approvedBy?.trim();
  if (!createdBy) {
    throw new DeploymentPacketError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const createdReason = input.operatorApproval.reason?.trim();
  if (!createdReason) {
    throw new DeploymentPacketError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const targetEnvironment = validateGovernedDeploymentTargetEnvironment(input.targetEnvironment);

  const run = getRunById(input.runId);
  if (!run) {
    throw new DeploymentPacketError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new DeploymentPacketError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  const isMerged =
    candidate.mergeStatus === "pull_request_merged" ||
    candidate.status === "pull_request_merged" ||
    candidate.status === "deploy_readiness_recorded" ||
    candidate.status === "deployment_packet_prepared";

  if (!isMerged) {
    throw new DeploymentPacketError(
      "Governed pull request merge is required before deployment packet preparation",
      "MERGE_REQUIRED",
    );
  }

  const hasDeployReadiness =
    candidate.deployReadinessStatus === "deploy_readiness_recorded" ||
    candidate.status === "deploy_readiness_recorded" ||
    candidate.status === "deployment_packet_prepared";

  if (!hasDeployReadiness) {
    throw new DeploymentPacketError(
      "Deploy readiness must be recorded before deployment packet preparation",
      "DEPLOY_READINESS_REQUIRED",
    );
  }

  if (candidate.deployReadinessDecision !== "ready") {
    throw new DeploymentPacketError(
      "Deploy readiness decision must be ready",
      "DEPLOY_READINESS_NOT_READY",
    );
  }

  if (!candidate.deployReadinessEvidencePath || !fs.existsSync(candidate.deployReadinessEvidencePath)) {
    throw new DeploymentPacketError(
      "Deploy readiness evidence artifact is missing",
      "DEPLOY_READINESS_EVIDENCE_MISSING",
    );
  }

  const deployReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.deployReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (deployReadinessSummary.schema !== ENGINEERING_DEPLOY_READINESS_RESULT_SCHEMA) {
    throw new DeploymentPacketError(
      "Invalid deploy readiness evidence schema",
      "INVALID_DEPLOY_READINESS_EVIDENCE",
    );
  }
  if (deployReadinessSummary.decision !== "ready") {
    throw new DeploymentPacketError(
      "Deploy readiness evidence is not ready",
      "DEPLOY_READINESS_NOT_READY",
    );
  }

  if (!candidate.mergeEvidencePath || !fs.existsSync(candidate.mergeEvidencePath)) {
    throw new DeploymentPacketError("Merge evidence artifact is missing", "MERGE_EVIDENCE_MISSING");
  }

  const mergeSummary = JSON.parse(fs.readFileSync(candidate.mergeEvidencePath, "utf8")) as {
    schema?: string;
    mergeCommitSha?: string | null;
    mergeMethod?: string;
    mergedAt?: string;
    prUrl?: string;
    prNumber?: string;
  };
  if (mergeSummary.schema !== ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA) {
    throw new DeploymentPacketError("Invalid merge evidence schema", "INVALID_MERGE_EVIDENCE");
  }

  const mergeCommitSha = candidate.mergeCommitSha ?? mergeSummary.mergeCommitSha ?? null;
  if (!mergeCommitSha?.trim()) {
    throw new DeploymentPacketError(
      "Merge commit SHA is missing from merge evidence",
      "MERGE_COMMIT_SHA_MISSING",
    );
  }

  if (!candidate.prUrl?.trim() || !candidate.prNumber?.trim()) {
    throw new DeploymentPacketError("PR URL and number are required", "PR_METADATA_MISSING");
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new DeploymentPacketError(
      "Latest review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (signoff.id !== candidate.signoffId) {
    throw new DeploymentPacketError(
      "Commit candidate sign-off does not match latest approved sign-off",
      "SIGNOFF_MISMATCH",
    );
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.status !== "applied") {
    throw new DeploymentPacketError("Hermes patch must remain applied", "PATCH_NOT_APPLIED");
  }

  const commitPacket = JSON.parse(
    fs.readFileSync(candidate.commitPacketPath, "utf8"),
  ) as EngineeringCommitPrCandidatePacketV1;
  if (commitPacket.schema !== ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA) {
    throw new DeploymentPacketError("Invalid commit packet schema", "INVALID_PACKET");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const qualityGateSummary = commitPacket.qualityGateSummary ?? hermes.postApplyQualityGates;
  if (
    !qualityGatesCompleted(
      qualityGateSummary as { status?: string; failedCount?: number; passedCount?: number },
    )
  ) {
    throw new DeploymentPacketError(
      "Quality gates must have completed with evidence",
      "QUALITY_GATES_MISSING",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DeploymentPacketError("Task not found", "TASK_NOT_FOUND", 404);
  }

  const artifactDirectory = path.dirname(candidate.mergeEvidencePath);

  return {
    runId: run.id,
    taskId: run.taskId,
    taskTitle: task.title,
    candidate,
    signoff,
    targetEnvironment,
    deploymentNotes: input.deploymentNotes?.trim() ?? "",
    prUrl: candidate.prUrl,
    prNumber: candidate.prNumber,
    mergeCommitSha,
    mergedAt: candidate.mergedAt ?? mergeSummary.mergedAt ?? null,
    mergeMethod: candidate.mergeMethod ?? mergeSummary.mergeMethod ?? null,
    deployReadinessDecision: candidate.deployReadinessDecision ?? "ready",
    deployReadinessEvidencePath: candidate.deployReadinessEvidencePath,
    qualityGateSummary,
    signOffSummary: {
      decision: signoff.decision,
      reviewer: signoff.reviewer,
      evidenceSnapshotHash: signoff.evidenceSnapshotHash,
      createdAt: signoff.createdAt,
    },
    mergeSummary,
    deployReadinessSummary,
    artifactDirectory,
    createdBy,
    createdReason,
    packet: commitPacket,
    riskNotes: commitPacket.riskNotes ?? [],
  };
}
