import { buildApprovalReport } from "../approval/approval-report";
import { runPolicyEvaluation } from "../governance/policy-results/policy-result-manager";
import { reconcileReviewStagesAfterPolicy } from "../governance/review-stages/review-stage-integration";
import {
  auditPostChangePipeline,
  auditQualityGatesStarted,
  auditRunFailed,
  auditWorkerPlanExecuted,
  auditWorkerPlanExecutionFailed,
  auditWorkerPlanSubmitted,
  auditWorkerPlanValidated,
  auditWorkerPlanValidationFailed,
} from "../governance/audit-ledger/audit-lifecycle";
import { assessChangedFiles } from "../governance/governance-engine";
import { runQualityGates } from "../quality-gates/quality-gate-runner";
import {
  clearQualityGateResultsForRun,
  getQualityGateResultsForRun,
  getRunById,
  saveApprovalReport,
  saveQualityGateResults,
  updateRun,
} from "../run-manager/run-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getIndexedFilePathSet } from "../repo-intelligence/file-index/file-index-manager";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import type { EngineeringTask, QualityGateResult, WorkerPlanReportSummary } from "../types";
import type { WorkerPlanValidationOptions } from "../worker-plan/worker-plan-types";
import { executeWorkerPlanOperations } from "../worker-plan/worker-plan-executor";
import {
  createWorkerPlanRecord,
  getWorkerPlanById,
  markWorkerPlanExecutionSkipped,
  parseValidationErrors,
  updateWorkerPlanExecution,
  updateWorkerPlanValidation,
  type WorkerPlanRecord,
} from "../worker-plan/worker-plan-manager";
import {
  parseWorkerPlanJson,
  validateWorkerPlan,
} from "../worker-plan/worker-plan-validation";
import type {
  WorkerPlanExecutionResult,
  WorkerPlanValidationResult,
} from "../worker-plan/worker-plan-types";
import {
  checkoutBranch,
  getChangedFiles,
  getDiffSummary,
  verifyGitRepo,
} from "../workspace/git-workspace";
import { resolveRunExecutionPath } from "../workspace/run-worktree";

function nowIso(): string {
  return new Date().toISOString();
}

function validationOptionsWithIndex(
  task: EngineeringTask,
  options: WorkerPlanValidationOptions = {},
): WorkerPlanValidationOptions {
  const merged: WorkerPlanValidationOptions = { ...options };
  if (task.targetRepoPath) {
    merged.scaffoldBaselineRepoPath = task.targetRepoPath;
  }
  if (!task.registeredRepoId) return merged;
  const indexedFilePaths = getIndexedFilePathSet(task.registeredRepoId);
  if (indexedFilePaths.size === 0) return merged;
  return { ...merged, indexedFilePaths };
}

function buildWorkerPlanReportSummary(
  record: WorkerPlanRecord,
  validation: WorkerPlanValidationResult,
  execution: WorkerPlanExecutionResult | null,
): WorkerPlanReportSummary {
  const executionErrors = execution
    ? execution.errors.map((e) => ({ code: e.code, message: e.message }))
    : parseValidationErrors(record.executionErrorsJson).map((e) => ({
        code: e.code,
        message: e.message,
      }));

  let executedOperations: WorkerPlanReportSummary["executedOperations"] = [];
  if (execution) {
    executedOperations = execution.executedOperations.map((op) => ({
      type: op.type,
      path: op.path,
      reason: op.reason,
    }));
  } else {
    try {
      const parsed = JSON.parse(record.executedOperationsJson) as Array<{
        type: string;
        path: string;
        reason: string;
      }>;
      executedOperations = parsed.map((op) => ({
        type: op.type,
        path: op.path,
        reason: op.reason,
      }));
    } catch {
      executedOperations = [];
    }
  }

  return {
    workerPlanId: record.id,
    summary: record.summary,
    validationStatus: record.validationStatus,
    executionStatus: record.executionStatus,
    executedCount: executedOperations.length,
    errorCount: validation.errors.length + (execution?.errors.length ?? 0),
    executedOperations,
    validationErrors: validation.errors.map((e) => ({
      code: e.code,
      message: e.message,
    })),
    executionErrors,
  };
}

