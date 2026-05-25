import type {
  ApprovalReport,
  EngineeringRun,
  EngineeringTask,
  QualityGateResult,
} from "@/lib/engineer-console/types";
import { listDecisionRecords } from "@/lib/engineer-console/governance/decision-records/decision-record-manager";
import { getEvidenceBundleForRun } from "@/lib/engineer-console/governance/evidence-bundles/evidence-bundle-manager";
import {
  getLatestPolicyResult,
  parsePolicyEvaluationResult,
} from "@/lib/engineer-console/governance/policy-results/policy-result-manager";
import {
  getLatestReplayVerification,
  parseReplayVerificationResult,
} from "@/lib/engineer-console/governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "@/lib/engineer-console/governance/review-stages/review-stage-manager";
import {
  listDeploymentHealthChecksForRun,
} from "@/lib/engineer-console/release/deployment-health-check/deployment-health-check-manager";
import {
  listDeploymentHealthPolicyResultsForRun,
  parseDeploymentHealthPolicyEvaluation,
} from "@/lib/engineer-console/release/deployment-health-policy/deployment-health-policy-manager";
import { listDeploymentApprovalsForRun } from "@/lib/engineer-console/release/deployment-gates/deployment-gate-manager";
import {
  listDeploymentExecutionsForRun,
} from "@/lib/engineer-console/release/deployment-execution/deployment-execution-manager";
import {
  summarizeMergeRequestsForRun,
} from "@/lib/engineer-console/release/merge-controls/merge-request-manager";
import {
  listPrRequestsForRun,
  summarizePrRequestsForRun,
} from "@/lib/engineer-console/release/pr-creation/pr-request-manager";
import {
  getHardReleaseGateStatusForRun,
} from "@/lib/engineer-console/release/release-gates/release-gate-manager";
import {
  getLatestReleaseChecklistForRun,
  parseReleaseChecklistEvaluation,
} from "@/lib/engineer-console/release/release-checklist/release-checklist-manager";
import {
  listReleaseSignoffsForRun,
} from "@/lib/engineer-console/release/release-signoff/release-signoff-manager";
import {
  getLatestWorkerPlanDraftForRun,
} from "@/lib/engineer-console/worker-plan/worker-plan-draft-manager";
import {
  getLatestWorkerPlanForRun,
  listWorkerOperations,
  parseValidationErrors,
} from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import { shouldShowReadmeSmokeHelper } from "@/lib/engineer-console/worker-plan/worker-plan-ux";
import type { RunWorkflowSummary } from "./run-ux-types";

