import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "@/lib/engineer-console/types";
import { listDecisionRecords } from "@/lib/engineer-console/governance/decision-records/decision-record-manager";
import {
  getLatestPolicyResult,
  parsePolicyEvaluationResult,
} from "@/lib/engineer-console/governance/policy-results/policy-result-manager";
import {
  getLatestReplayVerification,
  parseReplayVerificationResult,
} from "@/lib/engineer-console/governance/replay-verification/replay-verification-manager";
import { listPrRequestsForRun } from "@/lib/engineer-console/release/pr-creation/pr-request-manager";
import type { PrReadinessResult } from "@/lib/engineer-console/release/pr-creation/pr-creation-types";
import type { RunWorkflowSummary } from "@/lib/engineer-console/run-ux/run-ux-types";
import {
  getLatestWorkerPlanForRun,
  parseValidationErrors,
} from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import { getLatestWorkerPlanDraftForRun, getDraftValidationErrors } from "@/lib/engineer-console/worker-plan/worker-plan-draft-manager";
import type { WorkerPlan } from "@/lib/engineer-console/worker-plan/worker-plan-types";
import { classifyRunRisk } from "./classify-run-risk";
import type { RunIntelligenceSummary } from "./danger-point-types";
import { deriveEscalation } from "./derive-escalation";
import {
  detectDangerPoints,
  type ParsedWorkerPlanSnapshot,
} from "./detect-danger-points";
import { recommendPlaybooks } from "./recommend-playbooks";

export interface BuildRunIntelligenceSummaryInput {
  run: EngineeringRun;
  task: EngineeringTask;
  changedFiles: string[];
  qualityGates: QualityGateResult[];
  approvalReport: ApprovalReport | null;
  uxSummary: RunWorkflowSummary;
}

function parseWorkerPlanJson(planJson: string | null): WorkerPlan | null {
  if (!planJson) return null;
  try {
    return JSON.parse(planJson) as WorkerPlan;
  } catch {
    return null;
  }
}

function toSnapshot(args: {
  summary: string;
  plan: WorkerPlan | null;
  validationStatus: string | null;
  validationErrors: Array<{ code: string; message: string; path?: string }>;
  validationWarnings: Array<{ code: string; message: string; path?: string }>;
  executionStatus: string | null;
}): ParsedWorkerPlanSnapshot | null {
  if (!args.plan) return null;
  return {
    summary: args.summary || args.plan.summary,
    allowedFiles: args.plan.allowedFiles ?? [],
    operations: args.plan.operations.map((operation) => ({
      type: operation.type,
      path: operation.path,
      reason: operation.reason,
    })),
    validationStatus: args.validationStatus,
    validationErrors: args.validationErrors,
    validationWarnings: args.validationWarnings,
    executionStatus: args.executionStatus,
  };
}

function parseLatestPrReadiness(runId: string): PrReadinessResult | null {
  const latestRequest = listPrRequestsForRun(runId)[0];
  if (!latestRequest) return null;
  try {
    return JSON.parse(latestRequest.readinessJson) as PrReadinessResult;
  } catch {
    return null;
  }
}

