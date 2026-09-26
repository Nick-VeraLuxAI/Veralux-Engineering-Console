import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { listWorkerPlansForRun } from "../worker-plan/worker-plan-manager";
import { getRunWorktree } from "../workspace/run-worktree";
import { getAutonomousState } from "./state-store";
import { remainingBudget } from "./budget";

export type ObjectiveResult = "SATISFIED" | "PARTIAL" | "BLOCKED" | "EXHAUSTED" | "FAILED";
export type DirectorNextAction =
  | "Authorize PR"
  | "inspect evidence"
  | "request changes"
  | "answer clarification"
  | "wait";

function objectiveResultFor(state: string, delivery: string | null): ObjectiveResult {
  if (state === "waiting_for_approval" && delivery === "ready") return "SATISFIED";
  if (state === "exhausted") return "EXHAUSTED";
  if (state === "aborted") return "BLOCKED";
  if (state === "failed") return "FAILED";
  if (state === "waiting_for_director") return "PARTIAL";
  return "PARTIAL";
}

function nextActionFor(state: string, delivery: string | null): DirectorNextAction {
  if (state === "waiting_for_director") return "answer clarification";
  if (state === "waiting_for_approval" && delivery === "ready") return "Authorize PR";
  if (state === "failed" || state === "exhausted" || state === "aborted") return "inspect evidence";
  if (state === "diagnosing" || state === "planning") return "wait";
  return "inspect evidence";
}

export function getAutonomousCompletionPackage(runId: string) {
  const run = getRunById(runId);
  if (!run) return null;
  const task = getTaskById(run.taskId);
  if (!task) return null;
  const autonomous = getAutonomousState(runId);
  if (!autonomous) return null;

  const document = autonomous.document;
  const worktree = getRunWorktree(runId);
  const plans = listWorkerPlansForRun(runId);
  const qualityGates = getQualityGateResultsForRun(runId);
  const approvalReportJson = getApprovalReportJson(runId);
  const delta = document.qcDelta;
  const objectiveResult = objectiveResultFor(autonomous.currentState, document.deliveryCandidateStatus);
  const newRegressions = (delta?.newFailures ?? []).concat(delta?.changedFailures ?? []);
  const preExisting = delta?.preExistingFailures ?? [];

  const director = {
    objectiveResult,
    whatItIsDoing: document.strategy ?? autonomous.currentState,
    needsDirector: autonomous.currentState === "waiting_for_director",
    finished: autonomous.currentState === "waiting_for_approval" && document.deliveryCandidateStatus === "ready",
    qcVersusBaseline: {
      baselineFailureCount: document.qcBaseline?.failures.length ?? 0,
      postFailureCount: delta ? delta.findings.filter((item) => item.currentFingerprint).length : null,
      newRegressions: newRegressions.map((item) => item.identity.name),
      preExistingFailures: preExisting.map((item) => item.identity.name),
      resolved: (delta?.resolvedBaselineFailures ?? []).map((item) => item.identity.name),
      objectiveQcPassed: delta?.objectiveQcPassed ?? null,
    },
    whatChanged: plans.flatMap((plan) => [`plan ${plan.iterationNumber}: ${plan.summary}`]),
    risks: document.openRisks.map((risk) => risk.summary),
    decision: document.completionEvaluation?.summary ?? document.escalationReason ?? autonomous.currentState,
    nextAction: nextActionFor(autonomous.currentState, document.deliveryCandidateStatus),
    iterations: document.iterationNumber,
    reviews: document.reviews.map((review) => ({
      review: review.review,
      passed: review.passed,
    })),
    remainingRisk: document.openRisks.map((risk) => risk.summary),
  };

  return {
    runId,
    taskId: task.id,
    mode: document.mode,
    version: document.version,
    status: autonomous.currentState,
    runStatus: run.status,
    iteration: {
      current: document.iterationNumber,
      max: document.budget.max_iterations,
    },
    budgetRemaining: remainingBudget(document.budget, document.usage),
    usage: document.usage,
    objective: document.originalObjective,
    interpretation: document.interpretedObjective,
    authorityEnvelope: document.authorityEnvelope,
    worktree: worktree
      ? {
          path: worktree.worktreePath,
          branchName: worktree.branchName,
          baseRevision: worktree.baseRevision,
          status: worktree.status,
        }
      : null,
    strategy: document.strategy,
    observations: document.observations,
    priorAttempts: document.priorAttempts,
    failedHypotheses: document.failedHypotheses,
    diagnosis: document.diagnosis,
    qcObservations: document.qcObservations,
    qcBaseline: document.qcBaseline,
    qcDelta: document.qcDelta,
    workerModel: document.workerModel,
    reviews: document.reviews,
    unresolvedDefects: document.unresolvedDefects,
    openRisks: document.openRisks,
    clarification: document.clarification,
    completionEvaluation: document.completionEvaluation,
    deliveryCandidateStatus: document.deliveryCandidateStatus,
    currentPlanId: document.currentPlanId,
    previousPlanId: document.previousPlanId,
    workerPlans: plans.map((plan) => ({
      id: plan.id,
      summary: plan.summary,
      iterationNumber: plan.iterationNumber,
      validationStatus: plan.validationStatus,
      executionStatus: plan.executionStatus,
    })),
    qualityGates: qualityGates.map((gate) => ({
      command: gate.command,
      status: gate.status,
      exitCode: gate.exitCode,
    })),
    approvalReport: approvalReportJson ? JSON.parse(approvalReportJson) : null,
    failureClass: document.failureClass,
    escalationReason: document.escalationReason,
    directorAbortReason: document.directorAbortReason,
    humanGatesRemaining: ["approve_run", "create_pr", "merge", "deploy", "sign_off"],
    director,
  };
}

export function getAutonomousProgress(runId: string) {
  const pkg = getAutonomousCompletionPackage(runId);
  if (!pkg) return null;
  return {
    runId: pkg.runId,
    taskId: pkg.taskId,
    state: pkg.status,
    runStatus: pkg.runStatus,
    iteration: pkg.iteration,
    strategy: pkg.strategy,
    deliveryCandidateStatus: pkg.deliveryCandidateStatus,
    clarification: pkg.clarification,
    failureClass: pkg.failureClass,
    escalationReason: pkg.escalationReason,
    worktree: pkg.worktree,
    priorAttemptCount: pkg.priorAttempts.length,
    currentPlanId: pkg.currentPlanId,
    director: pkg.director,
    qcBaseline: pkg.qcBaseline,
    qcDelta: pkg.qcDelta,
    workerModel: pkg.workerModel,
  };
}
