import fs from "fs";
import path from "path";
import { markCommitCandidateDeploymentPacketPrepared } from "./commit-candidate-manager";
import {
  auditDeploymentPacketPrepared,
  auditDeploymentPacketRejected,
  auditDeploymentPacketRequested,
  auditDeploymentPacketValidated,
} from "./deployment-packet-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  DeploymentPacketError,
  validateDeploymentPacketForRun,
} from "./validate-deployment-packet-for-run";
import { ENGINEERING_DEPLOYMENT_PACKET_SCHEMA } from "./deployment-packet-types";
import type { GovernedDeploymentTargetEnvironment } from "./deployment-packet-types";

export interface PrepareDeploymentPacketInput {
  runId: string;
  candidateId?: string;
  targetEnvironment?: GovernedDeploymentTargetEnvironment;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  deploymentNotes?: string;
}

export interface PrepareDeploymentPacketResult {
  runId: string;
  candidateId: string;
  status: "deployment_packet_prepared";
  targetEnvironment: GovernedDeploymentTargetEnvironment;
  deploymentPacketPath: string;
  deploymentPlanPath: string;
  notDeployed: true;
  notComplete: true;
}

function buildDeploymentPlanMarkdown(ctx: {
  runId: string;
  taskTitle: string;
  targetEnvironment: string;
  prUrl: string;
  prNumber: string;
  mergeCommitSha: string;
  mergedAt: string | null;
  mergeMethod: string | null;
  deploymentNotes: string;
  createdBy: string;
  createdReason: string;
  deployReadinessEvidencePath: string;
  mergeEvidencePath: string;
  qualityGateSummary: unknown;
  riskNotes: string[];
}): string {
  const lines = [
    "# Governed deployment plan (reference only)",
    "",
    "> **Not deployed.** This is a deployment packet only.",
    "> No deployment commands were executed by Engineering Console.",
    "",
    "## Deployment objective",
    "",
    `Deploy merged changes for run \`${ctx.runId}\` to **${ctx.targetEnvironment}**.`,
    "",
    `- Task: ${ctx.taskTitle}`,
    `- PR: ${ctx.prUrl} (#${ctx.prNumber})`,
    `- Merge commit: \`${ctx.mergeCommitSha}\``,
    ctx.mergedAt ? `- Merged at: ${ctx.mergedAt}` : null,
    ctx.mergeMethod ? `- Merge method: ${ctx.mergeMethod}` : null,
    "",
    "## Target environment",
    "",
    ctx.targetEnvironment,
    "",
    "## Required pre-deploy checks",
    "",
    "- [ ] Deploy readiness recorded as `ready`",
    "- [ ] Engineering review sign-off approved",
    "- [ ] Post-apply quality gates passed",
    "- [ ] Merge evidence verified",
    "- [ ] Staging health checks pass after future deployment (Phase 18+)",
    "",
    "## Deployment commands (reference only — not executed)",
    "",
    "```bash",
    "# Example staging deploy reference — DO NOT RUN from this packet phase",
    "# npm run build",
    "# render deploy --service <staging-service> --commit " + ctx.mergeCommitSha,
    "```",
    "",
    "## Validation checklist",
    "",
    "- [ ] Application starts successfully",
    "- [ ] Smoke tests pass",
    "- [ ] Error rates normal",
    "- [ ] Logs show expected version/commit",
    "",
    "## Rollback checklist",
    "",
    "- [ ] Identify previous known-good deployment",
    "- [ ] Revert or redeploy prior commit on staging",
    "- [ ] Verify health checks after rollback",
    "- [ ] Record rollback evidence in Engineering Console",
    "",
    "## Evidence links",
    "",
    `- Merge evidence: ${ctx.mergeEvidencePath}`,
    `- Deploy readiness evidence: ${ctx.deployReadinessEvidencePath}`,
    "",
    "## Operator",
    "",
    `- Prepared by: ${ctx.createdBy}`,
    `- Reason: ${ctx.createdReason}`,
    ctx.deploymentNotes ? `- Notes: ${ctx.deploymentNotes}` : null,
    "",
    "## Risk notes",
    "",
    ...(ctx.riskNotes.length > 0 ? ctx.riskNotes.map((note) => `- ${note}`) : ["- None recorded"]),
    "",
    "## Quality gate summary",
    "",
    "```json",
    JSON.stringify(ctx.qualityGateSummary, null, 2),
    "```",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export async function prepareDeploymentPacketForRun(
  input: PrepareDeploymentPacketInput,
): Promise<PrepareDeploymentPacketResult> {
  let ctx;
  try {
    ctx = await validateDeploymentPacketForRun(input);
    auditDeploymentPacketRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.createdBy,
      ctx.targetEnvironment,
    );
    auditDeploymentPacketValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      targetEnvironment: ctx.targetEnvironment,
      createdBy: ctx.createdBy,
      reason: ctx.createdReason,
      mergeCommitSha: ctx.mergeCommitSha,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code = error instanceof DeploymentPacketError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditDeploymentPacketRejected(
      input.runId,
      run?.taskId ?? input.runId,
      input.candidateId ?? null,
      reason,
      code,
      input.operatorApproval.approvedBy ?? "operator",
    );
    throw error;
  }

  const createdAt = new Date().toISOString();
  const deploymentPacketPath = path.join(ctx.artifactDirectory, "deployment-packet.json");
  const deploymentPlanPath = path.join(ctx.artifactDirectory, "deployment-plan.md");

  const rollbackConsiderations = [
    "Redeploy previous staging commit if health checks fail",
    "Do not delete governed branches until deployment is verified",
    "Record rollback evidence before closing the run",
  ];

  const evidence = {
    schema: ENGINEERING_DEPLOYMENT_PACKET_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    targetEnvironment: ctx.targetEnvironment,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    mergedAt: ctx.mergedAt,
    deployReadinessDecision: ctx.deployReadinessDecision,
    deployReadinessEvidencePath: ctx.deployReadinessEvidencePath,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    mergeSummary: ctx.mergeSummary,
    riskNotes: ctx.riskNotes,
    rollbackConsiderations,
    operator: ctx.createdBy,
    reason: ctx.createdReason,
    deploymentNotes: ctx.deploymentNotes,
    createdAt,
    notDeployed: true as const,
    notComplete: true as const,
  };

  const planMarkdown = buildDeploymentPlanMarkdown({
    runId: ctx.runId,
    taskTitle: ctx.taskTitle,
    targetEnvironment: ctx.targetEnvironment,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    mergedAt: ctx.mergedAt,
    mergeMethod: ctx.mergeMethod,
    deploymentNotes: ctx.deploymentNotes,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
    deployReadinessEvidencePath: ctx.deployReadinessEvidencePath,
    mergeEvidencePath: ctx.candidate.mergeEvidencePath!,
    qualityGateSummary: ctx.qualityGateSummary,
    riskNotes: ctx.riskNotes,
  });

  fs.writeFileSync(deploymentPacketPath, JSON.stringify(evidence, null, 2), "utf8");
  fs.writeFileSync(deploymentPlanPath, planMarkdown, "utf8");

  markCommitCandidateDeploymentPacketPrepared({
    candidateId: ctx.candidate.id,
    deploymentTargetEnvironment: ctx.targetEnvironment,
    deploymentPacketCreatedAt: createdAt,
    deploymentPacketCreatedBy: ctx.createdBy,
    deploymentPacketReason: ctx.createdReason,
    deploymentPacketPath,
    deploymentPlanPath,
  });

  auditDeploymentPacketPrepared(ctx.runId, ctx.taskId, ctx.candidate.id, {
    targetEnvironment: ctx.targetEnvironment,
    createdBy: ctx.createdBy,
    reason: ctx.createdReason,
    deploymentPacketPath,
    deploymentPlanPath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "deployment_packet_prepared",
    targetEnvironment: ctx.targetEnvironment,
    deploymentPacketPath,
    deploymentPlanPath,
    notDeployed: true,
    notComplete: true,
  };
}
