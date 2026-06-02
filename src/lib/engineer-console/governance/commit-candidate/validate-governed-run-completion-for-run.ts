import fs from "fs";
import path from "path";
import { getRunById } from "../../run-manager/run-manager";
import {
  getCommitCandidateById,
  getLatestCommitCandidateForRun,
} from "./commit-candidate-manager";
import { ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA } from "./completion-readiness-types";
import type { CommitCandidateRecord } from "./commit-candidate-types";
import {
  CompletionReadinessError,
  validateCompletionReadinessForRun,
} from "./validate-completion-readiness-for-run";

export class GovernedRunCompletionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "GovernedRunCompletionError";
    this.code = code;
    this.status = status;
  }
}

function rejectForbiddenCloseoutBypass(input: Record<string, unknown>): void {
  const forbiddenKeys = [
    "deployNow",
    "deploy",
    "redeploy",
    "productionDeploy",
    "stagingDeploy",
    "customCommand",
    "executeCommand",
    "command",
    "shellCommand",
    "skipValidation",
    "bypassCloseout",
    "bypassEvidenceValidation",
    "forceComplete",
  ] as const;
  for (const key of forbiddenKeys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== false) {
      throw new GovernedRunCompletionError(
        `Field "${key}" is not allowed for governed run completion`,
        "FORBIDDEN_OPERATION",
      );
    }
  }
}

function loadCompletionReadinessEvidence(candidate: CommitCandidateRecord): {
  schema: string;
  decision: string;
} {
  if (
    !candidate.completionReadinessEvidencePath ||
    !fs.existsSync(candidate.completionReadinessEvidencePath)
  ) {
    throw new GovernedRunCompletionError(
      "Completion readiness evidence artifact is missing",
      "COMPLETION_READINESS_EVIDENCE_MISSING",
    );
  }
  const evidence = JSON.parse(
    fs.readFileSync(candidate.completionReadinessEvidencePath, "utf8"),
  ) as { schema?: string; decision?: string };
  if (evidence.schema !== ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA) {
    throw new GovernedRunCompletionError(
      "Invalid completion readiness evidence schema",
      "INVALID_COMPLETION_READINESS_EVIDENCE",
    );
  }
  return { schema: evidence.schema, decision: evidence.decision ?? "" };
}

export interface ValidatedGovernedRunCompletionContext {
  runId: string;
  taskId: string;
  candidate: CommitCandidateRecord;
  completedBy: string;
  completedReason: string;
  closeoutNotes: string;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  qualityGateSummary: unknown;
  signOffSummary: {
    decision: string;
    reviewer: string;
    evidenceSnapshotHash: string;
    createdAt: string;
  };
  mergeReadinessSummary: unknown;
  deployReadinessSummary: unknown;
  deploymentPacketSummary: unknown;
  stagingDeploymentSummary: unknown;
  productionReadinessSummary: unknown;
  productionDeploymentPacketSummary: unknown;
  productionDeploymentSummary: unknown;
  completionReadinessSummary: unknown;
  requiredEvidencePaths: string[];
  productionDeploymentEvidencePath: string;
  completionReadinessEvidencePath: string;
  artifactDirectory: string;
}

function loadEvidenceSummary(pathValue: string | null, code: string): unknown {
  if (!pathValue || !fs.existsSync(pathValue)) {
    throw new GovernedRunCompletionError(`Missing required evidence artifact: ${code}`, code);
  }
  return JSON.parse(fs.readFileSync(pathValue, "utf8"));
}

