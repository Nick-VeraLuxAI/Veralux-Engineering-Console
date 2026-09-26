export const AUTONOMOUS_ENGINEER_MODE = "autonomous_engineer_v1";
export const AUTONOMOUS_STATE_VERSION = 1;

export const AUTONOMOUS_STATES = [
  "created",
  "investigating",
  "interpreting",
  "waiting_for_director",
  "planning",
  "validating",
  "executing",
  "quality_checking",
  "diagnosing",
  "reviewing",
  "evaluating_completion",
  "waiting_for_approval",
  "exhausted",
  "failed",
  "aborted",
] as const;

export type AutonomousState = (typeof AUTONOMOUS_STATES)[number];

export const AUTONOMOUS_FAILURE_CLASSES = [
  "ENGINEERING_FAILURE",
  "MODEL_OUTPUT_FAILURE",
  "GENERATION_BUDGET_EXHAUSTED",
  "VALIDATION_FAILURE",
  "INFRASTRUCTURE_FAILURE",
  "POLICY_BLOCK",
  "DIRECTOR_DECISION_REQUIRED",
  "GOVERNANCE_AUTHORIZATION_REQUIRED",
  "BUDGET_EXHAUSTED",
] as const;

export type AutonomousFailureClass = (typeof AUTONOMOUS_FAILURE_CLASSES)[number];

export const UNKNOWN_CLASSES = [
  "discoverable",
  "engineering",
  "director",
  "governance",
] as const;

export type UnknownClass = (typeof UNKNOWN_CLASSES)[number];

export const DELIVERY_CANDIDATE_STATUSES = [
  "not_ready",
  "ready",
  "blocked",
  "withdrawn",
] as const;

export type DeliveryCandidateStatus = (typeof DELIVERY_CANDIDATE_STATUSES)[number];

export interface AutonomousBudgetConfig {
  max_iterations: number;
  max_plans: number;
  max_model_calls: number;
  max_changed_files: number;
  max_changed_bytes: number;
  max_runtime_ms: number;
  max_investigation_reads: number;
  max_context_bytes: number;
  /** Optional bound on pre-execution PLAN_REPAIR attempts (defaults via resolveMaxPlanRepairs). */
  max_plan_repairs?: number;
  /**
   * Bounded repairs after QC PASS when material review defects remain.
   * Does not raise primary semantic max_iterations (default 2).
   */
  max_post_review_repairs?: number;
}

export interface AutonomousBudgetUsage {
  /** Semantic ENGINEERING_ITERATION count only (valid plan executed + QC/review/completion). */
  iterations: number;
  plans: number;
  modelCalls: number;
  changedFiles: number;
  changedBytes: number;
  runtimeMs: number;
  investigationReads: number;
  contextBytes: number;
  /** Pre-execution plan repairs that must not burn semantic iterations. */
  planRepairs: number;
  /** Post-QC review repairs (bounded; does not burn semantic iterations). */
  postReviewRepairs: number;
}

export interface AutonomousAuthorityEnvelope {
  authorizedRepoPath: string;
  registeredRepoId: string | null;
  authorizedPathPrefixes: string[];
  canMutateViaWorkerPlan: boolean;
  canSelfApprove: boolean;
  canCreatePr: boolean;
  canMerge: boolean;
  canDeploy: boolean;
  canBypassValidation: boolean;
  canBypassQualityGates: boolean;
  canUseUnrestrictedShell: boolean;
  actor: "autonomous_executor";
}

export interface ClassifiedUnknown {
  id: string;
  statement: string;
  classification: UnknownClass;
  reason: string;
  resolved: boolean;
  resolution?: string;
}

export interface ObjectiveInterpretation {
  objectiveSummary: string;
  requirements: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  assumptions: string[];
  unknowns: ClassifiedUnknown[];
  clarificationRequired: boolean;
  clarificationQuestions: string[];
  initialInvestigationTargets: string[];
}

export interface InvestigationObservation {
  at: string;
  operation: string;
  summary: string;
  detail?: string;
  paths?: string[];
}

