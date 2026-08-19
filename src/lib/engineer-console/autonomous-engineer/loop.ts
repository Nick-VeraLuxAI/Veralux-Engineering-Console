import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { generateAndPersistWorkerPlanDraft } from "../model-router/worker-plan-draft-generator";
import { getPublicModelProviderInfo } from "../model-router/model-provider-config";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import { submitAndExecuteWorkerPlan } from "../orchestrator/worker-plan-orchestrator";
import { runQualityGates, type QualityGateCommandResult } from "../quality-gates/quality-gate-runner";
import { getQualityGateResultsForRun, getRunById, updateRun } from "../run-manager/run-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import type { RunStatus } from "../types";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { getChangedFiles, getDiffSummary } from "../workspace/git-workspace";
import { createIsolatedRunWorktree } from "../workspace/run-worktree";
import { auditAutonomousEvent } from "./audit";
import { assertExecutorCannotSelfAuthorize, isPathAuthorized } from "./authority";
import { BudgetExhaustedError, checkBudget, wouldExceedBudget } from "./budget";
import { evaluateCompletion } from "./completion-evaluator";
import { diagnoseIterationFailure } from "./diagnosis";
import { classifyAutonomousFailure, isTerminalFailureClass } from "./failure-classification";
import { defaultInvestigationOperations, runInvestigation } from "./investigation";
import { interpretObjective } from "./objective-interpreter";
import {
  compareQcToBaseline,
  qcIterationShouldFail,
  snapshotQcResults,
} from "./qc-baseline";
import { reviewsHaveActionableDefects, runAutonomousReviews } from "./reviews";
import {
  coerceWorkerPlanToWorktree,
  listAuthorizedWorktreeFiles,
  truncatingUpdateErrors,
} from "./plan-worktree-adapter";
import { invokeAutonomousWorker } from "./worker-client";
import { describeWorkerRoute, resolveAutonomousWorkerRoute } from "./worker-route";
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
  runQualityGates?: (options: {
    repoPath: string;
    registeredRepoId?: string | null;
  }) => Promise<QualityGateCommandResult[]>;
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

  if (document.workerModel?.route === "live_default_worker") {
    const live = await invokeAutonomousWorker(
      {
        role: document.diagnosis ? "replan" : "planning",
        system: "",
        user: [
          `Run ID: ${runId}`,
          `Objective: ${document.originalObjective}`,
          `Requirements: ${(document.requirements ?? []).join("; ")}`,
          `Constraints: ${[...document.constraints, ...diagnosisHint].join("; ")}`,
          `Allowed path prefixes: ${document.authorizedPathPrefixes.join(", ") || "(repo src/)"}`,
          `Existing files under those prefixes: ${
            listAuthorizedWorktreeFiles(repoPath, document.authorizedPathPrefixes).join(", ") || "(none)"
          }`,
          "Use update_file for paths that already exist and create_file only for new paths. Include complete file contents.",
          "Prefer create_file for a new small helper and a Vitest test file (import { describe, it, expect } from \"vitest\"). Do not rewrite or append to entire large existing modules. Pre-existing Super/AirLLM QC failures are out of scope.",
          `Investigation: ${document.observations.map((obs) => obs.summary).join("\n")}`,
          "Return worker plan JSON with runId matching the run, allowedFiles, and file operations with full content.",
        ].join("\n"),
      },
      { generatePlanInjected: false },
    );
    document.usage.modelCalls += 1;
    recordWorkerInvocation(document, live);
    const parsed = live.parsed as unknown as WorkerPlan | null;
    if (
      !live.schemaValid ||
      !parsed ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.allowedFiles) ||
      !Array.isArray(parsed.operations)
    ) {
      throw Object.assign(
        new Error(
          [...live.parseErrors, ...live.schemaErrors].join("; ")
            || "Live worker did not return a worker plan JSON object",
        ),
        { failureClass: "MODEL_OUTPUT_FAILURE" as const },
      );
    }
    parsed.runId = runId;
    return coerceWorkerPlanToWorktree(repoPath, parsed);
  }

  const draft = await generateAndPersistWorkerPlanDraft(runId, {
    constraints: [
      ...document.constraints,
      ...diagnosisHint,
      "Model output is a worker plan JSON draft only. Never write files, never run shell, never approve release.",
    ],
    allowedFiles: document.authorizedPathPrefixes,
    includeFileContents: document.observations
      .flatMap((obs) => obs.paths ?? [])
      .slice(0, 8),
  });
  document.usage.modelCalls += 1;
  if (document.workerModel) {
    document.workerModel.rolesInvoked.push(document.diagnosis ? "replan" : "planning");
    document.workerModel.providerName = draft.providerName;
    document.workerModel.modelName = draft.modelName;
    document.workerModel.mockBypassed = draft.providerName !== "mock";
  }

  if (!draft.draft.parsedPlanJson) {
    throw Object.assign(new Error(draft.parseErrors.join("; ") || "Model output was not a worker plan"), {
      failureClass: "MODEL_OUTPUT_FAILURE" as const,
    });
  }
  const parsed = JSON.parse(draft.draft.parsedPlanJson) as WorkerPlan;
  parsed.runId = runId;
  return coerceWorkerPlanToWorktree(repoPath, parsed);
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
  const workerRoute = resolveAutonomousWorkerRoute(process.env, {
    generatePlanInjected: Boolean(deps.generatePlan),
  });
  const providerInfo = getPublicModelProviderInfo();
  const localCoding = getLocalModelCodingConfig();
  const liveLocal =
    workerRoute === "live_default_worker" &&
    providerInfo.provider !== "kimi" &&
    localCoding.enabled &&
    Boolean(localCoding.model);
  document.workerModel = {
    route: workerRoute,
    providerName: liveLocal ? "local_openai_compatible" : providerInfo.provider,
    modelName: liveLocal ? (localCoding.model as string) : providerInfo.model,
    mockBypassed: workerRoute === "live_default_worker" && (providerInfo.provider !== "mock" || liveLocal),
    rolesInvoked: document.workerModel?.rolesInvoked ?? [],
    requestPath: liveLocal
      ? `${localCoding.baseUrl.replace(/\/$/, "")}/chat/completions`
      : document.workerModel?.requestPath,
    lastInvocations: document.workerModel?.lastInvocations ?? [],
  };
  describeWorkerRoute(workerRoute, liveLocal ? "local_openai_compatible" : providerInfo.provider);
  auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_RUN_STARTED, runId, task.id, {
    mode: document.mode,
    objective: document.originalObjective,
    workerRoute: document.workerModel.route,
    provider: document.workerModel.providerName,
  });

  if (!document.qcBaseline) {
    document.strategy = "Recording QC baseline on the isolated worktree before any mutation.";
    persistAndSync(runId, document, task.id);
    const gateRunner = deps.runQualityGates ?? runQualityGates;
    const baselineResults = await gateRunner({
      repoPath,
      registeredRepoId: task.registeredRepoId,
    });
    document.qcBaseline = snapshotQcResults(baselineResults, repoPath, deps.now ?? (() => new Date()));
    document.decisions.push({
      at: nowIso(deps),
      kind: "qc_baseline",
      summary: `Recorded QC baseline: ${document.qcBaseline.failures.length} failure(s) before mutation.`,
      rationale: "Baseline-aware QC: pre-existing failures are disclosed, not treated as new iteration failures.",
    });
    persistAutonomousDocument(runId, document);
  }

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
      let investigation;
      try {
        investigation = await runInvestigation(
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        document = applyTerminal(document, "failed", "ENGINEERING_FAILURE", message);
        persistAndSync(runId, document, task.id);
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, message);
      }
      document.usage = investigation.usage;
      document.observations.push(...investigation.observations);
      await maybeInvokeWorker(
        document,
        "investigation",
        `Objective: ${document.originalObjective}\nObservations:\n${investigation.observations.map((obs) => obs.summary).join("\n")}`,
        Boolean(deps.generatePlan),
      );
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
      await maybeInvokeWorker(
        document,
        "interpretation",
        `Objective: ${document.originalObjective}\nHeuristic summary: ${interpretation.objectiveSummary}`,
        Boolean(deps.generatePlan),
      );

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
        plan = coerceWorkerPlanToWorktree(
          repoPath,
          await generatePlanForIteration(runId, document, repoPath, deps),
        );
        const truncated = truncatingUpdateErrors(repoPath, plan);
        if (truncated.length > 0) {
          throw Object.assign(new Error(truncated.join("; ")), {
            failureClass: "VALIDATION_FAILURE" as const,
          });
        }
        const escaped = (plan.operations ?? []).filter(
          (op) => !isPathAuthorized(document.authorityEnvelope, op.path),
        );
        if (escaped.length > 0) {
          throw Object.assign(
            new Error(
              `Worker plan paths outside authorized prefixes: ${escaped.map((op) => op.path).join(", ")}`,
            ),
            { failureClass: "VALIDATION_FAILURE" as const },
          );
        }
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
        await maybeInvokeWorker(
          document,
          "diagnosis",
          `Failure class: ${failureClass}\n${error instanceof Error ? error.message : String(error)}`,
          Boolean(deps.generatePlan),
        );
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      document.usage.plans += 1;
      document = transitionAutonomousState(runId, "validating", { ...document, strategy: plan.summary }).document;
      syncRun(runId, document, { agentMessage: plan.summary });
      document = transitionAutonomousState(runId, "executing", document).document;
      persistAndSync(runId, document, task.id);

      const submission = await submitAndExecuteWorkerPlan(runId, plan, {
        iterationMode: true,
        iterationNumber: document.iterationNumber,
        repoPathOverride: repoPath,
      });

      document.previousPlanId = document.currentPlanId;
      document.currentPlanId = submission.workerPlanId;

      const qc = getQualityGateResultsForRun(runId);
      const failedCommands = qc.filter((gate) => gate.status === "failed").map((gate) => gate.command);
      const delta = compareQcToBaseline(
        document.qcBaseline,
        qc.map((gate) => ({
          command: gate.command,
          status: gate.status,
          exitCode: gate.exitCode,
          stdout: gate.stdout,
          stderr: gate.stderr,
          durationMs: gate.durationMs,
        })),
        deps.now ?? (() => new Date()),
        { mutatedThisIteration: Boolean(submission.execution?.success) },
      );
      document.qcDelta = delta;
      const rawQcSummary = failedCommands.length
        ? `Failed gates: ${failedCommands.join(", ")}`
        : "Quality gates passed or skipped.";
      const qcSummary = qcSummaryFromDelta(delta, rawQcSummary);
      document.qcObservations.push({
        iteration: document.iterationNumber,
        at: nowIso(deps),
        passed: delta.objectiveQcPassed,
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
        await maybeInvokeWorker(
          document,
          "diagnosis",
          `Failure class: ${failureClass}\n${submission.validation.errors.map((err) => err.message).join("; ")}`,
          Boolean(deps.generatePlan),
        );
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
        await maybeInvokeWorker(
          document,
          "diagnosis",
          `Failure class: ${failureClass}\n${submission.execution?.errors.map((err) => err.message).join("; ") ?? "execution failed"}`,
          Boolean(deps.generatePlan),
        );
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

      if (delta.infrastructureFailures.length > 0) {
        document = applyTerminal(
          document,
          "failed",
          "INFRASTRUCTURE_FAILURE",
          delta.infrastructureFailures.map((item) => item.identity.rawEvidence).join("; "),
        );
        persistAndSync(runId, document, task.id);
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, "INFRASTRUCTURE_FAILURE");
      }

      if (qcIterationShouldFail(delta)) {
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
        await maybeInvokeWorker(
          document,
          "diagnosis",
          [
            `Failure class: ${failureClass}`,
            qcSummary,
            `Owned failures only (fix these, not pre-existing Super/AirLLM): ${
              delta.ownedIterationFailures
                .map((item) => `${item.identity.name}${item.identity.rawEvidence ? ` :: ${item.identity.rawEvidence.slice(0, 180)}` : ""}`)
                .join("; ") || "(none)"
            }`,
            "Do not rewrite large existing modules. Add or repair a small helper. Pre-existing failures are out of scope.",
          ].join("\n"),
          Boolean(deps.generatePlan),
        );
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ITERATION_FAILED, runId, task.id, {
          iteration: document.iterationNumber,
          failureClass,
          workerPlanId: submission.workerPlanId,
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      if (delta.preExistingFailures.length > 0) {
        document.openRisks = delta.preExistingFailures.map((finding, index) => ({
          id: `preexisting-${index}-${finding.identity.key}`,
          summary: `Pre-existing QC failure (not introduced by this objective): ${finding.identity.name}`,
          class: "ENGINEERING_FAILURE" as const,
        }));
      }

      document.priorAttempts.push({
        iteration: document.iterationNumber,
        workerPlanId: submission.workerPlanId,
        strategy: document.strategy ?? plan.summary,
        outcome: "passed",
        failureClass: null,
        summary: delta.preExistingFailures.length
          ? "Worker plan executed. Objective QC passed with disclosed pre-existing failures."
          : "Worker plan executed and quality gates passed.",
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
        qcPassed: document.qcDelta?.objectiveQcPassed ?? true,
      });
      document.reviews = reviews;
      await maybeInvokeWorker(
        document,
        "review",
        `Changed files: ${changedFiles.join(", ")}\nDiff:\n${diffSummary.slice(0, 4000)}\nHeuristic reviews: ${JSON.stringify(reviews)}`,
        Boolean(deps.generatePlan),
      );
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
        qcPassed: document.qcDelta?.objectiveQcPassed ?? true,
        changedFiles,
        reviews: document.reviews,
      });
      document.completionEvaluation = evaluation;
      await maybeInvokeWorker(
        document,
        "completion",
        `Complete=${evaluation.complete}. ${evaluation.summary}`,
        Boolean(deps.generatePlan),
      );
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

function qcSummaryFromDelta(
  delta: ReturnType<typeof compareQcToBaseline>,
  fallback: string,
): string {
  if (delta.ownedIterationFailures.length === 0 && delta.preExistingFailures.length === 0) {
    return fallback;
  }
  const parts = [
    `new=${delta.newFailures.length}`,
    `changed=${delta.changedFailures.length}`,
    `pre_existing=${delta.preExistingFailures.length}`,
    `resolved=${delta.resolvedBaselineFailures.length}`,
  ];
  return `QC vs baseline: ${parts.join(", ")}. ${fallback}`;
}

function recordWorkerInvocation(
  document: AutonomousDocument,
  result: Awaited<ReturnType<typeof invokeAutonomousWorker>>,
): void {
  if (!document.workerModel) return;
  document.workerModel.rolesInvoked.push(result.role);
  document.workerModel.providerName = result.providerName;
  document.workerModel.modelName = result.modelName;
  document.workerModel.mockBypassed = result.mockBypassed;
  document.workerModel.requestPath = result.requestPath;
  document.workerModel.lastInvocations = [
    ...(document.workerModel.lastInvocations ?? []),
    {
      role: result.role,
      providerName: result.providerName,
      modelName: result.modelName,
      requestPath: result.requestPath,
      schemaValid: result.schemaValid,
      parseErrors: result.parseErrors,
      schemaErrors: result.schemaErrors,
      repairAttempted: result.repairAttempted,
      accepted: result.schemaValid && result.parsed !== null,
    },
  ].slice(-24);
}

async function maybeInvokeWorker(
  document: AutonomousDocument,
  role: "interpretation" | "investigation" | "diagnosis" | "completion" | "review",
  user: string,
  generatePlanInjected: boolean,
): Promise<void> {
  if (!document.workerModel || document.workerModel.route !== "live_default_worker") return;
  const result = await invokeAutonomousWorker({ role, system: "", user }, { generatePlanInjected });
  document.usage.modelCalls += 1;
  recordWorkerInvocation(document, result);
  if (result.schemaValid && result.parsed) {
    if (role === "diagnosis" && document.diagnosis) {
      const why = result.parsed.whyPreviousFailed;
      const strategy = result.parsed.suggestedStrategy;
      if (typeof why === "string" && typeof strategy === "string") {
        document.diagnosis = {
          ...document.diagnosis,
          whyPreviousFailed: why,
          suggestedStrategy: strategy,
          filesToInspect: Array.isArray(result.parsed.filesToInspect)
            ? result.parsed.filesToInspect.filter((item): item is string => typeof item === "string")
            : document.diagnosis.filesToInspect,
        };
        document.strategy = strategy;
      }
    }
    const summary =
      typeof result.parsed.summary === "string"
        ? result.parsed.summary
        : typeof result.parsed.suggestedStrategy === "string"
          ? result.parsed.suggestedStrategy
          : typeof result.parsed.objectiveSummary === "string"
            ? result.parsed.objectiveSummary
            : `${role} JSON accepted`;
    document.decisions.push({
      at: new Date().toISOString(),
      kind: `worker_${role}`,
      summary: summary.slice(0, 400),
      rationale: "Live default worker structured JSON (advisory; cannot mutate or approve).",
    });
  }
}
