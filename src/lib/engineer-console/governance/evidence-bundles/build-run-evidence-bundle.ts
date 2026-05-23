import { createHash } from "crypto";
import path from "path";
import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../../run-manager/run-manager";
import { getRegisteredRepoById } from "../../repo-intelligence/registered-repos/get-repo";
import { hashRepoPathForAudit } from "../../repo-intelligence/registered-repos/repo-path-policy";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { getTaskById } from "../../task-manager/task-manager";
import type { ApprovalReport, WorkerPlanReportSummary } from "../../types";
import type { GovernanceAssessment } from "../governance-engine";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import {
  getLatestWorkerPlanDraftForRun,
} from "../../worker-plan/worker-plan-draft-manager";
import {
  getLatestWorkerPlanForRun,
  listWorkerOperations,
} from "../../worker-plan/worker-plan-manager";
import { getChangedFiles, getDiffSummary } from "../../workspace/git-workspace";
import {
  EVIDENCE_BUNDLE_VERSION,
  type EvidenceApprovalSummary,
  type EvidenceAuditReference,
  type EvidenceGovernanceSummary,
  type EvidenceModelDraftSummary,
  type EvidenceCompatibilitySummary,
  type EvidencePolicySummary,
  type EvidenceQualityGateSummary,
  type EvidenceReviewStagesSummary,
  type EvidencePrRequestsSummary,
  type EvidenceMergeRequestsSummary,
  type EvidenceWorkerPlanSummary,
  type RunEvidenceBundleV1,
} from "./evidence-bundle-types";
import { hashContent, stripAnsi, truncateString } from "./redact-evidence-bundle";
import { getLatestPolicyEvaluationResult } from "../policy-results/policy-result-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../review-stages/review-stage-manager";
import { summarizePrRequestsForRun } from "../../release/pr-creation/pr-request-manager";
import { summarizeMergeRequestsForRun } from "../../release/merge-controls/merge-request-manager";
import { getCompatibilitySummaryForRepo } from "../../repo-intelligence/compatibility/compatibility-manager";

export interface BuildRunEvidenceBundleInput {
  runId: string;
  changedFiles?: string[];
  diffSummary?: string;
  workerPlanSummary?: WorkerPlanReportSummary | null;
}