function severityScore(severity: string): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildRunIntelligenceSummary(
  input: BuildRunIntelligenceSummaryInput,
): RunIntelligenceSummary {
  const latestWorkerPlanRecord = getLatestWorkerPlanForRun(input.run.id);
  const latestWorkerPlan = toSnapshot({
    summary: latestWorkerPlanRecord?.summary ?? "",
    plan: parseWorkerPlanJson(latestWorkerPlanRecord?.planJson ?? null),
    validationStatus: latestWorkerPlanRecord?.validationStatus ?? null,
    validationErrors: latestWorkerPlanRecord
      ? parseValidationErrors(latestWorkerPlanRecord.validationErrorsJson)
      : [],
    validationWarnings: latestWorkerPlanRecord
      ? parseValidationErrors(latestWorkerPlanRecord.validationWarningsJson)
      : [],
    executionStatus: latestWorkerPlanRecord?.executionStatus ?? null,
  });

  const latestDraftRecord = getLatestWorkerPlanDraftForRun(input.run.id);
  const latestWorkerPlanDraft = toSnapshot({
    summary: parseWorkerPlanJson(latestDraftRecord?.parsedPlanJson ?? null)?.summary ?? "",
    plan: parseWorkerPlanJson(latestDraftRecord?.parsedPlanJson ?? null),
    validationStatus: latestDraftRecord?.validationStatus ?? null,
    validationErrors: latestDraftRecord ? getDraftValidationErrors(latestDraftRecord) : [],
    validationWarnings: [],
    executionStatus: null,
  });

  const latestPolicyRecord = getLatestPolicyResult(input.run.id);
  const latestPolicyResult = latestPolicyRecord ? parsePolicyEvaluationResult(latestPolicyRecord) : null;
  const latestReplayRecord = getLatestReplayVerification(input.run.id);
  const latestReplayResult = latestReplayRecord ? parseReplayVerificationResult(latestReplayRecord) : null;
  const latestPrReadiness = parseLatestPrReadiness(input.run.id);
  const latestDecisionAt = listDecisionRecords(input.run.id)[0]?.createdAt ?? null;

  const dangerPoints = detectDangerPoints({
    ...input,
    latestWorkerPlan,
    latestWorkerPlanDraft,
    latestPolicyResult,
    latestReplayResult,
    latestPrReadiness,
    latestDecisionAt,
  }).sort((left, right) => severityScore(right.severity) - severityScore(left.severity));

  const planForRisk = latestWorkerPlan ?? latestWorkerPlanDraft;
  const riskClassification = classifyRunRisk({
    changedFiles:
      input.changedFiles.length > 0
        ? input.changedFiles
        : input.approvalReport?.changedFiles ?? [],
    dangerPoints,
    operationTypes: planForRisk?.operations.map((operation) => operation.type) ?? [],
    createdFiles:
      planForRisk?.operations
        .filter((operation) => operation.type === "create_file")
        .map((operation) => operation.path) ?? [],
  });

  const escalation = deriveEscalation({
    dangerPoints,
    riskClassification,
    qualityGates: {
      passedCount: input.uxSummary.qualityGates.passedCount,
      failedCount: input.uxSummary.qualityGates.failedCount,
    },
    replay: input.uxSummary.replay,
    policy: input.uxSummary.policy,
    review: input.uxSummary.review,
    approval: {
      latestDecision: input.uxSummary.approval.latestDecision,
    },
    pr: {
      latestStatus: input.uxSummary.pr.latestStatus,
    },
    release: {
      checklistStatus: input.uxSummary.release.checklistStatus,
      latestSignoffDecision: input.uxSummary.release.latestSignoffDecision,
    },
    hardGates: input.uxSummary.hardGates,
  });

  const playbookRecommendations = recommendPlaybooks({
    dangerPoints,
    latestPrReadiness,
    qualityGateFailed: input.uxSummary.qualityGates.failedCount > 0,
    replayStatus: input.uxSummary.replay.status,
    policyStatus: input.uxSummary.policy.status,
  });

  const topDangerTitles = dangerPoints.slice(0, 3).map((point) => point.title);
  const operatorSummary = [
    `Risk: ${sentenceCase(riskClassification.riskLevel)}`,
    topDangerTitles.length > 0
      ? `Top danger points: ${topDangerTitles.join("; ")}.`
      : "No major danger points were detected from the current run signals.",
    escalation.recommendedNextAction,
  ].join(" ");

  const whyThisMatters =
    dangerPoints.length > 0
      ? `This run has ${dangerPoints.length} normalized danger point${dangerPoints.length === 1 ? "" : "s"}, so the operator can see why it is risky before later approval, PR, or release steps.`
      : "This run currently looks routine, but the card still exposes the deterministic reasoning behind that judgment.";

  return {
    dangerPoints,
    riskLevel: riskClassification.riskLevel,
    riskScore: riskClassification.riskScore,
    riskReasons: riskClassification.reasons,
    highestSeverity: riskClassification.highestSeverity,
    changedFileRiskSummary: riskClassification.changedFileRiskSummary,
    confidenceLevel: escalation.confidenceLevel,
    confidenceScore: escalation.confidenceScore,
    escalationLevel: escalation.escalationLevel,
    escalationReason: escalation.escalationReason,
    humanReviewRequired: escalation.humanReviewRequired,
    recommendedNextAction: escalation.recommendedNextAction,
    playbookRecommendations,
    operatorSummary,
    whyThisMatters,
    signalAudit: {
      availableOnRunPage: [
        "task title and description",
        "run state and current step",
        "worker-plan draft and validated worker plan",
        "operation types and allowlisted files",
        "changed files and quality gates",
        "approval report and command-center summary",
        "replay, policy, review, PR, merge, deployment, checklist, sign-off, and audit summaries",
      ],
      derivedLocally: [
        "task intent tags",
        "path-domain risk classification",
        "plan-vs-task mismatch heuristics",
        "freshness checks for evidence, replay, and policy",
        "run risk score and level",
        "confidence and escalation recommendation",
        "future playbook recommendations",
      ],
    },
    technicalDetails: {
      taskSignals: [
        `Task: ${input.task.title}`,
        `Run step: ${input.run.currentStep ?? "unknown"}`,
        `Plan summary: ${planForRisk?.summary ?? "none"}`,
      ],
      verificationSignals: [
        `Quality gates: ${input.uxSummary.qualityGates.passedCount} passed / ${input.uxSummary.qualityGates.failedCount} failed`,
        `Replay: ${input.uxSummary.replay.status ?? "missing"}`,
        `Policy: ${input.uxSummary.policy.status ?? "missing"}`,
      ],
      releaseSignals: [
        `Review: ${input.uxSummary.review.pendingCount} pending / ${input.uxSummary.review.rejectedCount} rejected`,
        `PR status: ${input.uxSummary.pr.latestStatus ?? "not started"}`,
        `Checklist: ${input.uxSummary.release.checklistStatus ?? "not recorded"}`,
        `Sign-off: ${input.uxSummary.release.latestSignoffDecision ?? "missing"}`,
      ],
      derivedNotes: [
        riskClassification.changedFileRiskSummary.summary,
        escalation.escalationReason,
        latestPrReadiness?.recommendedAction ?? "No stored PR readiness recommendation yet.",
      ],
    },
  };
}