export interface SubmitAndExecuteWorkerPlanOptions extends WorkerPlanValidationOptions {
  /** When true, QC/validation/execution failure is an iteration observation, not RUN_FAILED. */
  iterationMode?: boolean;
  iterationNumber?: number;
  repoPathOverride?: string;
}

export type WorkerPlanIterationOutcome =
  | "completed"
  | "iteration_failed"
  | "terminal_failed";

async function recordPostChangeEvidence(
  runId: string,
  workerPlanSummary: WorkerPlanReportSummary | null,
  repoPath: string,
  options: { iterationMode: boolean },
): Promise<{
  gatesFailed: boolean;
  governanceBlocked: boolean;
  qualityGates: QualityGateResult[];
}> {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found: ${run.taskId}`);
  }

  updateRun(runId, {
    status: "running_quality_gates",
    currentStep: "running_quality_gates",
  });

  const workerPlanPaths =
    workerPlanSummary?.executedOperations.map((op) => op.path) ?? [];
  const changedFiles = await getChangedFiles(repoPath, { workerPlanPaths });
  const diffSummary = await getDiffSummary(repoPath, { changedFiles });
  const governance = assessChangedFiles(changedFiles);

  auditQualityGatesStarted(runId, task.id);
  clearQualityGateResultsForRun(runId);
  const gateResults = await runQualityGates({
    repoPath,
    registeredRepoId: task.registeredRepoId,
  });
  saveQualityGateResults(runId, gateResults);

  const gatesFailed = gateResults.some((g) => g.status === "failed");
  const governanceBlocked = governance.riskLevel === "blocked";

  const reportStatus = options.iterationMode
    ? gatesFailed || governanceBlocked
      ? "diagnosing"
      : "running_quality_gates"
    : gatesFailed || governanceBlocked
      ? "failed"
      : "waiting_for_approval";

  if (!options.iterationMode) {
    updateRun(runId, {
      status: reportStatus as "failed" | "waiting_for_approval",
      currentStep: reportStatus,
      riskLevel: governance.riskLevel,
      governanceNotes: JSON.stringify(governance),
      completedAt: reportStatus === "failed" ? nowIso() : null,
    });
  } else {
    updateRun(runId, {
      currentStep: gatesFailed ? "iteration_qc_failed" : "iteration_qc_passed",
      riskLevel: governance.riskLevel,
      governanceNotes: JSON.stringify(governance),
    });
  }

  const updatedRun = getRunById(runId)!;
  const storedGates = getQualityGateResultsForRun(runId);
  const report = buildApprovalReport({
    task,
    run: updatedRun,
    changedFiles,
    diffSummary,
    governance,
    qualityGateResults: storedGates,
    workerPlan: workerPlanSummary,
  });
  saveApprovalReport(runId, JSON.stringify(report));

  auditPostChangePipeline(runId, task.id, {
    governance: {
      riskLevel: governance.riskLevel,
      canApprove: governance.canApprove,
      issueCount: governance.issues.length,
    },
    gateSummary: {
      total: gateResults.length,
      failed: gateResults.filter((g) => g.status === "failed").length,
      passed: gateResults.filter((g) => g.status === "passed").length,
      skipped: gateResults.filter((g) => g.status === "skipped").length,
    },
    finalRunStatus: reportStatus,
    changedFileCount: changedFiles.length,
    canApprove: report.canApprove,
  });

  runPolicyEvaluation(runId, { persist: true, audit: true });

  await reconcileReviewStagesAfterPolicy(runId, {
    changedFiles,
    diffSummary,
    workerPlanSummary,
  });

  if (!options.iterationMode) {
    if (reportStatus === "waiting_for_approval") {
      updateTask(task.id, { status: "waiting_for_approval" });
    } else {
      updateTask(task.id, { status: "failed" });
    }
  }

  return { gatesFailed, governanceBlocked, qualityGates: storedGates };
}

async function refreshEvidenceForFailedWorkerPlan(
  runId: string,
  workerPlanSummary: WorkerPlanReportSummary,
): Promise<void> {
  runPolicyEvaluation(runId, { persist: true, audit: true });
  await reconcileReviewStagesAfterPolicy(runId, { workerPlanSummary });
}

export interface WorkerPlanSubmissionResult {
  workerPlanId: string;
  validation: WorkerPlanValidationResult;
  execution: WorkerPlanExecutionResult | null;
  runStatus: string;
  workerPlanSummary: WorkerPlanReportSummary;
  iterationOutcome: WorkerPlanIterationOutcome;
  qualityGatesFailed: boolean;
  governanceBlocked: boolean;
}

export async function submitAndExecuteWorkerPlan(
  runId: string,
  rawPlan: unknown,
  options: SubmitAndExecuteWorkerPlanOptions = {},
): Promise<WorkerPlanSubmissionResult> {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found: ${run.taskId}`);
  }

  const iterationMode = options.iterationMode === true;
  const repoPath =
    options.repoPathOverride ??
    resolveRunExecutionPath(runId, resolveTaskTargetRepoPath(task));

  await verifyGitRepo(repoPath);

  if (run.branchName && !options.repoPathOverride) {
    try {
      await checkoutBranch(repoPath, run.branchName);
    } catch {
      // Branch checkout may fail if already on branch; execution continues
    }
  }

  const parsed = parseWorkerPlanJson(rawPlan);
  if (!parsed.plan) {
    const validation: WorkerPlanValidationResult = {
      valid: false,
      errors: parsed.errors,
      warnings: [],
      normalizedOperations: [],
    };
    const placeholderPlan = {
      runId,
      summary: "",
      allowedFiles: [] as string[],
      operations: [],
    };
    const record = createWorkerPlanRecord(runId, placeholderPlan, {
      iterationNumber: options.iterationNumber,
    });
    updateWorkerPlanValidation(record.id, validation);
    markWorkerPlanExecutionSkipped(record.id);
    auditWorkerPlanValidationFailed(runId, task.id, record.id, {
      errorCount: validation.errors.length,
    });
    if (!iterationMode) {
      updateRun(runId, {
        status: "failed",
        currentStep: "worker_plan_validation_failed",
        completedAt: nowIso(),
      });
      updateTask(task.id, { status: "failed" });
      auditRunFailed(runId, task.id, { reason: "worker_plan_parse_failed" });
    } else {
      updateRun(runId, {
        currentStep: "worker_plan_parse_failed",
      });
    }

    const summary = buildWorkerPlanReportSummary(record, validation, null);
    await refreshEvidenceForFailedWorkerPlan(runId, summary);
    return {
      workerPlanId: record.id,
      validation,
      execution: null,
      runStatus: getRunById(runId)?.status ?? (iterationMode ? run.status : "failed"),
      workerPlanSummary: summary,
      iterationOutcome: iterationMode ? "iteration_failed" : "terminal_failed",
      qualityGatesFailed: false,
      governanceBlocked: false,
    };
  }

  const record = createWorkerPlanRecord(runId, parsed.plan, {
    iterationNumber: options.iterationNumber,
  });
  auditWorkerPlanSubmitted(runId, task.id, record.id);
  const validation = validateWorkerPlan(
    parsed.plan,
    repoPath,
    runId,
    validationOptionsWithIndex(task, options),
  );
  updateWorkerPlanValidation(record.id, validation);

  if (!validation.valid) {
    markWorkerPlanExecutionSkipped(record.id);
    auditWorkerPlanValidationFailed(runId, task.id, record.id, {
      errorCount: validation.errors.length,
    });
    if (!iterationMode) {
      updateRun(runId, {
        status: "failed",
        currentStep: "worker_plan_validation_failed",
        agentMessage: "Worker plan validation failed",
        completedAt: nowIso(),
      });
      updateTask(task.id, { status: "failed" });
      auditRunFailed(runId, task.id, { reason: "worker_plan_validation_failed" });
    } else {
      updateRun(runId, {
        currentStep: "worker_plan_validation_failed",
        agentMessage: "Worker plan validation failed (iteration)",
      });
    }

    const summary = buildWorkerPlanReportSummary(record, validation, null);
    await refreshEvidenceForFailedWorkerPlan(runId, summary);
    return {
      workerPlanId: record.id,
      validation,
      execution: null,
      runStatus: getRunById(runId)?.status ?? (iterationMode ? run.status : "failed"),
      workerPlanSummary: summary,
      iterationOutcome: iterationMode ? "iteration_failed" : "terminal_failed",
      qualityGatesFailed: false,
      governanceBlocked: false,
    };
  }

  auditWorkerPlanValidated(runId, task.id, record.id, {
    operationCount: validation.normalizedOperations.length,
  });

  updateRun(runId, {
    status: "validating_worker_plan",
    currentStep: "validating_worker_plan",
    agentMessage: parsed.plan.summary,
  });
  updateTask(task.id, { status: "running" });

  updateRun(runId, {
    status: "executing_worker_plan",
    currentStep: "executing_worker_plan",
  });

  const execution = executeWorkerPlanOperations(
    repoPath,
    validation.normalizedOperations,
  );
  updateWorkerPlanExecution(record.id, execution);

  const updatedRecord = getWorkerPlanById(record.id)!;
  const summary = buildWorkerPlanReportSummary(updatedRecord, validation, execution);

  if (!execution.success) {
    auditWorkerPlanExecutionFailed(runId, task.id, record.id, {
      errorCount: execution.errors.length,
      executedCount: execution.executedOperations.length,
    });
    if (!iterationMode) {
      updateRun(runId, {
        status: "failed",
        currentStep: "worker_plan_execution_failed",
        agentMessage: "Worker plan execution failed",
        completedAt: nowIso(),
      });
      updateTask(task.id, { status: "failed" });
      auditRunFailed(runId, task.id, { reason: "worker_plan_execution_failed" });
    } else {
      updateRun(runId, {
        currentStep: "worker_plan_execution_failed",
        agentMessage: "Worker plan execution failed (iteration)",
      });
    }
    await refreshEvidenceForFailedWorkerPlan(runId, summary);
    return {
      workerPlanId: record.id,
      validation,
      execution,
      runStatus: getRunById(runId)?.status ?? (iterationMode ? run.status : "failed"),
      workerPlanSummary: summary,
      iterationOutcome: iterationMode ? "iteration_failed" : "terminal_failed",
      qualityGatesFailed: false,
      governanceBlocked: false,
    };
  }

  auditWorkerPlanExecuted(runId, task.id, record.id, {
    executedCount: execution.executedOperations.length,
    changedFiles: execution.changedFiles,
  });

  const post = await recordPostChangeEvidence(runId, summary, repoPath, { iterationMode });
  const finalRun = getRunById(runId);

  let iterationOutcome: WorkerPlanIterationOutcome = "completed";
  if (post.gatesFailed || post.governanceBlocked) {
    iterationOutcome = iterationMode ? "iteration_failed" : "terminal_failed";
  }

  return {
    workerPlanId: record.id,
    validation,
    execution,
    runStatus: finalRun?.status ?? (iterationMode ? "running_quality_gates" : "waiting_for_approval"),
    workerPlanSummary: summary,
    iterationOutcome,
    qualityGatesFailed: post.gatesFailed,
    governanceBlocked: post.governanceBlocked,
  };
}
