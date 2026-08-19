import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { generateAndPersistWorkerPlanDraft } from "../model-router/worker-plan-draft-generator";
import { submitAndExecuteWorkerPlan } from "../orchestrator/worker-plan-orchestrator";
import { getQualityGateResultsForRun, getRunById, updateRun } from "../run-manager/run-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import type { RunStatus } from "../types";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { getChangedFiles, getDiffSummary } from "../workspace/git-workspace";
import { createIsolatedRunWorktree } from "../workspace/run-worktree";
import { auditAutonomousEvent } from "./audit";
import { assertExecutorCannotSelfAuthorize } from "./authority";
import { BudgetExhaustedError, checkBudget, wouldExceedBudget } from "./budget";
import { evaluateCompletion } from "./completion-evaluator";
import { diagnoseIterationFailure } from "./diagnosis";
import { classifyAutonomousFailure, isTerminalFailureClass } from "./failure-classification";
import { defaultInvestigationOperations, runInvestigation } from "./investigation";
import { interpretObjective } from "./objective-interpreter";
import { reviewsHaveActionableDefects, runAutonomousReviews } from "./reviews";
import { autonomousStateToRunStatus, isPausedAutonomousState, isTerminalAutonomousState } from "./state-machine";
import {
  getAutonomousState,
  persistAutonomousDocument,
  transitionAutonomousState,
} from "./state-store";
import type {
  AutonomousDocument,
  AutonomousFailureClass,
  AutonomousLoopResult,
  AutonomousState,
} from "./types";

export interface AutonomousLoopDependencies {
  generatePlan?: (input: {
    runId: string;
    document: AutonomousDocument;
    repoPath: string;
  }) => Promise<WorkerPlan>;
  now?: () => Date;
}

function nowIso(deps: AutonomousLoopDependencies): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

function syncRun(runId: string, document: AutonomousDocument, extra: { agentMessage?: string } = {}): void {
  const status = autonomousStateToRunStatus(document.currentState) as RunStatus;
  updateRun(runId, {
    status,
    currentStep: document.currentState,
    agentMessage: extra.agentMessage ?? document.strategy,
  });
}

function pauseResult(
  runId: string,
  document: AutonomousDocument,
  message: string,
): AutonomousLoopResult {
  return {
    runId,
    state: document.currentState,
    failureClass: document.failureClass,
    deliveryCandidateStatus: document.deliveryCandidateStatus,
    paused: true,
    message,
  };
}

function terminalResult(
  runId: string,
  document: AutonomousDocument,
  message: string,
): AutonomousLoopResult {
  return {
    runId,
    state: document.currentState,
    failureClass: document.failureClass,
    deliveryCandidateStatus: document.deliveryCandidateStatus,
    paused: false,
    message,
  };
}

function runtimeUsage(document: AutonomousDocument, deps: AutonomousLoopDependencies): number {
  const started = Date.parse(document.startedAt);
  return Math.max(0, (deps.now ?? (() => new Date()))().getTime() - started);
}

async function generatePlanForIteration(
  runId: string,
  document: AutonomousDocument,
  repoPath: string,
  deps: AutonomousLoopDependencies,
): Promise<WorkerPlan> {
  if (deps.generatePlan) {
    return deps.generatePlan({ runId, document, repoPath });
  }

  const diagnosisHint = document.diagnosis
    ? [
        `Previous iteration failed: ${document.diagnosis.whyPreviousFailed}`,
        `Suggested strategy: ${document.diagnosis.suggestedStrategy}`,
        "Produce a revised worker plan that addresses the failure. Do not repeat the failed hypothesis.",
      ]
    : [];

  const draft = await generateAndPersistWorkerPlanDraft(runId, {
    constraints: [...document.constraints, ...diagnosisHint],
    allowedFiles: document.authorizedPathPrefixes,
    includeFileContents: document.observations
      .flatMap((obs) => obs.paths ?? [])
      .slice(0, 8),
  });
  document.usage.modelCalls += 1;

  if (!draft.draft.parsedPlanJson) {
    throw Object.assign(new Error(draft.parseErrors.join("; ") || "Model output was not a worker plan"), {
      failureClass: "MODEL_OUTPUT_FAILURE" as const,
    });
  }
  const parsed = JSON.parse(draft.draft.parsedPlanJson) as WorkerPlan;
  parsed.runId = runId;
  return parsed;
}