export async function validateGovernedRunCompletionForRun(input: {
  runId: string;
  candidateId?: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  closeoutNotes?: string;
  deployNow?: boolean;
  deploy?: boolean;
  redeploy?: boolean;
  customCommand?: string;
  skipValidation?: boolean;
  bypassCloseout?: boolean;
}): Promise<ValidatedGovernedRunCompletionContext> {
  rejectForbiddenCloseoutBypass(input as Record<string, unknown>);

  if (!input.operatorApproval.approved) {
    throw new GovernedRunCompletionError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const completedBy = input.operatorApproval.approvedBy?.trim();
  if (!completedBy) {
    throw new GovernedRunCompletionError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const completedReason = input.operatorApproval.reason?.trim();
  if (!completedReason) {
    throw new GovernedRunCompletionError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new GovernedRunCompletionError("Run not found", "RUN_NOT_FOUND", 404);
  }
  if (run.status === "completed") {
    throw new GovernedRunCompletionError("Run is already completed", "RUN_ALREADY_COMPLETED");
  }

  const candidate = input.candidateId
    ? getCommitCandidateById(input.candidateId)
    : getLatestCommitCandidateForRun(run.id);
  if (!candidate || candidate.runId !== run.id) {
    throw new GovernedRunCompletionError("Commit candidate not found", "CANDIDATE_NOT_FOUND", 404);
  }

  if (candidate.status === "completed" || candidate.finalCloseoutStatus === "completed") {
    throw new GovernedRunCompletionError(
      "Commit candidate is already completed",
      "CANDIDATE_ALREADY_COMPLETED",
    );
  }

  const completionReadinessRecorded =
    candidate.completionReadinessStatus === "completion_readiness_recorded" ||
    candidate.status === "completion_readiness_recorded";

  if (!completionReadinessRecorded) {
    throw new GovernedRunCompletionError(
      "Completion readiness must be recorded before run completion",
      "COMPLETION_READINESS_REQUIRED",
    );
  }

  if (candidate.completionReadinessDecision !== "ready") {
    throw new GovernedRunCompletionError(
      "Completion readiness decision must be ready",
      "COMPLETION_READINESS_NOT_READY",
    );
  }

  const completionReadinessEvidence = loadCompletionReadinessEvidence(candidate);
  if (completionReadinessEvidence.decision !== "ready") {
    throw new GovernedRunCompletionError(
      "Completion readiness evidence is not ready",
      "COMPLETION_READINESS_NOT_READY",
    );
  }

  let chainContext;
  try {
    chainContext = await validateCompletionReadinessForRun({
      runId: input.runId,
      candidateId: candidate.id,
      operatorApproval: input.operatorApproval,
      decision: "ready",
    });
  } catch (error) {
    if (error instanceof CompletionReadinessError) {
      throw new GovernedRunCompletionError(error.message, error.code, error.status);
    }
    throw error;
  }

  const requiredEvidencePaths = [
    candidate.commitPacketPath,
    candidate.mergeReadinessEvidencePath,
    candidate.mergeEvidencePath,
    candidate.deployReadinessEvidencePath,
    candidate.deploymentPacketPath,
    candidate.stagingDeploymentEvidencePath,
    candidate.productionReadinessEvidencePath,
    candidate.productionDeploymentPacketPath,
    candidate.productionDeploymentEvidencePath,
    candidate.completionReadinessEvidencePath,
  ].filter((value): value is string => Boolean(value?.trim()));

  const mergeReadinessSummary = loadEvidenceSummary(
    candidate.mergeReadinessEvidencePath,
    "MERGE_READINESS_EVIDENCE_MISSING",
  );
  const deployReadinessSummary = loadEvidenceSummary(
    candidate.deployReadinessEvidencePath,
    "DEPLOY_READINESS_EVIDENCE_MISSING",
  );
  const deploymentPacketSummary = loadEvidenceSummary(
    candidate.deploymentPacketPath,
    "DEPLOYMENT_PACKET_EVIDENCE_MISSING",
  );
  const stagingDeploymentSummary = loadEvidenceSummary(
    candidate.stagingDeploymentEvidencePath,
    "STAGING_DEPLOYMENT_EVIDENCE_MISSING",
  );
  const productionReadinessSummary = loadEvidenceSummary(
    candidate.productionReadinessEvidencePath,
    "PRODUCTION_READINESS_EVIDENCE_MISSING",
  );
  const productionDeploymentPacketSummary = loadEvidenceSummary(
    candidate.productionDeploymentPacketPath,
    "PRODUCTION_DEPLOYMENT_PACKET_REQUIRED",
  );
  const productionDeploymentSummary = loadEvidenceSummary(
    candidate.productionDeploymentEvidencePath,
    "PRODUCTION_DEPLOYMENT_EVIDENCE_MISSING",
  );
  const completionReadinessSummary = JSON.parse(
    fs.readFileSync(candidate.completionReadinessEvidencePath!, "utf8"),
  );

  const artifactDirectory = path.dirname(candidate.completionReadinessEvidencePath!);

  return {
    runId: run.id,
    taskId: run.taskId,
    candidate,
    completedBy,
    completedReason,
    closeoutNotes: input.closeoutNotes?.trim() ?? "",
    prUrl: chainContext.prUrl,
    prNumber: chainContext.prNumber,
    mergeCommitSha: chainContext.mergeCommitSha,
    qualityGateSummary: chainContext.qualityGateSummary,
    signOffSummary: chainContext.signOffSummary,
    mergeReadinessSummary,
    deployReadinessSummary,
    deploymentPacketSummary,
    stagingDeploymentSummary,
    productionReadinessSummary,
    productionDeploymentPacketSummary,
    productionDeploymentSummary,
    completionReadinessSummary,
    requiredEvidencePaths,
    productionDeploymentEvidencePath: candidate.productionDeploymentEvidencePath!,
    completionReadinessEvidencePath: candidate.completionReadinessEvidencePath!,
    artifactDirectory,
  };
}
