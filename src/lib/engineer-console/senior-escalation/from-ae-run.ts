import type { SeniorEscalationInput } from "./types";

export type AeSeniorReviewSlice = {
  runId: string;
  taskId: string;
  objective: string;
  currentStage: string;
  runtimeMode?: string | null;
  clarification?: { question: string; answer: string | null } | null;
  investigationSummary?: string | null;
  planSummary?: string | null;
  implementationSummary?: string | null;
  changedFiles?: string[];
  diffSummary?: string | null;
  testCommands?: string[];
  testResults?: Array<{ command: string; passed: boolean; summary?: string }>;
  qcFailures?: Array<{ identity?: string; class?: string; summary: string }>;
  priorAttempts?: Array<{
    iteration?: number;
    failureClass?: string | null;
    summary?: string;
    outcome?: string;
  }>;
  repairAttempts?: number;
  budgetExhausted?: boolean;
  knownGoodBaselineNotes?: string | null;
  evidenceArtifacts?: string[];
  openRisks?: string[];
  deliveryCandidate?: boolean;
  deliveryCandidateStatus?: string | null;
  qcPassed?: boolean;
  failureClass?: string | null;
};

export function seniorEscalationInputFromAeSlice(slice: AeSeniorReviewSlice): SeniorEscalationInput {
  return {
    taskId: slice.taskId,
    runId: slice.runId,
    objective: slice.objective,
    currentStage: slice.currentStage,
    runtimeMode: slice.runtimeMode,
    clarificationHistory: slice.clarification
      ? [{ question: slice.clarification.question, answer: slice.clarification.answer }]
      : [],
    investigationSummary: slice.investigationSummary ?? null,
    planSummary: slice.planSummary ?? null,
    implementationSummary: slice.implementationSummary ?? null,
    changedFiles: slice.changedFiles ?? [],
    diffSummary: slice.diffSummary ?? null,
    testCommands: slice.testCommands ?? [],
    testResults: slice.testResults ?? [],
    qcFailures: slice.qcFailures ?? [],
    priorAttempts: slice.priorAttempts ?? [],
    repairAttempts: slice.repairAttempts,
    budgetExhausted: slice.budgetExhausted,
    knownGoodBaselineNotes: slice.knownGoodBaselineNotes ?? null,
    evidenceArtifacts: slice.evidenceArtifacts ?? [],
    openRisks: slice.openRisks ?? [],
    deliveryCandidate: slice.deliveryCandidate,
    deliveryCandidateStatus: slice.deliveryCandidateStatus,
    qcPassed: slice.qcPassed,
    failureClass: slice.failureClass,
  };
}