export interface AutonomousDecision {
  at: string;
  kind: string;
  summary: string;
  rationale: string;
}

export interface PriorAttemptRecord {
  iteration: number;
  workerPlanId: string | null;
  strategy: string;
  outcome: "passed" | "failed" | "blocked" | "skipped";
  failureClass: AutonomousFailureClass | null;
  summary: string;
  qcSummary?: string;
}

export interface FailedHypothesis {
  iteration: number;
  hypothesis: string;
  whyFailed: string;
}

export interface QcObservation {
  iteration: number;
  at: string;
  passed: boolean;
  failedCommands: string[];
  summary: string;
}

export interface UnresolvedDefect {
  id: string;
  source: "qc" | "review" | "completion" | "governance";
  severity: "blocker" | "major" | "minor";
  summary: string;
  actionable: boolean;
}

export interface OpenRisk {
  id: string;
  summary: string;
  class: AutonomousFailureClass | "regression" | "scope" | "unknown";
}

export interface ClarificationRecord {
  question: string;
  context: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
}

export interface AcceptanceCriterionEvidence {
  criterion: string;
  status: "SATISFIED" | "UNSATISFIED" | "UNVERIFIED";
  detail: string;
}

export interface CompletionEvaluation {
  complete: boolean;
  summary: string;
  unmetAcceptanceCriteria: string[];
  unmetRequirements: string[];
  defectsBlocking: string[];
  qcPassed: boolean;
  reviewsPassed: boolean;
  withinAuthority: boolean;
  acceptanceEvidence?: AcceptanceCriterionEvidence[];
}

export type AutonomousReviewKind =
  | "requirements"
  | "diff_quality"
  | "regression_risk"
  | "scope"
  | "engineering_quality"
  | "worker_adversarial";

export interface AutonomousReviewFinding {
  review: AutonomousReviewKind;
  passed: boolean;
  findings: string[];
  actionableDefects: string[];
}

export interface DiagnosisResult {
  advisory: true;
  failureClass: AutonomousFailureClass;
  summary: string;
  failedHypothesis: string;
  whyPreviousFailed: string;
  suggestedStrategy: string;
  filesToInspect: string[];
  doNotMutate: true;
  /** Evidence-grounded fields (WP3). Optional for backward compatibility. */
  observed_failure?: string;
  evidence_quote_or_signature?: string;
  affected_file_or_gate?: string;
  root_cause_hypothesis?: string;
  confidence?: "low" | "medium" | "high";
  contradictory_evidence?: string;
  recommended_strategy_change?: string;
  avoid_repeating?: string;
  /** WP4: false when diagnosis claims contradict QC evidence. */
  authoritative?: boolean;
}

export interface FailureSignatureRecord {
  signature: string;
  iterations: number[];
  count: number;
}

export interface AutonomousWorkerInvocationTrace {
  role: string;
  providerName: string;
  modelName: string;
  requestPath: string;
  schemaValid: boolean;
  parseErrors: string[];
  schemaErrors: string[];
  repairAttempted: boolean;
  accepted: boolean;
  generationBudgetExhausted?: boolean;
  telemetry?: {
    promptTokens: number | null;
    completionTokens: number | null;
    reasoningTokens: number | null;
    finalTokens: number | null;
    maxTokens: number;
    finishReason: string | null;
    reasoningBudget: number | null;
    twoPhaseReasoning: boolean;
    phase1FinishReason: string | null;
    phase2FinishReason: string | null;
    generationBudgetExhausted: boolean;
    runtimeMode: string;
    enableThinking: boolean;
    policy?: string | null;
    rescueTriggered?: boolean;
    singleShotFinishReason?: string | null;
    singleShotCompletionTokens?: number | null;
    singleShotReasoningTokens?: number | null;
    singleShotFinalLen?: number | null;
    rescueReasoningBudget?: number | null;
    finalJsonValid?: boolean | null;
    workerPlanValid?: boolean | null;
    generationRepairFailed?: boolean;
  } | null;
}

