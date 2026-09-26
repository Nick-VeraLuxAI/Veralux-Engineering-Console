import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { generateAndPersistWorkerPlanDraft } from "../model-router/worker-plan-draft-generator";
import { getPublicModelProviderInfo } from "../model-router/model-provider-config";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import { submitAndExecuteWorkerPlan } from "../orchestrator/worker-plan-orchestrator";
import { runQualityGates, type QualityGateCommandResult } from "../quality-gates/quality-gate-runner";
import { getQualityGateResultsForRun, getRunById, updateRun } from "../run-manager/run-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import { maybeCaptureAfterAeTerminal } from "../skillopt/skill-capture";
import { maybeShadowRetrieveForPlanning } from "../skillopt/ae-hooks";
import type { RunStatus } from "../types";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { getChangedFiles, getDiffSummary } from "../workspace/git-workspace";
import { createIsolatedRunWorktree } from "../workspace/run-worktree";
import fs from "fs";
import path from "path";
import { auditAutonomousEvent } from "./audit";
import { assertExecutorCannotSelfAuthorize, isPathAuthorized } from "./authority";
import { BudgetExhaustedError, checkBudget, wouldExceedBudget } from "./budget";
import { evaluateCompletion } from "./completion-evaluator";
import { diagnoseIterationFailure } from "./diagnosis";
import {
  authoritativeDiagnosisHint,
  buildPriorAttemptDigest,
  checkDiagnosisConsistency,
  detectFailureSignaturesInPlan,
  detectFailureSignaturesInText,
  ensureFailureSignatureHistory,
  findSymbolDependencyNeighborhood,
  formatSubjectCallModeBlock,
  formatTestExemplarBlock,
  formatUnboundDependencyHint,
  findProductionFilesUsingUnboundSymbol,
  mergeStructuredDiagnosis,
  parseUnboundIdentifierFindings,
  readAuthorizedTestExemplars,
  readRepoTestGroundingFacts,
  readSubjectCallModes,
  recordFailureSignatures,
  shouldBlockRepeatedHarnessStrategy,
  shouldBlockTestThrashWhileProductionUnbound,
  sliceOwnedFailureEvidence,
  validateChangedTestHarness,
  validatePlanHarnessGuards,
  type FailureSignature,
} from "./feedback-convergence";
import { classifyAutonomousFailure, isTerminalFailureClass } from "./failure-classification";
import { defaultInvestigationOperations, runInvestigation } from "./investigation";
import { interpretObjective } from "./objective-interpreter";
import {
  classifyPreExecutionPlanFailure,
  resolveMaxPlanRepairs,
  wouldExceedPlanRepairs,
  type PlanRepairRecord,
} from "./plan-repair";
import {
  compareQcToBaseline,
  formatQcDeltaRepairBlock,
  qcIterationShouldFail,
  snapshotQcResults,
} from "./qc-baseline";
import {
  buildReviewGroundingPrompt,
  mergeWorkerAdversarialReview,
  reviewsHaveActionableDefects,
  runAutonomousReviews,
} from "./reviews";
import {
  findingIdFromSummary,
  markFindingsRepairAttempted,
  resolveMaxPostReviewRepairs,
  trackPostReviewFindings,
  wouldExceedPostReviewRepairs,
} from "./post-review-repair";
import { maybeAutoInvokeSeniorAfterQcFailure } from "../senior-escalation/ae-auto-senior";
import {
  assertLiveAeNanoEnvelope,
  resolveNanoRuntimeMode,
} from "./nano-faithful-invocation";
import {
  coerceWorkerPlanToWorktree,
  listAuthorizedWorktreeFiles,
  readAuthorizedWorktreeSnippets,
  truncatingUpdateErrors,
} from "./plan-worktree-adapter";
import {
  formatContractsContextBlock,
  objectiveTouchesContracts,
  shouldFreezeContractsAfterRepairs,
  validatePlanScaffoldOperations,
} from "./scaffold-contract-guard";
import { buildIntegrationGroundingBlock } from "./integration-grounding";
import { validatePlanTypeScriptSyntax } from "./plan-syntax-guard";
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
  // SkillOpt passive capture only — never mutates prompts/plans/QC.
  try {
    const run = getRunById(runId);
    if (run?.taskId) {
      maybeCaptureAfterAeTerminal(runId, run.taskId, document);
    }
  } catch {
    // ignore
  }
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
  taskId: string,
  document: AutonomousDocument,
  repoPath: string,
  deps: AutonomousLoopDependencies,
): Promise<WorkerPlan> {
  if (deps.generatePlan) {
    return deps.generatePlan({ runId, document, repoPath });
  }

  const diagnosisHint = authoritativeDiagnosisHint(document);
  const touchesContracts = objectiveTouchesContracts({
    objective: document.originalObjective,
    requirements: document.requirements,
    acceptanceCriteria: document.acceptanceCriteria,
  });
  const integrationGrounding = buildIntegrationGroundingBlock(repoPath, {
    objective: document.originalObjective,
    requirements: document.requirements,
    acceptanceCriteria: document.acceptanceCriteria,
    extraCrib: document.scaffoldGuard?.integrationCrib,
  });
  const grounding = readRepoTestGroundingFacts(repoPath);
  const priorDigest = buildPriorAttemptDigest({
    priorAttempts: document.priorAttempts,
    failedHypotheses: document.failedHypotheses,
    qcObservations: document.qcObservations,
    failureSignatures: ensureFailureSignatureHistory(document),
  });
  const diagnosisEvidence = [
    document.diagnosis?.evidence_quote_or_signature,
    document.diagnosis?.whyPreviousFailed,
    document.diagnosis?.observed_failure,
    document.qcObservations[document.qcObservations.length - 1]?.summary,
  ]
    .filter(Boolean)
    .join("\n");
  const unboundFindings = parseUnboundIdentifierFindings(diagnosisEvidence);
  const primaryUnbound = unboundFindings.find((u) => !u.isHookGlobal);
  const dependencyNeighborhood = primaryUnbound
    ? findSymbolDependencyNeighborhood(
        repoPath,
        document.authorizedPathPrefixes,
        primaryUnbound.symbol,
      )
    : null;
  const unboundHint = formatUnboundDependencyHint(unboundFindings, dependencyNeighborhood);

  if (document.workerModel?.route === "live_default_worker") {
    const existingFiles = listAuthorizedWorktreeFiles(repoPath, document.authorizedPathPrefixes);
    const snippets = readAuthorizedWorktreeSnippets(repoPath, document.authorizedPathPrefixes);
    const focusPaths = [
      ...(document.diagnosis?.filesToInspect ?? []),
      ...(primaryUnbound?.productionFiles ?? []),
      ...(dependencyNeighborhood?.candidateModules ?? []),
      ...existingFiles.filter((file) => /\.(js|ts|mjs|cjs)$/.test(file)).slice(0, 4),
    ];
    const exemplars = readAuthorizedTestExemplars(repoPath, document.authorizedPathPrefixes, {
      maxFiles: 3,
      focusPaths,
    });
    const subjectModes = readSubjectCallModes(repoPath, document.authorizedPathPrefixes);
    const snippetBlock =
      snippets.length === 0
        ? "(no existing source snippets under authorized prefixes)"
        : snippets
            .map((snippet) => `--- ${snippet.path} ---\n${snippet.content}`)
            .join("\n\n");
    let packageScripts = "(package.json unreadable)";
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      packageScripts = JSON.stringify(pkg.scripts ?? {});
    } catch {
      // keep fallback
    }
    const planningUserPrompt = [
      `Run ID: ${runId}`,
      `Objective: ${document.originalObjective}`,
      `Requirements: ${(document.requirements ?? []).join("; ")}`,
      `Constraints: ${[...document.constraints, ...diagnosisHint].join("; ")}`,
      `Allowed path prefixes: ${document.authorizedPathPrefixes.join(", ") || "(repo src/)"}`,
      `Existing files under those prefixes (truncated): ${existingFiles.slice(0, 24).join(", ") || "(none)"}`,
      `package.json scripts: ${packageScripts}`,
      grounding.factsBlock,
      formatQcDeltaRepairBlock(document.qcDelta),
      formatSubjectCallModeBlock(subjectModes),
      priorDigest,
      unboundHint,
      formatContractsContextBlock(repoPath, touchesContracts),
      touchesContracts
        ? "CONTRACT-EDIT MODE: src/contracts.ts is in context above. Use update_file with the COMPLETE file (baseline + additive edits). Never shorten or replace exports. Prefer new types in contracts and implementation in separate modules."
        : "",
      integrationGrounding,
      "Use update_file for paths that already exist and create_file only for new paths. Include complete file contents.",
      "When acceptance criteria require removing unused dead helpers/shims and the path is authorized/safe, include delete_file with a non-empty reason (content may be empty). Do not delete unrelated files.",
      "When authorized existing modules are defective, incomplete, or unsafe, repair them with update_file (complete corrected contents). Do not stack WORKAROUND/HACK conditionals or silent catch fallbacks. Prefer create_file only for genuinely new helpers/tests. Do not rewrite or append to unrelated large modules. Pre-existing Super/AirLLM QC failures are out of scope.",
      "Do NOT rewrite src/contracts.ts except to add new exports/types and optional fields. Preserve MemoryRecord.kind, supersededById, and every existing export. Add memoryClass?: MemoryClass alongside kind — never rename kind. When contracts gain new optional fields, existing tests must still pass (store may infer defaults). Implement InMemoryMemoryRecordStore in src/memory-record-store.ts with upsert/get/list/supersede matching the MemoryRecordStore interface exactly (same pattern as InMemoryEventLog). Never invent create/update method aliases.",
      "Do NOT rewrite src/context-assembler.ts, src/memory-record-store.ts, or src/event-log.ts except for minimal additive fixes. Preserve AssembledContext return shape (text, recordIds, eventIds, estimatedTokens) and store method names (upsert/get/list/supersede). Add new behavior in new modules (e.g. context-budget-assembler.ts) when possible.",
      "Match the existing test runner from package.json scripts. If test uses node --test / node:test, write ONLY: import test from 'node:test'; import assert from 'node:assert/strict'; and use test('name', () => { assert.equal(...) }). Do NOT import expect/describe/it from 'node:test' (those exports are invalid). Use Vitest only when package.json already runs vitest. Never import vitest, node:test, or node:assert from non-test production sources.",
      "For negative-path tests: sync subjects → assert.throws(() => ...); async/Promise subjects → await assert.rejects(async () => ...). Read subject call modes above before writing reject/throw tests.",
      // UNBOUND_IDENTIFIER guidance is signature-gated via unboundHint (empty unless evidence present).
      "Include happy, negative, and failure-path coverage the objective implies. If a test expectation conflicts with correct fail-closed behavior, fix the test.",
      `Investigation: ${document.observations.map((obs) => obs.summary).join("\n").slice(0, 2500)}`,
      `Authorized source snippets (read these before mutating):\n${snippetBlock}`,
      `Known-good test exemplars (1–3, proximity-ranked; match this harness style):\n${formatTestExemplarBlock(exemplars)}`,
      "Return worker plan JSON with runId matching the run, allowedFiles, and file operations with full content.",
      "File operation content must be real source text — never JSON-escaped quotes (no \\\" sequences) or literal \\n blobs.",
    ].join("\n");
    // SkillOpt shadow retrieval: records wouldInject; prompt must remain unchanged.
    const shadowedUserPrompt = maybeShadowRetrieveForPlanning({
      runId,
      taskId,
      prompt: planningUserPrompt,
      document,
    });
    let live: Awaited<ReturnType<typeof invokeAutonomousWorker>>;
    try {
      live = await invokeAutonomousWorker(
        {
          role: document.diagnosis ? "replan" : "planning",
          system: "",
          user: shadowedUserPrompt,
        },
        { generatePlanInjected: false },
      );
    } catch (error) {
      throw Object.assign(
        new Error(error instanceof Error ? error.message : String(error)),
        { failureClass: "MODEL_OUTPUT_FAILURE" as const },
      );
    }
    document.usage.modelCalls += 1;
    recordWorkerInvocation(document, live);
    if (live.generationBudgetExhausted) {
      throw Object.assign(
        new Error(
          `GENERATION_BUDGET_EXHAUSTED: finish_reason=length under max_tokens=${live.telemetry?.maxTokens ?? "?"}`,
        ),
        { failureClass: "GENERATION_BUDGET_EXHAUSTED" as const },
      );
    }
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
  if (liveLocal) {
    document.nanoRuntimeMode = assertLiveAeNanoEnvelope();
  } else {
    document.nanoRuntimeMode = resolveNanoRuntimeMode();
  }
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

  const loopGuard =
    document.budget.max_iterations * 4 +
    resolveMaxPlanRepairs(document.budget) * 2 +
    resolveMaxPostReviewRepairs(document.budget) * 2 +
    8;
  let steps = 0;
  if (typeof document.usage.planRepairs !== "number") {
    document.usage.planRepairs = 0;
  }
  if (typeof document.usage.postReviewRepairs !== "number") {
    document.usage.postReviewRepairs = 0;
  }
  if (!document.planRepairHistory) {
    document.planRepairHistory = [];
  }
  if (!document.reviewFindingLedger) {
    document.reviewFindingLedger = [];
  }
  if (!document.nanoRuntimeMode) {
    document.nanoRuntimeMode = resolveNanoRuntimeMode();
  }

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
      // Semantic iterations are charged only after a valid plan is accepted for execution.
      // Pre-execution failures are PLAN_REPAIR (bounded by max_plan_repairs / modelCalls / plans).
      // Post-QC review reopen uses POST_REVIEW_REPAIR (does not require another semantic iteration).
      const postReviewPlanning = Boolean(document.awaitingPostReviewRepair);
      if (postReviewPlanning) {
        if (wouldExceedPostReviewRepairs(document.budget, document.usage, 1)) {
          document = applyTerminal(
            document,
            "exhausted",
            "BUDGET_EXHAUSTED",
            `Post-review repair budget exhausted (${document.usage.postReviewRepairs}/${resolveMaxPostReviewRepairs(document.budget)}).`,
          );
          persistAndSync(runId, document, task.id);
          updateTask(task.id, { status: "failed" });
          return terminalResult(runId, document, "Post-review repair budget exhausted.");
        }
      } else if (wouldExceedBudget(document.budget, document.usage, "iterations", 1)) {
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
      if (wouldExceedPlanRepairs(document.budget, document.usage, 1) &&
          document.lastIterationChargeKind === "PLAN_REPAIR") {
        document = applyTerminal(
          document,
          "exhausted",
          "BUDGET_EXHAUSTED",
          `Plan-repair budget exhausted (${document.usage.planRepairs}/${resolveMaxPlanRepairs(document.budget)}).`,
        );
        persistAndSync(runId, document, task.id);
        updateTask(task.id, { status: "failed" });
        return terminalResult(runId, document, "Plan-repair budget exhausted.");
      }
      document.strategy =
        document.diagnosis?.suggestedStrategy ??
        `Iteration ${document.iterationNumber + 1}: implement interpreted requirements via worker plan.`;

      let plan: WorkerPlan;
      try {
        checkBudget(document.budget, document.usage, "modelCalls", deps.generatePlan ? 0 : 1);
        checkBudget(document.budget, document.usage, "plans", 1);
        plan = coerceWorkerPlanToWorktree(
          repoPath,
          await generatePlanForIteration(runId, task.id, document, repoPath, deps),
        );
        const truncated = truncatingUpdateErrors(repoPath, plan);
        if (truncated.length > 0) {
          throw Object.assign(new Error(truncated.join("; ")), {
            failureClass: "VALIDATION_FAILURE" as const,
            planRepairKind: "truncating_update" as const,
          });
        }
        const scaffoldErrors = validatePlanScaffoldOperations(repoPath, plan, document);
        if (scaffoldErrors.length > 0) {
          throw Object.assign(new Error(scaffoldErrors.join("; ")), {
            failureClass: "VALIDATION_FAILURE" as const,
            planRepairKind: "scaffold_contract" as const,
          });
        }
        const syntaxErrors = validatePlanTypeScriptSyntax(repoPath, plan);
        if (syntaxErrors.length > 0) {
          throw Object.assign(new Error(syntaxErrors.join("; ")), {
            failureClass: "VALIDATION_FAILURE" as const,
            planRepairKind: "invalid_syntax" as const,
          });
        }
        const grounding = readRepoTestGroundingFacts(repoPath);
        const syncSubjects = readSubjectCallModes(repoPath, document.authorizedPathPrefixes)
          .filter((m) => m.mode === "sync")
          .map((m) => m.name);
        const harnessFindings = validatePlanHarnessGuards(plan, grounding, syncSubjects);
        if (harnessFindings.length > 0) {
          const signatures = [...new Set(harnessFindings.map((f) => f.signature))];
          document.failureSignatureHistory = recordFailureSignatures(
            ensureFailureSignatureHistory(document),
            signatures,
            document.iterationNumber + 1,
          );
          throw Object.assign(new Error(harnessFindings.map((f) => f.message).join("; ")), {
            failureClass: "VALIDATION_FAILURE" as const,
            planRepairKind: "harness_incompat" as const,
          });
        }
        const planSignatures = detectFailureSignaturesInPlan(plan, grounding, syncSubjects);
        const repeatBlock = shouldBlockRepeatedHarnessStrategy(
          ensureFailureSignatureHistory(document),
          planSignatures,
        );
        if (repeatBlock.block) {
          throw Object.assign(new Error(repeatBlock.message), {
            failureClass: "VALIDATION_FAILURE" as const,
            planRepairKind: "harness_incompat" as const,
          });
        }
        const thrashEvidence = [
          document.diagnosis?.evidence_quote_or_signature,
          document.diagnosis?.whyPreviousFailed,
          document.diagnosis?.observed_failure,
        ]
          .filter(Boolean)
          .join("\n");
        const thrashUnbound = parseUnboundIdentifierFindings(thrashEvidence);
        const thrashPrimary = thrashUnbound.find((u) => !u.isHookGlobal);
        const thrashNeighborhood = thrashPrimary
          ? findSymbolDependencyNeighborhood(
              repoPath,
              document.authorizedPathPrefixes,
              thrashPrimary.symbol,
            )
          : null;
        const productionStillUnbound = thrashPrimary
          ? findProductionFilesUsingUnboundSymbol(
              repoPath,
              document.authorizedPathPrefixes,
              thrashPrimary.symbol,
            )
          : [];
        const thrashBlock = shouldBlockTestThrashWhileProductionUnbound({
          plan,
          unbound: thrashUnbound,
          neighborhood: thrashNeighborhood,
          productionFilesStillUnbound: productionStillUnbound,
        });
        if (thrashBlock.block) {
          throw Object.assign(new Error(thrashBlock.message), {
            failureClass: "VALIDATION_FAILURE" as const,
            planRepairKind: "harness_incompat" as const,
          });
        }
        const escaped = (plan.operations ?? []).filter(
          (op) => !isPathAuthorized(document.authorityEnvelope, op.path),
        );
        if (escaped.length > 0) {
          throw Object.assign(
            new Error(
              classifyPreExecutionPlanFailure({
                failureClass: "VALIDATION_FAILURE",
                message: `Worker plan paths outside authorized prefixes: ${escaped.map((op) => op.path).join(", ")}`,
                unauthorizedPaths: escaped.map((op) => op.path),
                authority: document.authorityEnvelope,
              }).reason,
            ),
            {
              failureClass: "VALIDATION_FAILURE" as const,
              planRepairKind: "unauthorized_path" as const,
              unauthorizedPaths: escaped.map((op) => op.path),
            },
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
        const errMsg = error instanceof Error ? error.message : String(error);
        const unauthorizedPaths = (error as { unauthorizedPaths?: string[] }).unauthorizedPaths;
        const classification = classifyPreExecutionPlanFailure({
          failureClass,
          message: errMsg,
          unauthorizedPaths,
          authority: document.authorityEnvelope,
        });
        // PLAN_REPAIR: do not burn semantic engineering iterations (WP3).
        if (classification.chargeKind === "PLAN_REPAIR") {
          if (wouldExceedPlanRepairs(document.budget, document.usage, 1)) {
            document = applyTerminal(
              document,
              "exhausted",
              "BUDGET_EXHAUSTED",
              `Plan-repair budget exhausted (${document.usage.planRepairs}/${resolveMaxPlanRepairs(document.budget)}): ${classification.reason}`,
            );
            persistAndSync(runId, document, task.id);
            updateTask(task.id, { status: "failed" });
            return terminalResult(runId, document, "Plan-repair budget exhausted.");
          }
          document.usage.planRepairs = (document.usage.planRepairs ?? 0) + 1;
          document.lastIterationChargeKind = "PLAN_REPAIR";
          const repairRecord: PlanRepairRecord = {
            at: nowIso(deps),
            semanticIteration: document.iterationNumber,
            kind: classification.planRepairKind ?? "invalid_op",
            reason: classification.reason,
            evidence: classification.evidence,
          };
          document.planRepairHistory = [...(document.planRepairHistory ?? []), repairRecord];
          if (
            repairRecord.kind === "scaffold_contract"
            && shouldFreezeContractsAfterRepairs(document.planRepairHistory)
          ) {
            document.scaffoldGuard = {
              ...document.scaffoldGuard,
              contractsFrozen: true,
            };
          }
          document.failureClass = failureClass;
          document.diagnosis = diagnoseIterationFailure({
            document,
            failureClass,
            validationErrors: [classification.reason],
          });
          document.decisions.push({
            at: nowIso(deps),
            kind: "plan_repair",
            summary: `PLAN_REPAIR (${repairRecord.kind}): semantic iterations unchanged at ${document.usage.iterations}`,
            rationale: classification.reason.slice(0, 500),
          });
          await maybeInvokeWorker(
            document,
            "diagnosis",
            `PLAN_REPAIR (does not burn semantic iterations)\nFailure class: ${failureClass}\n${classification.reason}`,
            Boolean(deps.generatePlan),
          );
          document = transitionAutonomousState(runId, "diagnosing", document).document;
          syncRun(runId, document);
          continue;
        }
        // Unexpected non-repair planning failure: charge as engineering iteration.
        document.iterationNumber += 1;
        document.usage.iterations += 1;
        document.lastIterationChargeKind = "ENGINEERING_ITERATION";
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          validationErrors: [errMsg],
        });
        await maybeInvokeWorker(
          document,
          "diagnosis",
          `Failure class: ${failureClass}\n${errMsg}`,
          Boolean(deps.generatePlan),
        );
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      // Defer ENGINEERING_ITERATION charge until orchestrator validation accepts the plan.
      document = transitionAutonomousState(runId, "validating", { ...document, strategy: plan.summary }).document;
      syncRun(runId, document, { agentMessage: plan.summary });
      document = transitionAutonomousState(runId, "executing", document).document;
      persistAndSync(runId, document, task.id);

      const nextIterationNumber = document.iterationNumber + 1;
      const submission = await submitAndExecuteWorkerPlan(runId, plan, {
        iterationMode: true,
        iterationNumber: nextIterationNumber,
        repoPathOverride: repoPath,
      });

      document.previousPlanId = document.currentPlanId;
      document.currentPlanId = submission.workerPlanId;

      if (!submission.validation.valid) {
        const failureClass = classifyAutonomousFailure({
          workerPlanValidationFailed: true,
          workerPlanParseFailed: submission.validation.errors.some((err) => err.code === "PARSE_FAILED"),
        });
        const validationMsg = submission.validation.errors.map((err) => err.message).join("; ");
        const classification = classifyPreExecutionPlanFailure({
          failureClass,
          message: validationMsg,
          authority: document.authorityEnvelope,
        });
        if (wouldExceedPlanRepairs(document.budget, document.usage, 1)) {
          document = applyTerminal(
            document,
            "exhausted",
            "BUDGET_EXHAUSTED",
            `Plan-repair budget exhausted on orchestrator validation: ${classification.reason}`,
          );
          persistAndSync(runId, document, task.id);
          updateTask(task.id, { status: "failed" });
          return terminalResult(runId, document, "Plan-repair budget exhausted.");
        }
        document.usage.planRepairs = (document.usage.planRepairs ?? 0) + 1;
        document.lastIterationChargeKind = "PLAN_REPAIR";
        document.planRepairHistory = [
          ...(document.planRepairHistory ?? []),
          {
            at: nowIso(deps),
            semanticIteration: document.iterationNumber,
            kind: classification.planRepairKind ?? "invalid_op",
            reason: classification.reason,
            evidence: classification.evidence,
          },
        ];
        const orchestratorRepairKind = classification.planRepairKind ?? "invalid_op";
        if (
          orchestratorRepairKind === "scaffold_contract"
          && shouldFreezeContractsAfterRepairs(document.planRepairHistory)
        ) {
          document.scaffoldGuard = {
            ...document.scaffoldGuard,
            contractsFrozen: true,
          };
        }
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          validationErrors: [classification.reason],
        });
        document.decisions.push({
          at: nowIso(deps),
          kind: "plan_repair",
          summary: `PLAN_REPAIR (orchestrator validation): semantic iterations unchanged at ${document.usage.iterations}`,
          rationale: classification.reason.slice(0, 500),
        });
        await maybeInvokeWorker(
          document,
          "diagnosis",
          `PLAN_REPAIR\nFailure class: ${failureClass}\n${classification.reason}`,
          Boolean(deps.generatePlan),
        );
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ITERATION_FAILED, runId, task.id, {
          iteration: document.iterationNumber,
          failureClass,
          workerPlanId: submission.workerPlanId,
          chargeKind: "PLAN_REPAIR",
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      // Valid plan executed (or attempted) → charge ENGINEERING_ITERATION or POST_REVIEW_REPAIR.
      const postReviewCharge = Boolean(document.awaitingPostReviewRepair);
      document.iterationNumber = nextIterationNumber;
      if (postReviewCharge) {
        document.usage.postReviewRepairs = (document.usage.postReviewRepairs ?? 0) + 1;
        document.lastIterationChargeKind = "POST_REVIEW_REPAIR";
        document.awaitingPostReviewRepair = false;
        const openSummaries = document.unresolvedDefects
          .filter((d) => d.source === "review")
          .map((d) => d.summary);
        document.reviewFindingLedger = markFindingsRepairAttempted(
          document.reviewFindingLedger ?? [],
          openSummaries,
        );
        document.decisions.push({
          at: nowIso(deps),
          kind: "post_review_repair",
          summary: `POST_REVIEW_REPAIR ${document.usage.postReviewRepairs}/${resolveMaxPostReviewRepairs(document.budget)}; semantic iterations unchanged at ${document.usage.iterations}`,
          rationale: "QC had passed; repairing material review defects without burning primary engineering iterations.",
        });
      } else {
        document.usage.iterations += 1;
        document.lastIterationChargeKind = "ENGINEERING_ITERATION";
      }
      document.usage.plans += 1;

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

      // WP7: fast pre-QC harness validation on changed tests (observation → diagnosis → replan).
      const groundingFacts = readRepoTestGroundingFacts(repoPath);
      const syncSubjects = readSubjectCallModes(repoPath, document.authorizedPathPrefixes)
        .filter((m) => m.mode === "sync")
        .map((m) => m.name);
      const preQcFindings = validateChangedTestHarness(repoPath, changedFiles, groundingFacts, syncSubjects);
      if (preQcFindings.length > 0) {
        const failureClass = classifyAutonomousFailure({ qualityGatesFailed: true });
        const harnessSummary = preQcFindings.map((f) => f.message).join("; ");
        const signatures = [...new Set(preQcFindings.map((f) => f.signature))] as FailureSignature[];
        document.failureSignatureHistory = recordFailureSignatures(
          ensureFailureSignatureHistory(document),
          signatures,
          document.iterationNumber,
        );
        document.observations.push({
          at: nowIso(deps),
          operation: "fast_pre_qc",
          summary: `Fast pre-QC harness validation failed: ${harnessSummary}`.slice(0, 500),
          detail: harnessSummary,
          paths: preQcFindings.map((f) => f.path),
        });
        document.priorAttempts.push({
          iteration: document.iterationNumber,
          workerPlanId: submission.workerPlanId,
          strategy: document.strategy ?? plan.summary,
          outcome: "failed",
          failureClass,
          summary: harnessSummary,
          qcSummary: harnessSummary,
        });
        document.failedHypotheses.push({
          iteration: document.iterationNumber,
          hypothesis: plan.summary,
          whyFailed: harnessSummary,
        });
        document.failureClass = failureClass;
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass,
          qcSummary: harnessSummary,
          evidenceText: harnessSummary,
          repoPath,
        });
        await invokeEvidenceGroundedDiagnosis(
          document,
          failureClass,
          harnessSummary,
          harnessSummary,
          Boolean(deps.generatePlan),
          repoPath,
        );
        document = await maybeAutoInvokeSeniorAfterQcFailure({
          document,
          runId,
          taskId: task.id,
          objective: document.originalObjective ?? task.title,
          repoPath,
          qcSummary: harnessSummary,
          changedFiles,
          delta,
          qc,
        });
        auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ITERATION_FAILED, runId, task.id, {
          iteration: document.iterationNumber,
          failureClass,
          workerPlanId: submission.workerPlanId,
          preQc: true,
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }

      if (qcIterationShouldFail(delta)) {
        const failureClass = classifyAutonomousFailure({ qualityGatesFailed: true });
        const ownedEvidence = sliceOwnedFailureEvidence(delta.ownedIterationFailures);
        const signatures = detectFailureSignaturesInText(ownedEvidence);
        document.failureSignatureHistory = recordFailureSignatures(
          ensureFailureSignatureHistory(document),
          signatures,
          document.iterationNumber,
        );
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
          evidenceText: ownedEvidence,
          repoPath,
        });
        await invokeEvidenceGroundedDiagnosis(
          document,
          failureClass,
          qcSummary,
          ownedEvidence,
          Boolean(deps.generatePlan),
          repoPath,
        );
        document = await maybeAutoInvokeSeniorAfterQcFailure({
          document,
          runId,
          taskId: task.id,
          objective: document.originalObjective ?? task.title,
          repoPath,
          qcSummary,
          changedFiles,
          delta,
          qc,
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
        chargeKind: document.lastIterationChargeKind ?? null,
        planRepairs: document.usage.planRepairs ?? 0,
        postReviewRepairs: document.usage.postReviewRepairs ?? 0,
        awaitingPostReviewRepair: Boolean(document.awaitingPostReviewRepair),
      });
      // After PLAN_REPAIR, do not burn/require a new semantic iteration to replan (WP3).
      if (document.lastIterationChargeKind === "PLAN_REPAIR") {
        if (wouldExceedPlanRepairs(document.budget, document.usage, 1)) {
          document = applyTerminal(
            document,
            "exhausted",
            "BUDGET_EXHAUSTED",
            `No remaining plan-repair budget after diagnosis (${document.usage.planRepairs}/${resolveMaxPlanRepairs(document.budget)}).`,
          );
          persistAndSync(runId, document, task.id);
          updateTask(task.id, { status: "failed" });
          return terminalResult(runId, document, "Plan-repair budget exhausted after diagnosis.");
        }
      } else if (document.awaitingPostReviewRepair) {
        if (wouldExceedPostReviewRepairs(document.budget, document.usage, 1)) {
          document = applyTerminal(
            document,
            "exhausted",
            "BUDGET_EXHAUSTED",
            `No remaining post-review repair budget after diagnosis (${document.usage.postReviewRepairs}/${resolveMaxPostReviewRepairs(document.budget)}).`,
          );
          persistAndSync(runId, document, task.id);
          updateTask(task.id, { status: "failed" });
          return terminalResult(runId, document, "Post-review repair budget exhausted after diagnosis.");
        }
      } else if (wouldExceedBudget(document.budget, document.usage, "iterations", 1)) {
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
      const fileContents: Record<string, string> = {};
      for (const relative of changedFiles.slice(0, 40)) {
        try {
          const absolute = path.join(repoPath, relative);
          if (fs.existsSync(absolute)) {
            fileContents[relative] = fs.readFileSync(absolute, "utf8").slice(0, 8_000);
          }
        } catch {
          // Skip unreadable paths; review still has path-level checks.
        }
      }
      // Scope-relevant tree (including unchanged files) so cleanup AC can see leftover dead shims.
      const authorizedTree = listAuthorizedWorktreeFiles(repoPath, document.authorizedPathPrefixes, 64);
      for (const relative of authorizedTree) {
        if (fileContents[relative]) continue;
        if (!/\.(js|ts|mjs|cjs)$/.test(relative)) continue;
        try {
          const absolute = path.join(repoPath, relative);
          if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
            fileContents[relative] = fs.readFileSync(absolute, "utf8").slice(0, 4_000);
          }
        } catch {
          // skip
        }
      }
      let reviews = runAutonomousReviews({
        document,
        changedFiles,
        diffSummary,
        qcPassed: document.qcDelta?.objectiveQcPassed ?? true,
        fileContents,
        authorizedTree,
      });
      const grounding = {
        fileContents,
        objective: document.originalObjective,
        requirements:
          document.interpretedObjective?.requirements ?? document.requirements,
        acceptanceCriteria:
          document.interpretedObjective?.acceptanceCriteria ?? document.acceptanceCriteria,
        qcPassed: document.qcDelta?.objectiveQcPassed ?? true,
        resolvedFindingIds: (document.reviewFindingLedger ?? [])
          .filter((row) => row.status === "RESOLVED")
          .map((row) => row.findingId),
      };
      const workerReview = await maybeInvokeWorker(
        document,
        "review",
        buildReviewGroundingPrompt({
          document,
          changedFiles,
          diffSummary,
          fileContents,
          heuristicReviews: reviews,
        }),
        Boolean(deps.generatePlan),
      );
      reviews = mergeWorkerAdversarialReview(reviews, workerReview, grounding);
      document.reviews = reviews;
      if (reviewsHaveActionableDefects(reviews)) {
        const actionable = reviews.flatMap((review) => review.actionableDefects);
        const tracked = trackPostReviewFindings({
          ledger: document.reviewFindingLedger ?? [],
          actionableDefects: actionable,
          iteration: document.iterationNumber,
        });
        document.reviewFindingLedger = tracked.ledger;
        document.unresolvedDefects = tracked.openMaterial.map((summary) => ({
          id: `${findingIdFromSummary(summary)}-${document.iterationNumber}`,
          source: "review" as const,
          severity: "blocker" as const,
          summary,
          actionable: true,
        }));
        // Post-QC material defects use POST_REVIEW_REPAIR budget (not primary semantic iters).
        if (document.qcDelta?.objectiveQcPassed) {
          document.awaitingPostReviewRepair = true;
        }
        document.diagnosis = diagnoseIterationFailure({
          document,
          failureClass: "ENGINEERING_FAILURE",
          qcSummary: actionable.join("; "),
        });
        document = transitionAutonomousState(runId, "diagnosing", document).document;
        syncRun(runId, document);
        continue;
      }
      // Clear open review defects; mark ledger resolutions.
      const cleared = trackPostReviewFindings({
        ledger: document.reviewFindingLedger ?? [],
        actionableDefects: [],
        iteration: document.iterationNumber,
      });
      document.reviewFindingLedger = cleared.ledger;
      document.unresolvedDefects = [];
      document.awaitingPostReviewRepair = false;
      document = transitionAutonomousState(runId, "evaluating_completion", document).document;
      syncRun(runId, document);
      continue;
    }

    if (document.currentState === "evaluating_completion") {
      const changedFiles = await getChangedFiles(repoPath);
      const evaluation = evaluateCompletion({
        document,
        qcPassed: document.qcDelta?.objectiveQcPassed ?? false,
        changedFiles,
        reviews: document.reviews,
        repoPath,
        qcDelta: document.qcDelta,
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
      document.failureClass = null;
      document.unresolvedDefects = [];
      document.awaitingPostReviewRepair = false;
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
      generationBudgetExhausted: result.generationBudgetExhausted === true,
      telemetry: result.telemetry
        ? {
            promptTokens: result.telemetry.promptTokens,
            completionTokens: result.telemetry.completionTokens,
            reasoningTokens: result.telemetry.reasoningTokens,
            finalTokens: result.telemetry.finalTokens,
            maxTokens: result.telemetry.maxTokens,
            finishReason: result.telemetry.finishReason,
            reasoningBudget: result.telemetry.reasoningBudget,
            twoPhaseReasoning: result.telemetry.twoPhaseReasoning,
            phase1FinishReason: result.telemetry.phase1FinishReason ?? null,
            phase2FinishReason: result.telemetry.phase2FinishReason ?? null,
            generationBudgetExhausted: result.telemetry.generationBudgetExhausted,
            runtimeMode: result.telemetry.runtimeMode,
            enableThinking: result.telemetry.enableThinking,
            policy: result.telemetry.policy ?? null,
            rescueTriggered: result.telemetry.rescueTriggered === true,
            singleShotFinishReason: result.telemetry.singleShotFinishReason ?? null,
            singleShotCompletionTokens: result.telemetry.singleShotCompletionTokens ?? null,
            singleShotReasoningTokens: result.telemetry.singleShotReasoningTokens ?? null,
            singleShotFinalLen: result.telemetry.singleShotFinalLen ?? null,
            rescueReasoningBudget: result.telemetry.rescueReasoningBudget ?? null,
            finalJsonValid: result.telemetry.finalJsonValid ?? null,
            workerPlanValid: result.telemetry.workerPlanValid ?? null,
            generationRepairFailed: result.telemetry.generationRepairFailed === true,
          }
        : null,
    },
  ].slice(-24);
}