export function buildRunWorkflowSummary(input: {
  run: EngineeringRun;
  task: EngineeringTask;
  qualityGates: QualityGateResult[];
  approvalReport: ApprovalReport | null;
  changedFiles: string[];
}): RunWorkflowSummary {
  const { run, task, qualityGates, approvalReport, changedFiles } = input;
  const runId = run.id;

  const latestWorkerPlan = getLatestWorkerPlanForRun(runId);
  const latestWorkerPlanDraft = getLatestWorkerPlanDraftForRun(runId);
  const latestWorkerPlanOperations = latestWorkerPlan
    ? listWorkerOperations(latestWorkerPlan.id)
    : [];
  const workerPlanValidationErrors = latestWorkerPlan
    ? parseValidationErrors(latestWorkerPlan.validationErrorsJson)
    : [];
  const workerPlanValidationWarnings = latestWorkerPlan
    ? parseValidationErrors(latestWorkerPlan.validationWarningsJson)
    : [];
  const workerPlanExecutionErrors = latestWorkerPlan
    ? parseValidationErrors(latestWorkerPlan.executionErrorsJson)
    : [];

  const decisionRecords = listDecisionRecords(runId);
  const latestDecision = decisionRecords[0]?.decision ?? null;

  const evidenceBundle = getEvidenceBundleForRun(runId);

  const replayRecord = getLatestReplayVerification(runId);
  const replayResult = replayRecord ? parseReplayVerificationResult(replayRecord) : null;

  const policyRecord = getLatestPolicyResult(runId);
  const policyResult = policyRecord ? parsePolicyEvaluationResult(policyRecord) : null;

  const reviewStages = listReviewStagesForRun(runId);
  const reviewSummary = summarizeReviewStages(reviewStages);

  const prSummary = summarizePrRequestsForRun(runId);
  const latestPrRequest = listPrRequestsForRun(runId)[0] ?? null;

  const mergeSummary = summarizeMergeRequestsForRun(runId);

  const deploymentApprovals = listDeploymentApprovalsForRun(runId);
  const latestDeploymentApproval = deploymentApprovals[0] ?? null;

  const deploymentExecutions = listDeploymentExecutionsForRun(runId);
  const latestDeploymentExecution = deploymentExecutions[0] ?? null;

  const deploymentHealthChecks = listDeploymentHealthChecksForRun(runId);
  const latestDeploymentHealthCheck = deploymentHealthChecks[0] ?? null;

  const deploymentHealthPolicyResults = listDeploymentHealthPolicyResultsForRun(runId);
  const latestDeploymentHealthPolicy = deploymentHealthPolicyResults[0] ?? null;
  const latestDeploymentHealthPolicyEvaluation = latestDeploymentHealthPolicy
    ? parseDeploymentHealthPolicyEvaluation(latestDeploymentHealthPolicy)
    : null;

  const latestReleaseChecklist = getLatestReleaseChecklistForRun(runId);
  const latestReleaseChecklistEvaluation = latestReleaseChecklist
    ? parseReleaseChecklistEvaluation(latestReleaseChecklist)
    : null;

  const releaseSignoffs = listReleaseSignoffsForRun(runId);
  const latestReleaseSignoff = releaseSignoffs[0] ?? null;

  const hardGates = getHardReleaseGateStatusForRun(runId);

  return {
    run: {
      id: run.id,
      status: run.status,
      currentStep: run.currentStep,
      branchName: run.branchName,
      riskLevel: run.riskLevel,
      agentMessage: run.agentMessage,
    },
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
    },
    workerPlan: {
      hasDraft: Boolean(latestWorkerPlanDraft),
      exists: Boolean(latestWorkerPlan),
      validationStatus: latestWorkerPlan?.validationStatus ?? null,
      executionStatus: latestWorkerPlan?.executionStatus ?? null,
      validationErrorCount: workerPlanValidationErrors.length,
      validationWarningCount: workerPlanValidationWarnings.length,
      executionErrorCount: workerPlanExecutionErrors.length,
      executedOperationCount: latestWorkerPlanOperations.length,
      changedFileCount: changedFiles.length,
      showReadmeSmokeHelper: shouldShowReadmeSmokeHelper({
        auditChainScope: process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE,
        nodeEnv: process.env.NODE_ENV,
        taskTitle: task.title,
        taskDescription: task.description,
      }),
    },
    qualityGates: {
      count: qualityGates.length,
      passedCount: qualityGates.filter((gate) => gate.status === "passed").length,
      failedCount: qualityGates.filter((gate) => gate.status === "failed").length,
      skippedCount: qualityGates.filter((gate) => gate.status === "skipped").length,
      failedCommands: qualityGates
        .filter((gate) => gate.status === "failed")
        .map((gate) => gate.command),
      skippedCommands: qualityGates
        .filter((gate) => gate.status === "skipped")
        .map((gate) => gate.command),
    },
    approval: {
      reportAvailable: approvalReport !== null,
      canApprove: approvalReport?.canApprove ?? false,
      governanceIssues: approvalReport?.governanceIssues ?? [],
      recommendedNextAction: approvalReport?.recommendedNextAction ?? null,
      decisionCount: decisionRecords.length,
      latestDecision,
    },
    evidence: {
      exists: evidenceBundle !== null,
      updatedAt: evidenceBundle?.updatedAt ?? null,
    },
    replay: {
      exists: replayRecord !== null,
      status: replayRecord?.status ?? null,
      warningCount: replayResult?.summary.warnings ?? 0,
      failedCount: replayResult?.summary.failed ?? 0,
    },
    policy: {
      exists: policyRecord !== null,
      status: policyRecord?.status ?? null,
      blockers: policyResult?.blockers ?? [],
      warnings: policyResult?.warnings ?? [],
      reviewRequired: policyResult?.reviewRequired ?? [],
      recommendedNextAction: policyResult?.recommendedNextAction ?? null,
    },
    review: {
      stageCount: reviewStages.length,
      requiredCount: reviewSummary.requiredCount,
      approvedCount: reviewSummary.approvedCount,
      pendingCount: reviewSummary.pendingCount,
      rejectedCount: reviewSummary.rejectedCount,
      skippedCount: reviewSummary.skippedCount,
    },
    pr: {
      attemptCount: prSummary.attemptCount,
      latestStatus: prSummary.latestStatus,
      latestPrUrl: prSummary.latestPrUrl,
      latestErrorMessage: latestPrRequest?.errorMessage ?? null,
    },
    merge: {
      attemptCount: mergeSummary.attemptCount,
      latestStatus: mergeSummary.latestStatus,
      latestMergeShaPrefix: mergeSummary.latestMergeShaPrefix,
    },
    deployment: {
      approvalCount: deploymentApprovals.length,
      latestApprovalDecision: latestDeploymentApproval?.decision ?? null,
      latestExecutionStatus: latestDeploymentExecution?.status ?? null,
      latestHealthCheckStatus: latestDeploymentHealthCheck?.status ?? null,
      latestHealthPolicyStatus: latestDeploymentHealthPolicy?.status ?? null,
      latestHealthPolicyRecommendedAction:
        latestDeploymentHealthPolicyEvaluation?.recommendedAction ?? null,
      latestHealthPolicyBlockers:
        latestDeploymentHealthPolicyEvaluation?.blockers ?? [],
      latestHealthPolicyWarnings:
        latestDeploymentHealthPolicyEvaluation?.warnings ?? [],
    },
    release: {
      checklistRecorded: latestReleaseChecklist !== null,
      checklistStatus: latestReleaseChecklist?.status ?? null,
      checklistBlockers: latestReleaseChecklistEvaluation?.blockers ?? [],
      checklistNeedsAttention: latestReleaseChecklistEvaluation?.needsAttention ?? [],
      checklistRecommendedAction:
        latestReleaseChecklistEvaluation?.recommendedAction ?? null,
      signoffCount: releaseSignoffs.length,
      latestSignoffDecision: latestReleaseSignoff?.decision ?? null,
      latestSignoffRationale: latestReleaseSignoff?.rationale ?? null,
    },
    hardGates: {
      enabled: hardGates.config.hardGatesEnabled,
      mergeStatus: hardGates.evaluations.merge.status,
      mergeBlockers: hardGates.evaluations.merge.blockers,
      deploymentApprovalStatus:
        hardGates.evaluations.deployment_approval_approve.status,
      deploymentApprovalBlockers:
        hardGates.evaluations.deployment_approval_approve.blockers,
      deploymentExecutionStatus:
        hardGates.evaluations.deployment_execution.status,
      deploymentExecutionBlockers:
        hardGates.evaluations.deployment_execution.blockers,
      signoffCompletedStatus:
        hardGates.evaluations.release_signoff_completed.status,
      signoffCompletedBlockers:
        hardGates.evaluations.release_signoff_completed.blockers,
      signoffExceptionsStatus:
        hardGates.evaluations.release_signoff_completed_with_exceptions.status,
      signoffExceptionsBlockers:
        hardGates.evaluations.release_signoff_completed_with_exceptions.blockers,
    },
  };
}
