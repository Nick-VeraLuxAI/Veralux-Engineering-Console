import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
} from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getWorkerPlanChangedFilesScope } from "../worker-plan/worker-plan-manager";
import { getChangedFiles, getDiffSummary } from "../workspace/git-workspace";
import type { ApprovalReport, QualityGateResult } from "../types";
import { buildRunWorkflowSummary } from "../run-ux/build-run-workflow-summary";
import { summarizeReviewStages, listReviewStagesForRun } from "../governance/review-stages/review-stage-manager";
import { evaluateMergeReadiness } from "../release/merge-controls/evaluate-merge-readiness";
import { evaluateDeploymentReadiness } from "../release/deployment-gates/evaluate-deployment-readiness";
import { listDeploymentEnvironments } from "../release/deployment-gates/deployment-environments";
import { ingestHermesWorkerEvidenceForRun } from "../hermes-worker/hermes-evidence-ingest";
import type { HermesWorkerEvidenceSummary } from "../hermes-worker/hermes-evidence-types";

export type BridgeGateStatus = "passed" | "failed" | "skipped" | "not_run";

export interface RunEvidenceSummaryForBridge {
  runId: string;
  taskId: string;
  taskTitle: string;
  repo: string;
  branch: string | null;
  currentStatus: string;
  currentStep: string | null;
  diffSummary: string;
  changedFileCount: number;
  testStatus: BridgeGateStatus;
  buildStatus: BridgeGateStatus;
  reviewPacketStatus: string;
  approvalRequired: boolean;
  signOffRequired: boolean;
  mergeReadinessStatus: string | null;
  mergeReadinessBlockers: string[];
  deployReadinessStatus: string | null;
  deployReadinessBlockers: string[];
  blockers: string[];
  warnings: string[];
  replayStatus: string | null;
  evidenceBundleExists: boolean;
  hermesWorkerEvidence: HermesWorkerEvidenceSummary;
  hermesPatchProposal: HermesWorkerEvidenceSummary["patchProposal"];
  recommendedNextAction: string | null;
  consoleRunPath: string;
  consoleTaskPath: string;
  lastUpdated: string;
  fetchedAt: string;
}

function gateStatusForCommand(
  gates: QualityGateResult[],
  pattern: RegExp,
): BridgeGateStatus {
  const gate = gates.find((row) => pattern.test(row.command));
  if (!gate) return "not_run";
  return gate.status;
}

function reviewPacketStatusLabel(runId: string): string {
  const stages = listReviewStagesForRun(runId);
  if (stages.length === 0) return "not_generated";
  const summary = summarizeReviewStages(stages);
  if (summary.rejectedCount > 0) return "rejected";
  if (summary.pendingCount > 0) return "pending";
  if (summary.requiredCount > 0 && summary.approvedCount >= summary.requiredCount) {
    return "approved";
  }
  return "in_progress";
}

function pickDeploymentEnvironmentId(): string | null {
  const environments = listDeploymentEnvironments();
  const staging = environments.find((env) => env.name === "staging");
  return (staging ?? environments[0])?.id ?? null;
}

function maxIsoTimestamp(...values: Array<string | null | undefined>): string {
  let best = "";
  for (const value of values) {
    if (!value) continue;
    if (!best || Date.parse(value) > Date.parse(best)) {
      best = value;
    }
  }
  return best || new Date().toISOString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export async function buildRunEvidenceSummaryForBridge(
  runId: string,
  options: { fetchedAt?: string } = {},
): Promise<RunEvidenceSummaryForBridge | null> {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const run = getRunById(runId);
  if (!run) return null;

  const task = getTaskById(run.taskId);
  if (!task) return null;

  let changedFiles: string[] = [];
  let diffSummary = "";
  try {
    const repoPath = resolveTaskTargetRepoPath(task);
    const scope = getWorkerPlanChangedFilesScope(runId);
    changedFiles = await getChangedFiles(repoPath, scope ?? {});
    diffSummary = await getDiffSummary(repoPath, { changedFiles });
  } catch {
    changedFiles = [];
    diffSummary = "";
  }

  const qualityGates = getQualityGateResultsForRun(runId);
  const reportJson = getApprovalReportJson(runId);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const uxSummary = buildRunWorkflowSummary({
    run,
    task,
    qualityGates,
    approvalReport,
    changedFiles,
  });

  const mergeReadiness = await evaluateMergeReadiness(runId, null, { inspectGithub: false });

  const deployEnvironmentId = pickDeploymentEnvironmentId();
  const deployReadiness = deployEnvironmentId
    ? evaluateDeploymentReadiness(runId, deployEnvironmentId)
    : null;

  const policyBlockers = uxSummary.policy.blockers ?? [];
  const hardGateBlockers = [
    ...uxSummary.hardGates.mergeBlockers,
    ...uxSummary.hardGates.deploymentApprovalBlockers,
    ...uxSummary.hardGates.deploymentExecutionBlockers,
    ...uxSummary.hardGates.signoffCompletedBlockers,
  ];
  const blockers = uniqueStrings([
    ...mergeReadiness.blockers,
    ...(deployReadiness?.blockers ?? []),
    ...policyBlockers,
    ...hardGateBlockers,
    ...(approvalReport?.governanceIssues ?? []),
  ]);

  const warnings = uniqueStrings([
    ...mergeReadiness.warnings,
    ...(deployReadiness?.warnings ?? []),
    ...(uxSummary.policy.warnings ?? []),
    ...uxSummary.pr.latestReadinessWarnings,
  ]);

  const approvalRequired =
    run.status === "waiting_for_approval" ||
    task.status === "waiting_for_approval" ||
    Boolean(approvalReport?.canApprove === false && blockers.length > 0);

  const signOffRequired =
    uxSummary.release.signoffCount === 0 &&
    (uxSummary.release.checklistStatus === "passed" ||
      uxSummary.hardGates.signoffCompletedStatus === "blocked");

  const hermesEvidence = ingestHermesWorkerEvidenceForRun(runId);

  return {
    runId: run.id,
    taskId: task.id,
    taskTitle: task.title,
    repo: task.targetRepoPath,
    branch: run.branchName,
    currentStatus: run.status,
    currentStep: run.currentStep,
    diffSummary: diffSummary.trim(),
    changedFileCount: changedFiles.length,
    testStatus: gateStatusForCommand(qualityGates, /\btest\b/i),
    buildStatus: gateStatusForCommand(qualityGates, /\bbuild\b/i),
    reviewPacketStatus: reviewPacketStatusLabel(runId),
    approvalRequired,
    signOffRequired,
    mergeReadinessStatus: mergeReadiness.status,
    mergeReadinessBlockers: mergeReadiness.blockers,
    deployReadinessStatus: deployReadiness?.status ?? null,
    deployReadinessBlockers: deployReadiness?.blockers ?? [],
    blockers,
    warnings,
    replayStatus: uxSummary.replay.status,
    evidenceBundleExists: uxSummary.evidence.exists,
    hermesWorkerEvidence: hermesEvidence.summary,
    hermesPatchProposal: hermesEvidence.summary.patchProposal,
    recommendedNextAction:
      approvalReport?.recommendedNextAction ??
      mergeReadiness.recommendedAction ??
      deployReadiness?.recommendedAction ??
      uxSummary.policy.recommendedNextAction ??
      null,
    consoleRunPath: `/engineer/runs/${run.id}`,
    consoleTaskPath: `/engineer/tasks/${task.id}`,
    lastUpdated: maxIsoTimestamp(
      task.updatedAt,
      run.startedAt,
      run.completedAt,
      uxSummary.evidence.updatedAt,
    ),
    fetchedAt,
  };
}
