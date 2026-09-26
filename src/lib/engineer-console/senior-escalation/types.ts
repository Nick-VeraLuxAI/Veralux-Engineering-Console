import type { AeRuntimeProfileId, AeWorkerRuntimeProfile } from "../model-router/ae-runtime-profiles";

export const SENIOR_ESCALATION_PACKAGE_V1_ID = "senior-escalation-package-v1" as const;

export const SENIOR_ESCALATION_AUTO_CALL_ALLOWED = false;
export const SENIOR_ESCALATION_AUTO_SERVE = false;
export const SENIOR_ESCALATION_WIRED_INTO_AE_LOOP = false;

export const SENIOR_ESCALATION_REASONS = [
  "architecture_review",
  "failed_qc",
  "repair_loop_exhausted",
  "repeated_failure_class",
  "pr_readiness_review",
  "approval_gate_risk",
  "persistent_state_risk",
  "auth_or_security_risk",
  "data_contract_risk",
  "large_context_diagnosis",
] as const;

export type SeniorEscalationReason = (typeof SENIOR_ESCALATION_REASONS)[number];

export type SeniorEscalationClarification = {
  question: string;
  answer?: string | null;
};

export type SeniorEscalationTestResult = {
  command: string;
  passed: boolean;
  summary?: string;
};

export type SeniorEscalationQcFailure = {
  identity?: string;
  class?: string;
  summary: string;
};

export type SeniorEscalationPriorAttempt = {
  iteration?: number;
  failureClass?: string | null;
  summary?: string;
  outcome?: string;
};

export type SeniorEscalationDomainSignals = {
  architecture?: boolean;
  persistentState?: boolean;
  authOrSecurity?: boolean;
  payment?: boolean;
  approvalGates?: boolean;
  orchestration?: boolean;
  dataContract?: boolean;
  largeContext?: boolean;
};

export type SeniorEscalationInput = {
  taskId?: string | null;
  runId?: string | null;
  objective: string;
  currentStage?: string | null;
  workerProfileId?: AeRuntimeProfileId | string;
  runtimeMode?: "FAITHFUL" | "DEGRADED" | "CONTROL" | string | null;
  clarificationHistory?: SeniorEscalationClarification[];
  investigationSummary?: string | null;
  planSummary?: string | null;
  implementationSummary?: string | null;
  changedFiles?: string[];
  diffSummary?: string | null;
  testCommands?: string[];
  testResults?: SeniorEscalationTestResult[];
  qcFailures?: SeniorEscalationQcFailure[];
  repeatedFailureClasses?: string[];
  priorAttempts?: SeniorEscalationPriorAttempt[];
  repairAttempts?: number;
  maxRepairAttempts?: number;
  repairBudgetExhausted?: boolean;
  budgetExhausted?: boolean;
  failureClass?: string | null;
  knownGoodBaselineNotes?: string | null;
  evidenceArtifacts?: string[];
  openRisks?: string[];
  seniorQuestion?: string | null;
  deliveryCandidate?: boolean;
  deliveryCandidateStatus?: string | null;
  prReadiness?: boolean;
  qcPassed?: boolean;
  domainSignals?: SeniorEscalationDomainSignals;
  deepSeekManuallyServing?: boolean;
};

export type SeniorEscalationDecision = {
  shouldEscalate: boolean;
  reasons: SeniorEscalationReason[];
  recommendedProfile: "deepseek-senior";
  requiresManualServe: true;
  autoCallAllowed: boolean;
  autoServe: false;
  humanReadableSummary: string;
};

export type SeniorEscalationPackage = {
  id: typeof SENIOR_ESCALATION_PACKAGE_V1_ID;
  taskId: string | null;
  runId: string | null;
  objective: string;
  currentStage: string | null;
  workerProfile: Pick<AeWorkerRuntimeProfile, "id" | "role" | "openaiBaseUrl">;
  runtimeMode: string | null;
  clarificationHistory: SeniorEscalationClarification[];
  investigationSummary: string | null;
  planSummary: string | null;
  implementationSummary: string | null;
  changedFiles: string[];
  diffSummary: string | null;
  testCommands: string[];
  testResults: SeniorEscalationTestResult[];
  qcFailures: SeniorEscalationQcFailure[];
  repeatedFailureClasses: string[];
  repairAttempts: number;
  budgetExhaustion: {
    exhausted: boolean;
    repairBudgetExhausted: boolean;
  };
  knownGoodBaselineNotes: string | null;
  evidenceArtifacts: string[];
  openRisks: string[];
  seniorQuestion: string;
  decision: SeniorEscalationDecision;
  seniorProfile: {
    id: "deepseek-senior";
    status: "on_demand";
    openaiBaseUrl: string;
    model: string;
    autoServe: false;
    autoCallAllowed: boolean;
    requiresManualServe: true;
    concurrentWithNano: false;
    manuallyServing: boolean;
  };
  liveInvocation: {
    attempted: false;
    networkCallMade: false;
  };
  promptText: string;
};