async function invokeEvidenceGroundedDiagnosis(
  document: AutonomousDocument,
  failureClass: AutonomousFailureClass,
  qcSummary: string,
  ownedEvidence: string,
  generatePlanInjected: boolean,
  repoPath?: string,
): Promise<void> {
  const unbound = parseUnboundIdentifierFindings(ownedEvidence).filter((u) => !u.isHookGlobal);
  const neighborhood =
    repoPath && unbound[0]
      ? findSymbolDependencyNeighborhood(repoPath, document.authorizedPathPrefixes, unbound[0].symbol)
      : null;
  const unboundHint = formatUnboundDependencyHint(unbound, neighborhood);
  const prompt = [
    `Failure class: ${failureClass}`,
    qcSummary,
    `Owned QC evidence (quote from this; do not invent Vitest expect if absent):\n${ownedEvidence}`,
    unboundHint,
    "Output structured diagnosis fields. Match the supplied QC evidence exactly.",
    "Do not rewrite large existing modules. Add or repair a small helper. Pre-existing failures are out of scope.",
    "If evidence mentions node:test does not provide export named 'expect', rewrite tests to: import test from 'node:test'; import assert from 'node:assert/strict' (no expect).",
    "If evidence mentions assert.throwsAsync is not a function, use await assert.rejects(async () => ...) for async subjects.",
    "If evidence shows assert.rejects / Function.rejects with a synchronous subject TypeError (TEST_ASSERTION_MODE_MISMATCH), switch to assert.throws(() => ...).",
    "If evidence mentions require is not defined in ES module scope, use import — never require() in type:module packages.",
    // UNBOUND_IDENTIFIER guidance is signature-gated via unboundHint only (not always-on).
  ].join("\n");

  const parsed = await maybeInvokeWorker(document, "diagnosis", prompt, generatePlanInjected);
  if (document.diagnosis && parsed) {
    document.diagnosis = mergeStructuredDiagnosis(document.diagnosis, parsed);
  }

  let consistency = checkDiagnosisConsistency(document.diagnosis, ownedEvidence);
  if (!consistency.authoritative && document.workerModel?.route === "live_default_worker") {
    // WP4: one retry with stronger grounding, then fall back to deterministic QC summary.
    const retryPrompt = [
      prompt,
      "PRIOR DIAGNOSIS WAS REJECTED as inconsistent with QC evidence.",
      `Unsupported claims: ${consistency.unsupportedClaims.join("; ")}`,
      "Re-diagnose using ONLY the owned QC evidence above. Do not mention expect/Vitest unless those strings appear in the evidence.",
    ].join("\n");
    const retried = await maybeInvokeWorker(document, "diagnosis", retryPrompt, generatePlanInjected);
    if (document.diagnosis && retried) {
      document.diagnosis = mergeStructuredDiagnosis(document.diagnosis, retried);
    }
    consistency = checkDiagnosisConsistency(document.diagnosis, ownedEvidence);
  }

  if (!consistency.authoritative) {
    const deterministic = diagnoseIterationFailure({
      document,
      failureClass,
      qcSummary,
      evidenceText: ownedEvidence,
      repoPath,
    });
    document.diagnosis = {
      ...deterministic,
      authoritative: false,
      contradictory_evidence: consistency.unsupportedClaims.join("; ") || "Worker diagnosis contradicted QC",
      summary: "Deterministic QC diagnosis (worker diagnosis non-authoritative).",
    };
    document.strategy = document.diagnosis.suggestedStrategy;
    document.decisions.push({
      at: new Date().toISOString(),
      kind: "diagnosis_consistency",
      summary: "Rejected inconsistent worker diagnosis; using deterministic QC summary for replan.",
      rationale: consistency.reasons.join("; "),
    });
  } else if (document.diagnosis) {
    document.diagnosis = { ...document.diagnosis, authoritative: true };
  }
}