function hashContentShort(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseGovernanceFromRun(notes: string | null): GovernanceAssessment | null {
  if (!notes) return null;
  try {
    return JSON.parse(notes) as GovernanceAssessment;
  } catch {
    return null;
  }
}

function buildQualityGateSummaries(
  gates: ReturnType<typeof getQualityGateResultsForRun>,
): EvidenceQualityGateSummary[] {
  return gates.map((gate) => {
    const combined = stripAnsi(`${gate.stdout}\n${gate.stderr}`);
    return {
      command: gate.command,
      status: gate.status,
      exitCode: gate.exitCode,
      durationMs: gate.durationMs,
      outputHash: hashContentShort(combined),
      outputPreview: truncateString(combined, 200),
    };
  });
}

function buildWorkerPlanSummary(
  runId: string,
  workerPlanSummary: WorkerPlanReportSummary | null,
): EvidenceWorkerPlanSummary | null {
  const plan = getLatestWorkerPlanForRun(runId);
  if (!plan && !workerPlanSummary) return null;

  const ops = plan ? listWorkerOperations(plan.id) : [];
  const summary = workerPlanSummary ?? {
    workerPlanId: plan!.id,
    summary: plan!.summary,
    validationStatus: plan!.validationStatus,
    executionStatus: plan!.executionStatus,
    executedCount: ops.length,
    errorCount: 0,
    executedOperations: [],
    validationErrors: [],
    executionErrors: [],
  };

  return {
    workerPlanId: summary.workerPlanId,
    summary: truncateString(summary.summary, 300),
    validationStatus: summary.validationStatus,
    executionStatus: summary.executionStatus,
    operationCount: ops.length,
    executedCount: summary.executedCount,
    errorCount: summary.errorCount,
  };
}

function buildModelDraftSummary(runId: string): EvidenceModelDraftSummary | null {
  const draft = getLatestWorkerPlanDraftForRun(runId);
  if (!draft) return null;

  return {
    draftId: draft.id,
    provider: draft.provider,
    model: draft.model,
    validationStatus: draft.validationStatus,
    promptHash: hashContentShort(draft.prompt),
    rawResponseHash: hashContentShort(draft.rawResponse),
  };
}

function buildApprovalSummary(report: ApprovalReport | null): EvidenceApprovalSummary | null {
  if (!report) return null;
  return {
    canApprove: report.canApprove,
    recommendedNextAction: truncateString(report.recommendedNextAction, 300),
    riskLevel: report.riskLevel,
  };
}

function buildGovernanceSummary(
  governance: GovernanceAssessment | null,
  report: ApprovalReport | null,
): EvidenceGovernanceSummary | null {
  const g =
    governance ??
    (report
      ? {
          riskLevel: report.riskLevel,
          canApprove: report.canApprove,
          issues: report.governanceIssues,
          blockedFiles: [],
        }
      : null);

  if (!g) return null;

  return {
    riskLevel: g.riskLevel,
    canApprove: g.canApprove,
    issueCount: g.issues.length,
    blockedFileCount: g.blockedFiles.length,
    issuesPreview: g.issues.slice(0, 10).map((i) => truncateString(i, 200)),
  };
}

function buildPolicySummary(runId: string): EvidencePolicySummary | null {
  const policy = getLatestPolicyEvaluationResult(runId);
  if (!policy) return null;

  return {
    status: policy.status,
    policyVersion: policy.policyVersion,
    policyHashPrefix: policy.policyHash.slice(0, 12),
    blockerCount: policy.blockers.length,
    warningCount: policy.warnings.length,
    reviewRequiredCount: policy.reviewRequired.length,
    recommendedNextAction: truncateString(policy.recommendedNextAction, 300),
  };
}

function buildPrRequestsSummary(runId: string): EvidencePrRequestsSummary | null {
  const summary = summarizePrRequestsForRun(runId);
  if (summary.attemptCount === 0) return null;
  return summary;
}

function buildMergeRequestsSummary(runId: string): EvidenceMergeRequestsSummary | null {
  const summary = summarizeMergeRequestsForRun(runId);
  if (summary.attemptCount === 0) return null;
  return summary;
}

function buildReviewStagesSummary(runId: string): EvidenceReviewStagesSummary | null {
  const stages = listReviewStagesForRun(runId);
  if (stages.length === 0) return null;
  return summarizeReviewStages(stages);
}

function buildCompatibilitySummary(registeredRepoId: string | null): EvidenceCompatibilitySummary | null {
  if (!registeredRepoId) return null;
  const summary = getCompatibilitySummaryForRepo(registeredRepoId);
  if (summary.linkCount === 0 && !summary.latestRunAt) return null;
  return {
    breakingCount: summary.breakingCount,
    warningCount: summary.warningCount,
    unknownCount: summary.unknownCount,
    linkCount: summary.linkCount,
    latestRunAt: summary.latestRunAt,
  };
}

function buildAuditReference(runId: string): EvidenceAuditReference {
  const events = listAuditEventsForRun(runId);
  return {
    eventCount: events.length,
    chainHashPrefixes: events.map((e) => e.chainHash.slice(0, 12)),
    latestEventType: events.length > 0 ? events[events.length - 1]!.eventType : null,
  };
}

export async function buildRunEvidenceBundle(
  input: BuildRunEvidenceBundleInput,
): Promise<RunEvidenceBundleV1> {
  const run = getRunById(input.runId);
  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found: ${run.taskId}`);
  }

  const repoPath = resolveTaskTargetRepoPath(task);
  const registeredRepo = task.registeredRepoId
    ? getRegisteredRepoById(task.registeredRepoId)
    : null;

  let changedFiles = input.changedFiles;
  let diffSummary = input.diffSummary;
  if (changedFiles === undefined || diffSummary === undefined) {
    try {
      changedFiles = changedFiles ?? (await getChangedFiles(repoPath));
      diffSummary = diffSummary ?? (await getDiffSummary(repoPath));
    } catch {
      changedFiles = changedFiles ?? [];
      diffSummary = diffSummary ?? "";
    }
  }

  const gates = getQualityGateResultsForRun(run.id);
  const reportJson = getApprovalReportJson(run.id);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;

  const governance = parseGovernanceFromRun(run.governanceNotes);

  const diffClean = stripAnsi(diffSummary ?? "");
  const diffLines = diffClean.split("\n").filter(Boolean);

  return {
    bundleVersion: EVIDENCE_BUNDLE_VERSION,
    runId: run.id,
    taskId: task.id,
    taskTitle: task.title,
    taskDescriptionPreview: truncateString(task.description || "", 300),
    registeredRepoId: task.registeredRepoId,
    repoName: registeredRepo?.name ?? path.basename(repoPath),
    repoPathRef: hashRepoPathForAudit(repoPath),
    branchName: run.branchName,
    runStatus: run.status,
    runStep: run.currentStep,
    modelDraft: buildModelDraftSummary(run.id),
    workerPlan: buildWorkerPlanSummary(run.id, input.workerPlanSummary ?? null),
    changedFiles,
    changedFileCount: changedFiles.length,
    diffStats: {
      lineCount: diffLines.length,
      preview: truncateString(diffClean, 800),
      contentHash: hashContent(diffClean),
    },
    qualityGates: buildQualityGateSummaries(gates),
    governance: buildGovernanceSummary(governance, approvalReport),
    approval: buildApprovalSummary(approvalReport),
    policy: buildPolicySummary(run.id),
    reviewStages: buildReviewStagesSummary(run.id),
    prRequests: buildPrRequestsSummary(run.id),
    mergeRequests: buildMergeRequestsSummary(run.id),
    compatibility: buildCompatibilitySummary(task.registeredRepoId),
    audit: buildAuditReference(run.id),
    timestamps: {
      runStartedAt: run.startedAt,
      runCompletedAt: run.completedAt,
      bundleBuiltAt: new Date().toISOString(),
    },
  };
}
