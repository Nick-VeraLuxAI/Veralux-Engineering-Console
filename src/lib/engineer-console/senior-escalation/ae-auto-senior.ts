import type { AutonomousDocument } from "../autonomous-engineer/types";
import type { QualityGateCommandResult } from "../quality-gates/quality-gate-runner";
import { resolveNanoRuntimeMode } from "../autonomous-engineer/nano-faithful-invocation";
import type { QcDelta } from "../autonomous-engineer/qc-baseline";
import {
  isSeniorEscalationAutoCallAllowed,
  isSeniorEscalationWiredIntoAeLoop,
} from "./auto-call-config";
import { persistQueueItemToRun } from "./durable-state";
import { seniorEscalationInputFromAeSlice } from "./from-ae-run";
import { invokeSeniorReview } from "./invoke";
import { buildSeniorEscalationPackage } from "./package";
import { applyInvocationToItem, stageSeniorReviewPackage } from "./queue";
import { seniorReviewQueueIdForRun } from "./run-panel";
import { getDefaultSeniorReviewQueueStore } from "./queue-store";
import type { SeniorEscalationReason } from "./types";
import { shouldFreezeContractsAfterRepairs } from "../autonomous-engineer/scaffold-contract-guard";
import {
  MEMORY_MODULE_API_CRIB,
  objectiveNeedsIntegrationGrounding,
} from "../autonomous-engineer/integration-grounding";

const REPAIR_ESCALATION_REASONS = new Set<SeniorEscalationReason>([
  "failed_qc",
  "repeated_failure_class",
  "repair_loop_exhausted",
]);

const AE_AUTO_OPERATOR = "ae-loop-auto" as const;

export type AeAutoSeniorQcContext = {
  document: AutonomousDocument;
  runId: string;
  taskId: string;
  objective: string;
  repoPath: string;
  qcSummary: string;
  changedFiles: string[];
  delta: QcDelta;
  qc: QualityGateCommandResult[];
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  now?: () => string;
};

function clock(now?: () => string): string {
  return now?.() ?? new Date().toISOString();
}

function repairReasons(reasons: SeniorEscalationReason[]): SeniorEscalationReason[] {
  return reasons.filter((reason) => REPAIR_ESCALATION_REASONS.has(reason));
}

function shouldTriggerAutoSenior(
  pkg: ReturnType<typeof buildSeniorEscalationPackage>,
  document: AutonomousDocument,
): boolean {
  if (!pkg.decision.shouldEscalate) return false;
  const actionable = repairReasons(pkg.decision.reasons);
  if (actionable.length === 0) return false;

  const failedAttempts = document.priorAttempts.filter((item) => item.outcome === "failed").length;
  if (
    failedAttempts < 1
    && document.iterationNumber < 2
    && !actionable.includes("repair_loop_exhausted")
    && !actionable.includes("repeated_failure_class")
  ) {
    return false;
  }

  const sr = document.seniorReview;
  if (!sr) return true;
  const stagedRepair = sr.stagedPackage?.packageSnapshot.repairAttempts;
  const currentRepair = pkg.repairAttempts;
  if (sr.latestStatus === "succeeded" && stagedRepair === currentRepair) {
    return false;
  }
  if (
    sr.latestStatus === "blocked"
    && sr.stagedPackage?.gateStatus.reasonCodes.includes("senior_endpoint_unavailable")
    && stagedRepair === currentRepair
  ) {
    return false;
  }
  return true;
}

function buildSlice(input: AeAutoSeniorQcContext) {
  const { document, runId, taskId, objective, repoPath, qcSummary, changedFiles, delta, qc } = input;
  const lastAttempt = document.priorAttempts[document.priorAttempts.length - 1];
  return seniorEscalationInputFromAeSlice({
    runId,
    taskId,
    objective,
    currentStage: document.currentState,
    runtimeMode: resolveNanoRuntimeMode(input.env ?? process.env) ?? document.nanoRuntimeMode ?? null,
    clarification: document.clarification
      ? { question: document.clarification.question, answer: document.clarification.answer ?? null }
      : null,
    investigationSummary: document.observations.at(-1)?.summary ?? document.strategy,
    planSummary: lastAttempt?.strategy ?? document.strategy,
    implementationSummary: lastAttempt?.summary ?? document.strategy,
    changedFiles,
    diffSummary: qcSummary,
    testCommands: qc.map((gate) => gate.command),
    testResults: qc.map((gate) => ({
      command: gate.command,
      passed: gate.status === "passed" || gate.exitCode === 0,
      summary: gate.status,
    })),
    qcFailures: (delta.ownedIterationFailures ?? delta.newFailures ?? []).map((failure) => ({
      identity: failure.identity.name,
      class: document.failureClass ?? "ENGINEERING_FAILURE",
      summary: failure.identity.name,
    })),
    priorAttempts: document.priorAttempts,
    repairAttempts: document.usage.planRepairs + document.usage.postReviewRepairs,
    budgetExhausted: document.currentState === "exhausted" || document.failureClass === "BUDGET_EXHAUSTED",
    knownGoodBaselineNotes: document.qcBaseline
      ? `Baseline failures: ${document.qcBaseline.failures.length}`
      : null,
    evidenceArtifacts: repoPath ? [repoPath] : [],
    openRisks: document.openRisks.map((risk) => risk.summary),
    deliveryCandidate: document.deliveryCandidateStatus === "ready",
    deliveryCandidateStatus: document.deliveryCandidateStatus,
    qcPassed: false,
    failureClass: document.failureClass,
  });
}