export interface AutonomousWorkerModelTrace {
  route: string;
  providerName: string;
  modelName: string;
  mockBypassed: boolean;
  rolesInvoked: string[];
  requestPath?: string;
  lastInvocations?: AutonomousWorkerInvocationTrace[];
}

export interface AutonomousDocument {
  version: number;
  mode: typeof AUTONOMOUS_ENGINEER_MODE;
  originalObjective: string;
  interpretedObjective: ObjectiveInterpretation | null;
  requirements: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  authorizedRepoPath: string;
  authorizedPathPrefixes: string[];
  authorityEnvelope: AutonomousAuthorityEnvelope;
  currentState: AutonomousState;
  iterationNumber: number;
  budget: AutonomousBudgetConfig;
  usage: AutonomousBudgetUsage;
  strategy: string | null;
  observations: InvestigationObservation[];
  assumptions: string[];
  decisions: AutonomousDecision[];
  priorAttempts: PriorAttemptRecord[];
  failedHypotheses: FailedHypothesis[];
  currentPlanId: string | null;
  previousPlanId: string | null;
  qcObservations: QcObservation[];
  qcBaseline: import("./qc-baseline").QcBaselineSnapshot | null;
  qcDelta: import("./qc-baseline").QcDelta | null;
  workerModel: AutonomousWorkerModelTrace | null;
  unresolvedDefects: UnresolvedDefect[];
  openRisks: OpenRisk[];
  clarification: ClarificationRecord | null;
  escalationReason: string | null;
  failureClass: AutonomousFailureClass | null;
  completionEvaluation: CompletionEvaluation | null;
  deliveryCandidateStatus: DeliveryCandidateStatus;
  reviews: AutonomousReviewFinding[];
  diagnosis: DiagnosisResult | null;
  /** Compact within-run harness failure signature history (WP5). */
  failureSignatureHistory?: FailureSignatureRecord[];
  /** Last planning charge kind (PLAN_REPAIR / POST_REVIEW_REPAIR do not burn semantic iterations). */
  lastIterationChargeKind?: import("./plan-repair").IterationChargeKind | null;
  /** Persisted plan-repair audit trail. */
  planRepairHistory?: import("./plan-repair").PlanRepairRecord[];
  /** True when diagnosing/planning after QC PASS with material review defects. */
  awaitingPostReviewRepair?: boolean;
  /** Finding ledger for post-QC review ping-pong prevention. */
  reviewFindingLedger?: import("./post-review-repair").ReviewFindingRecord[];
  /** FAITHFUL | DEGRADED | CONTROL — recorded when Nano runtime mode is resolved. */
  nanoRuntimeMode?: "FAITHFUL" | "DEGRADED" | "CONTROL" | null;
  worktreeId: string | null;
  startedAt: string;
  updatedAt: string;
  pausedAt: string | null;
  directorAbortReason: string | null;
  /**
   * Advisory senior-review evidence. Not a release gate.
   * Preserved when the AE loop persists a document that omits this field.
   */
  seniorReview?: import("../senior-escalation/durable-types").DurableSeniorReviewState;
  /** Scaffold protection state (contract freeze, senior hard constraints). */
  scaffoldGuard?: {
    contractsFrozen?: boolean;
    integrationCrib?: string;
    seniorHardConstraint?: {
      nextWorkerMission: string;
      rootCause?: string;
      issuedAt: string;
    };
  };
}

export interface AutonomousRunStateRecord {
  id: string;
  runId: string;
  version: number;
  mode: string;
  currentState: AutonomousState;
  iterationNumber: number;
  failureClass: AutonomousFailureClass | null;
  deliveryCandidateStatus: DeliveryCandidateStatus | null;
  document: AutonomousDocument;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousLoopResult {
  runId: string;
  state: AutonomousState;
  failureClass: AutonomousFailureClass | null;
  deliveryCandidateStatus: DeliveryCandidateStatus;
  paused: boolean;
  message: string;
}
