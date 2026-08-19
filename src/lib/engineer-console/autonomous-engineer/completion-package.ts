import { getApprovalReportJson, getQualityGateResultsForRun, getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { listWorkerPlansForRun } from "../worker-plan/worker-plan-manager";
import { getRunWorktree } from "../workspace/run-worktree";
import { getAutonomousState } from "./state-store";
import { remainingBudget } from "./budget";

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
  };
}
