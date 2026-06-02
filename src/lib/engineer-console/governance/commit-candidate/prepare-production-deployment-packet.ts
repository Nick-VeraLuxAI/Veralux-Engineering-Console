import fs from "fs";
import path from "path";
import { markCommitCandidateProductionDeploymentPacketPrepared } from "./commit-candidate-manager";
import {
  auditProductionDeploymentPacketPrepared,
  auditProductionDeploymentPacketRejected,
  auditProductionDeploymentPacketRequested,
  auditProductionDeploymentPacketValidated,
} from "./production-deployment-packet-audit-lifecycle";
import { getRunById } from "../../run-manager/run-manager";
import {
  ProductionDeploymentPacketError,
  validateProductionDeploymentPacketForRun,
} from "./validate-production-deployment-packet-for-run";
import { ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA } from "./production-deployment-packet-types";
import type { GovernedProductionDeploymentTargetEnvironment } from "./production-deployment-packet-types";

export interface PrepareProductionDeploymentPacketInput {
  runId: string;
  candidateId?: string;
  targetEnvironment?: GovernedProductionDeploymentTargetEnvironment;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  deploymentNotes?: string;
  rollbackNotes?: string;
  deployNow?: boolean;
}

export interface PrepareProductionDeploymentPacketResult {
  runId: string;
  candidateId: string;
  status: "production_deployment_packet_prepared";
  targetEnvironment: GovernedProductionDeploymentTargetEnvironment;
  productionDeploymentPacketPath: string;
  productionDeploymentPlanPath: string;
  notProductionDeployed: true;
  notComplete: true;
}