function applySeniorGuidanceToDocument(
  document: AutonomousDocument,
  parsed: NonNullable<Awaited<ReturnType<typeof invokeSeniorReview>>["parsedReview"]>,
  at: string,
  repoPath?: string,
): AutonomousDocument {
  document.observations.push({
    at,
    operation: "senior_auto_review",
    summary: parsed.nextWorkerMission.slice(0, 500),
    detail: [
      `rootCause: ${parsed.rootCause}`,
      `nextWorkerMission: ${parsed.nextWorkerMission}`,
      `qcGates: ${parsed.qcGates.join(", ")}`,
    ].join("\n"),
  });

  const contractsFrozen =
    document.scaffoldGuard?.contractsFrozen === true
    || shouldFreezeContractsAfterRepairs(document.planRepairHistory);

  const integrationCrib =
    repoPath?.includes("Memory-Module") && objectiveNeedsIntegrationGrounding({
      objective: document.originalObjective,
      requirements: document.requirements,
      acceptanceCriteria: document.acceptanceCriteria,
    })
      ? MEMORY_MODULE_API_CRIB
      : undefined;

  document.scaffoldGuard = {
    ...document.scaffoldGuard,
    contractsFrozen,
    integrationCrib,
    seniorHardConstraint: {
      nextWorkerMission: parsed.nextWorkerMission,
      rootCause: parsed.rootCause,
      issuedAt: at,
    },
  };

  const priorDiagnosis = document.diagnosis;
  document.diagnosis = {
    advisory: true,
    failureClass: document.failureClass ?? "ENGINEERING_FAILURE",
    summary: `Senior advisory: ${parsed.rootCause}`.slice(0, 500),
    failedHypothesis: priorDiagnosis?.failedHypothesis ?? "Prior worker plan did not satisfy QC.",
    whyPreviousFailed: priorDiagnosis?.whyPreviousFailed ?? parsed.rootCause,
    suggestedStrategy: parsed.nextWorkerMission,
    filesToInspect: priorDiagnosis?.filesToInspect ?? [],
    doNotMutate: true,
    root_cause_hypothesis: parsed.rootCause,
    authoritative: true,
    avoid_repeating: priorDiagnosis?.avoid_repeating,
    evidence_quote_or_signature: priorDiagnosis?.evidence_quote_or_signature,
  };

  return document;
}

/**
 * After a QC failure, optionally invoke DeepSeek senior when env auto-call is enabled.
 * Advisory only — human release gates remain required.
 */
export async function maybeAutoInvokeSeniorAfterQcFailure(
  input: AeAutoSeniorQcContext,
): Promise<AutonomousDocument> {
  const env = input.env ?? process.env;
  if (!isSeniorEscalationWiredIntoAeLoop(env) || !isSeniorEscalationAutoCallAllowed(env)) {
    return input.document;
  }

  const pkg = buildSeniorEscalationPackage(buildSlice(input), env);
  if (!shouldTriggerAutoSenior(pkg, input.document)) {
    return input.document;
  }

  const store = getDefaultSeniorReviewQueueStore();
  const itemId = seniorReviewQueueIdForRun(input.runId);
  const at = clock(input.now);
  const staged = stageSeniorReviewPackage({
    package: pkg,
    id: itemId,
    env,
    store,
    now: input.now,
  });

  const requested = {
    ...staged,
    status: "requested" as const,
    operatorRequest: {
      requestedBy: AE_AUTO_OPERATOR,
      requestedAt: at,
      confirmationText: "REQUEST_SENIOR_REVIEW",
    },
    updatedAt: at,
  };
  store.put(requested);

  const invocation = await invokeSeniorReview({
    package: requested.packageSnapshot,
    operatorApproval: {
      approved: true,
      invocationRequested: true,
      approvedBy: AE_AUTO_OPERATOR,
      approvedAt: at,
      packageTaskId: requested.taskId,
      packageRunId: requested.runId,
    },
    env,
    fetchFn: input.fetchFn,
    autoInvocation: true,
  });

  const nextItem = applyInvocationToItem(requested, invocation, at);
  store.put(nextItem);
  const durable = persistQueueItemToRun(input.runId, nextItem, input.now);
  if (durable) {
    input.document.seniorReview = durable;
  }

  input.document.observations.push({
    at,
    operation: "senior_auto_invoke",
    summary: `Senior auto-invocation ${invocation.status}: ${invocation.requestSummary}`.slice(0, 500),
    detail:
      invocation.status === "blocked"
        ? `blocked=${invocation.blockedReasons.join(",")}`
        : invocation.status,
  });

  if (invocation.status === "succeeded" && invocation.parsedReview) {
    applySeniorGuidanceToDocument(input.document, invocation.parsedReview, at, input.repoPath);
  }

  return input.document;
}
