import { getAutonomousCompletionPackage } from "../autonomous-engineer/completion-package";
import {
  hydrateQueueStoreFromDurable,
  wrapStoreWithDurablePersistence,
} from "./durable-state";
import { seniorEscalationInputFromAeSlice } from "./from-ae-run";
import { toSeniorReviewPanelView, type SeniorReviewPanelView } from "./panel-view";
import { buildSeniorEscalationPackage } from "./package";
import { requestSeniorReviewForPackage, stageSeniorReviewPackage } from "./queue";
import { getDefaultSeniorReviewQueueStore } from "./queue-store";
import type { SeniorEscalationPackage } from "./types";
import type { SeniorReviewQueueItem, SeniorReviewQueueStore } from "./queue-types";

export function seniorReviewQueueIdForRun(runId: string): string {
  return `srq_run_${runId}`;
}

const TERMINAL_KEEP = new Set(["succeeded", "failed", "cancelled", "requested"]);

function sliceFromCompletionPackage(pkg: NonNullable<ReturnType<typeof getAutonomousCompletionPackage>>) {
  return seniorEscalationInputFromAeSlice({
    runId: pkg.runId,
    taskId: pkg.taskId,
    objective: pkg.objective,
    currentStage: pkg.status,
    clarification: pkg.clarification
      ? { question: pkg.clarification.question, answer: pkg.clarification.answer }
      : null,
    investigationSummary: pkg.observations[0]?.summary ?? pkg.strategy,
    planSummary: pkg.workerPlans[0]?.summary ?? pkg.strategy,
    implementationSummary:
      pkg.workerPlans[pkg.workerPlans.length - 1]?.summary ?? pkg.completionEvaluation?.summary ?? pkg.strategy,
    testCommands: pkg.qualityGates.map((gate) => gate.command),
    testResults: pkg.qualityGates.map((gate) => ({
      command: gate.command,
      passed: gate.status === "passed" || gate.exitCode === 0,
      summary: gate.status,
    })),
    qcFailures: (pkg.qcDelta?.newFailures ?? []).map((failure) => ({
      identity: failure.identity.name,
      class: pkg.failureClass ?? "ENGINEERING_FAILURE",
      summary: failure.identity.name,
    })),
    priorAttempts: pkg.priorAttempts,
    repairAttempts: pkg.usage.planRepairs + pkg.usage.postReviewRepairs,
    budgetExhausted: pkg.status === "exhausted" || pkg.failureClass === "BUDGET_EXHAUSTED",
    knownGoodBaselineNotes: pkg.qcBaseline
      ? `Baseline failures: ${pkg.qcBaseline.failures.length}`
      : null,
    evidenceArtifacts: pkg.worktree ? [pkg.worktree.path] : [],
    openRisks: pkg.openRisks.map((risk) => risk.summary),
    deliveryCandidate: pkg.deliveryCandidateStatus === "ready",
    deliveryCandidateStatus: pkg.deliveryCandidateStatus,
    qcPassed: pkg.qcDelta?.objectiveQcPassed ?? pkg.completionEvaluation?.qcPassed,
    failureClass: pkg.failureClass,
  });
}

function resolveStore(
  runId: string,
  store: SeniorReviewQueueStore,
): SeniorReviewQueueStore {
  hydrateQueueStoreFromDurable(runId, store);
  return wrapStoreWithDurablePersistence(runId, store);
}

function stageFromRun(
  runId: string,
  env: NodeJS.ProcessEnv,
  store: SeniorReviewQueueStore,
): SeniorReviewQueueItem | null {
  const completion = getAutonomousCompletionPackage(runId);
  if (!completion) return null;
  const pkg = buildSeniorEscalationPackage(sliceFromCompletionPackage(completion));
  return stageSeniorReviewPackage({
    package: pkg,
    id: seniorReviewQueueIdForRun(runId),
    env,
    store,
  });
}

export function loadSeniorReviewPanelForRun(
  runId: string,
  options: {
    env?: NodeJS.ProcessEnv;
    store?: SeniorReviewQueueStore;
    package?: SeniorEscalationPackage;
  } = {},
): SeniorReviewPanelView | null {
  const memory = options.store ?? getDefaultSeniorReviewQueueStore();
  const store = resolveStore(runId, memory);
  const env = options.env ?? process.env;
  const existing = store.get(seniorReviewQueueIdForRun(runId));
  if (existing && TERMINAL_KEEP.has(existing.status)) {
    return toSeniorReviewPanelView(existing);
  }
  if (options.package) {
    return toSeniorReviewPanelView(stageSeniorReviewPackage({
      package: options.package,
      id: seniorReviewQueueIdForRun(runId),
      env,
      store,
    }));
  }
  const item = stageFromRun(runId, env, store);
  return item ? toSeniorReviewPanelView(item) : existing ? toSeniorReviewPanelView(existing) : null;
}

export async function requestSeniorReviewForRun(input: {
  runId: string;
  operatorId: string;
  confirmationText: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  store?: SeniorReviewQueueStore;
  package?: SeniorEscalationPackage;
}): Promise<{ view: SeniorReviewPanelView | null; blockedWithoutCall: boolean }> {
  const memory = input.store ?? getDefaultSeniorReviewQueueStore();
  const store = resolveStore(input.runId, memory);
  const env = input.env ?? process.env;
  if (!store.get(seniorReviewQueueIdForRun(input.runId))) {
    if (input.package) {
      stageSeniorReviewPackage({
        package: input.package,
        id: seniorReviewQueueIdForRun(input.runId),
        env,
        store,
      });
    } else {
      stageFromRun(input.runId, env, store);
    }
  }

  const result = await requestSeniorReviewForPackage({
    itemId: seniorReviewQueueIdForRun(input.runId),
    operatorRequested: true,
    operatorId: input.operatorId,
    confirmationText: input.confirmationText,
    env,
    fetchFn: input.fetchFn,
    store,
  });

  if (!result.item) {
    return { view: loadSeniorReviewPanelForRun(input.runId, { env, store: memory }), blockedWithoutCall: true };
  }

  return {
    view: toSeniorReviewPanelView(result.item),
    blockedWithoutCall: result.invocation === null,
  };
}