async function maybeInvokeWorker(
  document: AutonomousDocument,
  role: "interpretation" | "investigation" | "diagnosis" | "completion" | "review",
  user: string,
  generatePlanInjected: boolean,
): Promise<Record<string, unknown> | null> {
  if (!document.workerModel || document.workerModel.route !== "live_default_worker") return null;
  const result = await invokeAutonomousWorker({ role, system: "", user }, { generatePlanInjected });
  document.usage.modelCalls += 1;
  recordWorkerInvocation(document, result);
  if (result.schemaValid && result.parsed) {
    if (role === "diagnosis" && document.diagnosis) {
      const why = result.parsed.whyPreviousFailed;
      const strategy = result.parsed.suggestedStrategy;
      if (typeof why === "string" && typeof strategy === "string") {
        document.diagnosis = mergeStructuredDiagnosis(
          {
            ...document.diagnosis,
            whyPreviousFailed: why,
            suggestedStrategy: strategy,
            filesToInspect: Array.isArray(result.parsed.filesToInspect)
              ? result.parsed.filesToInspect.filter((item): item is string => typeof item === "string")
              : document.diagnosis.filesToInspect,
          },
          result.parsed,
        );
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
      rationale:
        role === "review"
          ? "Live worker adversarial review; actionableDefects gate delivery via mergeWorkerAdversarialReview."
          : "Live default worker structured JSON (advisory for non-review roles; cannot mutate or approve).",
    });
    return result.parsed;
  }
  return null;
}