function buildProductionDeploymentPlanMarkdown(ctx: {
  runId: string;
  taskTitle: string;
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
  deploymentNotes: string;
  rollbackNotes: string;
  createdBy: string;
  createdReason: string;
  qualityGateSummary: unknown;
  productionReadinessSummary: unknown;
  stagingDeploymentSummary: unknown;
}): string {
  const lines = [
    "# Governed production deployment plan (reference only)",
    "",
    "> **Not production deployed.** This is a production deployment packet only.",
    "> No production deployment commands were executed by Engineering Console.",
    "",
    "## Deployment objective",
    "",
    `Deploy merged changes for run \`${ctx.runId}\` to **production**.`,
    "",
    `- Task: ${ctx.taskTitle}`,
    `- PR: ${ctx.prUrl} (#${ctx.prNumber})`,
    `- Merge commit: \`${ctx.mergeCommitSha}\``,
    ctx.mergedAt ? `- Merged at: ${ctx.mergedAt}` : null,
    ctx.mergeMethod ? `- Merge method: ${ctx.mergeMethod}` : null,
    "",
    "## Production target",
    "",
    "production",
    "",
    "## Staging evidence summary",
    "",
    `- Staging deployment exit code: ${ctx.stagingDeploymentExitCode}`,
    `- Staging deployment evidence: ${ctx.stagingDeploymentEvidencePath}`,
    "",
    "```json",
    JSON.stringify(ctx.stagingDeploymentSummary, null, 2),
    "```",
    "",
    "## Production readiness summary",
    "",
    `- Decision: ${ctx.productionReadinessDecision}`,
    `- Evidence: ${ctx.productionReadinessEvidencePath}`,
    "",
    "```json",
    JSON.stringify(ctx.productionReadinessSummary, null, 2),
    "```",
    "",
    "## Required pre-production checks",
    "",
    "- [ ] Production readiness recorded as `ready`",
    "- [ ] Staging deployment succeeded with evidence",
    "- [ ] Engineering review sign-off approved",
    "- [ ] Post-apply quality gates passed",
    "- [ ] Merge evidence verified",
    "- [ ] Rollback plan reviewed and approved",
    "",
    "## Production deployment commands (reference only — not executed)",
    "",
    "```bash",
    "# Example production deploy reference — DO NOT RUN from this packet phase",
    "# npm run build",
    "# render deploy --service <production-service> --commit " + ctx.mergeCommitSha,
    "```",
    "",
    "## Validation checklist",
    "",
    "- [ ] Production application starts successfully",
    "- [ ] Smoke tests pass in production",
    "- [ ] Error rates and latency normal",
    "- [ ] Logs show expected version/commit",
    "- [ ] Monitoring alerts quiet",
    "",
    "## Rollback checklist",
    "",
    "- [ ] Identify previous known-good production deployment",
    "- [ ] Execute approved rollback procedure",
    "- [ ] Verify production health checks after rollback",
    "- [ ] Record rollback evidence in Engineering Console",
    "",
    "## Rollback plan notes",
    "",
    ctx.rollbackNotes,
    "",
    "## Evidence links",
    "",
    `- Staging deployment packet: ${ctx.deploymentPacketPath}`,
    `- Staging deployment plan: ${ctx.deploymentPlanPath}`,
    `- Production readiness evidence: ${ctx.productionReadinessEvidencePath}`,
    `- Staging deployment evidence: ${ctx.stagingDeploymentEvidencePath}`,
    "",
    "## Operator",
    "",
    `- Prepared by: ${ctx.createdBy}`,
    `- Reason: ${ctx.createdReason}`,
    ctx.deploymentNotes ? `- Notes: ${ctx.deploymentNotes}` : null,
    "",
    "## Quality gate summary",
    "",
    "```json",
    JSON.stringify(ctx.qualityGateSummary, null, 2),
    "```",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export async function prepareProductionDeploymentPacketForRun(
  input: PrepareProductionDeploymentPacketInput,
): Promise<PrepareProductionDeploymentPacketResult> {
  let ctx;
  try {
    ctx = await validateProductionDeploymentPacketForRun(input);
    auditProductionDeploymentPacketRequested(
      ctx.runId,
      ctx.taskId,
      ctx.candidate.id,
      ctx.createdBy,
      ctx.targetEnvironment,
    );
    auditProductionDeploymentPacketValidated(ctx.runId, ctx.taskId, ctx.candidate.id, {
      targetEnvironment: ctx.targetEnvironment,
      createdBy: ctx.createdBy,
      reason: ctx.createdReason,
      rollbackNotesPresent: Boolean(ctx.rollbackNotes.trim()),
      mergeCommitSha: ctx.mergeCommitSha,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Validation failed";
    const code =
      error instanceof ProductionDeploymentPacketError ? error.code : "VALIDATION_FAILED";
    const run = getRunById(input.runId);
    auditProductionDeploymentPacketRejected(
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
  const productionDeploymentPacketPath = path.join(
    ctx.artifactDirectory,
    "production-deployment-packet.json",
  );
  const productionDeploymentPlanPath = path.join(
    ctx.artifactDirectory,
    "production-deployment-plan.md",
  );

  const evidence = {
    schema: ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_SCHEMA,
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    targetEnvironment: ctx.targetEnvironment,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    productionReadinessDecision: ctx.productionReadinessDecision,
    productionReadinessEvidencePath: ctx.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    stagingDeploymentExitCode: ctx.stagingDeploymentExitCode,
    deploymentPacketPath: ctx.deploymentPacketPath,
    deploymentPlanPath: ctx.deploymentPlanPath,
    qualityGateSummary: ctx.qualityGateSummary,
    signOffSummary: ctx.signOffSummary,
    mergeSummary: ctx.mergeSummary,
    deploymentNotes: ctx.deploymentNotes,
    rollbackNotes: ctx.rollbackNotes,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
    createdAt,
    notProductionDeployed: true as const,
    notComplete: true as const,
  };

  const planMarkdown = buildProductionDeploymentPlanMarkdown({
    runId: ctx.runId,
    taskTitle: ctx.taskTitle,
    prUrl: ctx.prUrl,
    prNumber: ctx.prNumber,
    mergeCommitSha: ctx.mergeCommitSha,
    mergedAt: ctx.mergedAt,
    mergeMethod: ctx.mergeMethod,
    productionReadinessDecision: ctx.productionReadinessDecision,
    productionReadinessEvidencePath: ctx.productionReadinessEvidencePath,
    stagingDeploymentEvidencePath: ctx.stagingDeploymentEvidencePath,
    stagingDeploymentExitCode: ctx.stagingDeploymentExitCode,
    deploymentPacketPath: ctx.deploymentPacketPath,
    deploymentPlanPath: ctx.deploymentPlanPath,
    deploymentNotes: ctx.deploymentNotes,
    rollbackNotes: ctx.rollbackNotes,
    createdBy: ctx.createdBy,
    createdReason: ctx.createdReason,
    qualityGateSummary: ctx.qualityGateSummary,
    productionReadinessSummary: ctx.productionReadinessSummary,
    stagingDeploymentSummary: ctx.stagingDeploymentSummary,
  });

  fs.writeFileSync(productionDeploymentPacketPath, JSON.stringify(evidence, null, 2), "utf8");
  fs.writeFileSync(productionDeploymentPlanPath, planMarkdown, "utf8");

  markCommitCandidateProductionDeploymentPacketPrepared({
    candidateId: ctx.candidate.id,
    productionDeploymentTargetEnvironment: ctx.targetEnvironment,
    productionDeploymentPacketCreatedAt: createdAt,
    productionDeploymentPacketCreatedBy: ctx.createdBy,
    productionDeploymentPacketReason: ctx.createdReason,
    productionDeploymentRollbackNotes: ctx.rollbackNotes,
    productionDeploymentPacketPath,
    productionDeploymentPlanPath,
  });

  auditProductionDeploymentPacketPrepared(ctx.runId, ctx.taskId, ctx.candidate.id, {
    targetEnvironment: ctx.targetEnvironment,
    createdBy: ctx.createdBy,
    reason: ctx.createdReason,
    rollbackNotesPresent: Boolean(ctx.rollbackNotes.trim()),
    productionDeploymentPacketPath,
    productionDeploymentPlanPath,
  });

  return {
    runId: ctx.runId,
    candidateId: ctx.candidate.id,
    status: "production_deployment_packet_prepared",
    targetEnvironment: ctx.targetEnvironment,
    productionDeploymentPacketPath,
    productionDeploymentPlanPath,
    notProductionDeployed: true,
    notComplete: true,
  };
}