function applyTerminal(
  document: AutonomousDocument,
  state: AutonomousState,
  failureClass: AutonomousFailureClass | null,
  message: string,
): AutonomousDocument {
  document.currentState = state;
  document.failureClass = failureClass;
  document.escalationReason = message;
  if (state === "exhausted" || state === "failed" || state === "aborted") {
    document.deliveryCandidateStatus = "blocked";
  }
  return document;
}

export async function executeAutonomousLoop(
  runId: string,
  deps: AutonomousLoopDependencies = {},
): Promise<AutonomousLoopResult> {
  const run = getRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const task = getTaskById(run.taskId);
  if (!task) throw new Error(`Task not found: ${run.taskId}`);

  const record = getAutonomousState(runId);
  if (!record) throw new Error(`Autonomous state not found for run ${runId}`);
  let document = record.document;

  const selfAuth = assertExecutorCannotSelfAuthorize(document.authorityEnvelope, "approve_run");
  document.decisions.push({
    at: nowIso(deps),
    kind: "authority",
    summary: selfAuth.reason,
    rationale: "Executor cannot self-authorize PR/merge/deploy/approval.",
  });

  if (isTerminalAutonomousState(document.currentState)) {
    return terminalResult(runId, document, `Already terminal: ${document.currentState}`);
  }
  if (isPausedAutonomousState(document.currentState) && !document.clarification?.answer) {
    return pauseResult(runId, document, document.clarification?.question ?? "Waiting for director.");
  }

  const liveRepoPath = resolveTaskTargetRepoPath(task);
  const worktree = await createIsolatedRunWorktree({
    runId,
    taskId: task.id,
    repoPath: liveRepoPath,
  });
  document.worktreeId = worktree.id;
  updateRun(runId, { branchName: worktree.branchName });
  auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_WORKTREE_CREATED, runId, task.id, {
    worktreePath: worktree.worktreePath,
    branchName: worktree.branchName,
    baseRevision: worktree.baseRevision,
  });

  const repoPath = worktree.worktreePath;
  auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_RUN_STARTED, runId, task.id, {
    mode: document.mode,
    objective: document.originalObjective,
  });

  const loopGuard = document.budget.max_iterations * 4 + 8;
  let steps = 0;

  while (!isTerminalAutonomousState(document.currentState) && steps < loopGuard) {
    steps += 1;
    document.usage.runtimeMs = runtimeUsage(document, deps);

    try {
      checkBudget(document.budget, document.usage, "runtimeMs");
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        document = applyTerminal(document, "exhausted", "BUDGET_EXHAUSTED", error.message);
        persistAndSync(runId, document, task.id);
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_BUDGET_EXHAUSTED, runId, task.id, {
          dimension: error.dimension,
        });
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, error.message);
      }
      throw error;
    }

    if (document.currentState === "created") {
      document = transitionAutonomousState(runId, "investigating", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "investigating") {
      const investigation = await runInvestigation(
        {
          repoPath,
          registeredRepoId: task.registeredRepoId,
          envelope: document.authorityEnvelope,
          budget: document.budget,
          usage: document.usage,
          taskSearchTerms: [task.title, document.originalObjective],
        },
        defaultInvestigationOperations(document.originalObjective),
      );
      document.usage = investigation.usage;
      document.observations.push(...investigation.observations);
      auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_INVESTIGATION, runId, task.id, {
        observationCount: investigation.observations.length,
      });
      document = transitionAutonomousState(runId, "interpreting", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "interpreting") {
      const investigationSnapshot = {
        observations: document.observations,
        packageScripts: {},
        fileTree: document.observations.find((obs) => obs.operation === "list_tree")?.paths ?? [],
        fileContents: [] as Array<{ path: string; content: string }>,
        gitStatus: "",
        gitLog: "",
        contextSummary: document.observations.map((obs) => obs.summary).join("\n"),
        usage: document.usage,
      };
      const interpretation = interpretObjective({
        objective: document.originalObjective,
        acceptanceCriteria: document.acceptanceCriteria,
        constraints: document.constraints,
        investigation: investigationSnapshot,
      });
      document.interpretedObjective = interpretation;
      document.requirements = interpretation.requirements;
      document.acceptanceCriteria = interpretation.acceptanceCriteria;
      document.assumptions = interpretation.assumptions;

      const governanceUnknown = interpretation.unknowns.find(
        (item) => item.classification === "governance" && !item.resolved,
      );
      if (governanceUnknown) {
        document.escalationReason = governanceUnknown.reason;
        document = applyTerminal(
          document,
          "failed",
          "GOVERNANCE_AUTHORIZATION_REQUIRED",
          governanceUnknown.reason,
        );
        persistAndSync(runId, document, task.id);
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_GOVERNANCE_BLOCKED, runId, task.id, {
          unknown: governanceUnknown.statement,
        });
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, governanceUnknown.reason);
      }

      const directorUnknown = interpretation.unknowns.find(
        (item) => item.classification === "director" && !item.resolved,
      );
      if (directorUnknown) {
        document.clarification = {
          question: directorUnknown.statement,
          context: directorUnknown.reason,
          askedAt: nowIso(deps),
          answer: document.clarification?.answer ?? null,
          answeredAt: document.clarification?.answeredAt ?? null,
          answeredBy: document.clarification?.answeredBy ?? null,
        };
        if (!document.clarification.answer) {
          document.pausedAt = nowIso(deps);
          document = transitionAutonomousState(runId, "waiting_for_director", document).document;
          persistAndSync(runId, document, task.id);
          auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_CLARIFICATION_REQUESTED, runId, task.id, {
            question: directorUnknown.statement,
          });
          return pauseResult(runId, document, directorUnknown.statement);
        }
      }

      document = transitionAutonomousState(runId, "planning", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "waiting_for_director") {
      if (!document.clarification?.answer) {
        return pauseResult(runId, document, document.clarification?.question ?? "Waiting for director.");
      }
      document.pausedAt = null;
      document = transitionAutonomousState(runId, "planning", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "planning") {
      if (wouldExceedBudget(document.budget, document.usage, "iterations", 1)) {
        document = applyTerminal(
          document,
          "exhausted",
          "BUDGET_EXHAUSTED",
          "Iteration budget exhausted before planning.",
        );
        persistAndSync(runId, document, task.id);
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, "Iteration budget exhausted.");
      }
      document.iterationNumber += 1;
      document.usage.iterations += 1;
      document.strategy =
        document.diagnosis?.suggestedStrategy ??
        `Iteration ${document.iterationNumber}: implement interpreted requirements via worker plan.`;

      let plan: WorkerPlan;
      try {
        checkBudget(document.budget, document.usage, "modelCalls", deps.generatePlan ? 0 : 1);
        checkBudget(document.budget, document.usage, "plans", 1);
        plan = await generatePlanForIteration(runId, document, repoPath, deps);
      } catch (error) {
        const failureClass =
          error instanceof BudgetExhaustedError
            ? "BUDGET_EXHAUSTED"
            : ((error as { failureClass?: AutonomousFailureClass }).failureClass ?? "MODEL_OUTPUT_FAILURE");
        if (failureClass === "BUDGET_EXHAUSTED" || isTerminalFailureClass(failureClass)) {
          document = applyTerminal(
            document,
            failureClass === "BUDGET_EXHAUSTED" ? "exhausted" : "failed",
            failureClass,
            error instanceof Error ? error.message : String(error),
          );
          persistAndSync(runId, document, task.id);
          updateTask(task.id, { status: "failed" });
          return terminalResult(runId, document, document.escalationReason ?? "Planning failed.");
        }
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          validationErrors: [error instanceof Error ? error.message : String(error)],
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      document.usage.plans += 1;
      document = transitionAutonomousState(runId, "validating", { ...document, strategy: plan.summary }).document;
      syncRun(runId, document, { agentMessage: plan.summary });

      const submission = await submitAndExecuteWorkerPlan(runId, plan, {
        iterationMode: true,
        iterationNumber: document.iterationNumber,
        repoPathOverride: repoPath,
      });

      document.previousPlanId = document.currentPlanId;
      document.currentPlanId = submission.workerPlanId;

      const qc = getQualityGateResultsForRun(runId);
      const failedCommands = qc.filter((gate) => gate.status === "failed").map((gate) => gate.command);
      const qcSummary = failedCommands.length
        ? `Failed gates: ${failedCommands.join(", ")}`
        : "Quality gates passed or skipped.";
      document.qcObservations.push({
        iteration: document.iterationNumber,
        at: nowIso(deps),
        passed: !submission.qualityGatesFailed,
        failedCommands,
        summary: qcSummary,
      });

      const changedFiles = submission.execution?.changedFiles ?? [];
      document.usage.changedFiles = Math.max(document.usage.changedFiles, changedFiles.length);
      const changedBytes = (plan.operations ?? []).reduce((sum, op) => sum + (op.content?.length ?? 0), 0);
      document.usage.changedBytes += changedBytes;

      if (!submission.validation.valid) {
        const failureClass = classifyAutonomousFailure({
          workerPlanValidationFailed: true,
          workerPlanParseFailed: submission.validation.errors.some((err) => err.code === "PARSE_FAILED"),
        });
        document.priorAttempts.push({
          iteration: document.iterationNumber,
          workerPlanId: submission.workerPlanId,
          strategy: document.strategy ?? plan.summary,
          outcome: "failed",
          failureClass,
          summary: submission.validation.errors.map((err) => err.message).join("; "),
        });
        document.failedHypotheses.push({
          iteration: document.iterationNumber,
          hypothesis: plan.summary,
          whyFailed: submission.validation.errors.map((err) => err.message).join("; "),
        });
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          validationErrors: submission.validation.errors.map((err) => err.message),
        });
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ITERATION_FAILED, runId, task.id, {
          iteration: document.iterationNumber,
          failureClass,
          workerPlanId: submission.workerPlanId,
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      if (!submission.execution?.success) {
        const failureClass = classifyAutonomousFailure({ workerPlanExecutionFailed: true });
        document.priorAttempts.push({
          iteration: document.iterationNumber,
          workerPlanId: submission.workerPlanId,
          strategy: document.strategy ?? plan.summary,
          outcome: "failed",
          failureClass,
          summary: submission.execution?.errors.map((err) => err.message).join("; ") ?? "execution failed",
        });
        document.failedHypotheses.push({
          iteration: document.iterationNumber,
          hypothesis: plan.summary,
          whyFailed: submission.execution?.errors.map((err) => err.message).join("; ") ?? "execution failed",
        });
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          executionErrors: submission.execution?.errors.map((err) => err.message),
        });
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ITERATION_FAILED, runId, task.id, {
          iteration: document.iterationNumber,
          failureClass,
          workerPlanId: submission.workerPlanId,
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      if (submission.governanceBlocked) {
        document = applyTerminal(
          document,
          "failed",
          "POLICY_BLOCK",
          "Governance blocked protected-path changes.",
        );
        persistAndSync(runId, document, task.id);
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, "POLICY_BLOCK");
      }

      if (submission.qualityGatesFailed || submission.iterationOutcome === "iteration_failed") {
        const failureClass = classifyAutonomousFailure({ qualityGatesFailed: true });
        document.priorAttempts.push({
          iteration: document.iterationNumber,
          workerPlanId: submission.workerPlanId,
          strategy: document.strategy ?? plan.summary,
          outcome: "failed",
          failureClass,
          summary: qcSummary,
          qcSummary,
        });
        document.failedHypotheses.push({
          iteration: document.iterationNumber,
          hypothesis: plan.summary,
          whyFailed: qcSummary,
        });
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          qcSummary,
        });
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ITERATION_FAILED, runId, task.id, {
          iteration: document.iterationNumber,
          failureClass,
          workerPlanId: submission.workerPlanId,
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      document.priorAttempts.push({
        iteration: document.iterationNumber,
        workerPlanId: submission.workerPlanId,
        strategy: document.strategy ?? plan.summary,
        outcome: "passed",
        failureClass: null,
        summary: "Worker plan executed and quality gates passed.",
        qcSummary,
      });
      document = transitionAutonomousState(runId, "quality_checking", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "quality_checking") {
      document = transitionAutonomousState(runId, "reviewing", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "diagnosing") {
      auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_DIAGNOSIS, runId, task.id, {
        iteration: document.iterationNumber,
        diagnosis: document.diagnosis?.summary,
        why: document.diagnosis?.whyPreviousFailed,
      });
      if (wouldExceedBudget(document.budget, document.usage, "iterations", 1)) {
        document = applyTerminal(
          document,
          "exhausted",
          "BUDGET_EXHAUSTED",
          "No remaining iterations after diagnosis.",
        );
        persistAndSync(runId, document, task.id);
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, "Budget exhausted after diagnosis.");
      }
      document = transitionAutonomousState(runId, "planning", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "reviewing") {
      const changedFiles = await getChangedFiles(repoPath);
      const diffSummary = await getDiffSummary(repoPath, { changedFiles });
      const reviews = runAutonomousReviews({
        document,
        changedFiles,
        diffSummary,
        qcPassed: true,
      });
      document.reviews = reviews;
      if (reviewsHaveActionableDefects(reviews)) {
        document.unresolvedDefects = reviews.flatMap((review) =>
          review.actionableDefects.map((summary) => ({
            id: `${review.review}-${document.iterationNumber}`,
            source: "review" as const,
            severity: "blocker" as const,
            summary,
            actionable: true,
          })),
        );
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass: "ENGINEERING_FAILURE",
          qcSummary: reviews.flatMap((review) => review.actionableDefects).join("; "),
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }
      document = transitionAutonomousState(runId, "evaluating_completion", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "evaluating_completion") {
      const changedFiles = await getChangedFiles(repoPath);
      const evaluation = evaluateCompletion({
        document,
        qcPassed: true,
        changedFiles,
        reviews: document.reviews,
      });
      document.completionEvaluation = evaluation;
      if (!evaluation.complete) {
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass: "ENGINEERING_FAILURE",
          qcSummary: [...evaluation.unmetAcceptanceCriteria, ...evaluation.defectsBlocking].join("; "),
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      document.deliveryCandidateStatus = "ready";
      document = transitionAutonomousState(runId, "waiting_for_approval", document).document;
      persistAndSync(runId, document, task.id);
      updateTask(task.id, { status: "waiting_for_approval" });
      auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_DELIVERY_CANDIDATE, runId, task.id, {
        iteration: document.iterationNumber,
        planId: document.currentPlanId,
      });
      return terminalResult(runId, document, "Delivery candidate ready for human release decision.");
    }
  }

  document = applyTerminal(document, "exhausted", "BUDGET_EXHAUSTED", "Control loop step budget exhausted.");
  persistAndSync(runId, document, task.id);
  updateTask(task.id, { status: "failed" });
  return terminalResult(runId, document, "Control loop exhausted.");
}

function persistAndSync(runId: string, document: AutonomousDocument, taskId: string): void {
  persistAutonomousDocument(runId, document);
  syncRun(runId, document);
  auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_STATE_TRANSITION, runId, taskId, {
    state: document.currentState,
    iteration: document.iterationNumber,
    failureClass: document.failureClass,
  });
}
