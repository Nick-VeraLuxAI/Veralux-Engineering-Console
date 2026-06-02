import fs from "fs";
import path from "path";
import { updateRun } from "../../run-manager/run-manager";
import { markCommitCandidateGovernedRunCompleted } from "./commit-candidate-manager";
import {
  auditRunCompletedGoverned,
  auditRunCompletionRejected,
  auditRunCompletionRequested,
  auditRunCompletionValidated,
} from "./run-completion-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import { ENGINEERING_FINAL_CLOSEOUT_PACKET_SCHEMA } from "./final-closeout-types";
import {
  GovernedRunCompletionError,
  validateGovernedRunCompletionForRun,
} from "./validate-governed-run-completion-for-run";

export interface CompleteGovernedRunInput {
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
}

export interface CompleteGovernedRunResult {
  runId: string;
  candidateId: string;
  status: "completed";
  closeoutEvidencePath: string;
  completedAt: string;
  completedBy: string;
}

export async function completeGovernedRunForRun(
  input: CompleteGovernedRunInput,
): Promise<CompleteGovernedRunResult> {
  let ctx;
  try {
    ctx = await validateGovernedRunCompletionForRun(input);
    auditRunCompletionRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.completedBy,
    );
    auditRunCompletionValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      completedBy: ctx.completedBy,
      reason: ctx.completedReason,
      productionDeploymentEvidencePath: ctx.productionDeploymentEvidencePath,
      completionReadinessEvidencePath: ctx.completionReadinessEvidencePath,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code =
      error instanceof GovernedRunCompletionError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditRunCompletionRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  const completedAt = new Date().toISOString();
  const closeoutEvidencePath = path.join(ctx.artifactDirectory, "final-closeout-packet.json");

  const closeoutPacket = {
    schema: ENGINEERING_FINAL_CLOSEOUT_PACKET_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    finalStatus: "completed" as const,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    mergeReadinessSummary: ctx.mergeReadinessSummary,
    deployReadinessSummary: ctx.deployReadinessSummary,
    deploymentPacketSummary: ctx.deploymentPacketSummary,
    stagingDeploymentSummary: ctx.stagingDeploymentSummary,
    productionReadinessSummary: ctx.productionReadinessSummary,
    productionDeploymentPacketSummary: ctx.productionDeploymentPacketSummary,
    productionDeploymentSummary: ctx.productionDeploymentSummary,
    completionReadinessSummary: ctx.completionReadinessSummary,
    requiredEvidencePaths: ctx.requiredEvidencePaths,
    closeoutNotes: ctx.closeoutNotes,
    completedBy: ctx.completedBy,
    completedReason: ctx.completedReason,
    completedAt,
  };

  fs.mkdirSync(ctx.artifactDirectory, { recursive: true });
  fs.writeFileSync(closeoutEvidencePath, `${JSON.stringify(closeoutPacket, null, 2)}\n`, "utf8");

  markCommitCandidateGovernedRunCompleted({
    candidateId: ctx.candidate.id,
    finalCloseoutEvidencePath: closeoutEvidencePath,
    finalCloseoutCompletedAt: completedAt,
    finalCloseoutCompletedBy: ctx.completedBy,
    finalCloseoutReason: ctx.completedReason,
    finalCloseoutNotes: ctx.closeoutNotes,
  });

  updateRun(ctx.runId, {
    status: "completed",
    currentStep: "governed_run_completed",
    completedAt,
    agentMessage: "Governed engineering run completed with final closeout evidence.",
  });

  auditRunCompletedGoverned(ctx.runId, ctx.taskId, ctx.candidate.id, {
    completedBy: ctx.completedBy,
    reason: ctx.completedReason,
    closeoutEvidencePath,
    productionDeploymentEvidencePath: ctx.productionDeploymentEvidencePath,
    completionReadinessEvidencePath: ctx.completionReadinessEvidencePath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "completed",
    closeoutEvidencePath,
    completedAt,
    completedBy: ctx.completedBy,
  };
}
