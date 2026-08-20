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
}

export interface AutonomousBudgetUsage {
  iterations: number;
  plans: number;
  modelCalls: number;
  changedFiles: number;
  changedBytes: number;
  runtimeMs: number;
  investigationReads: number;
  contextBytes: number;
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

export interface CompletionEvaluation {
  complete: boolean;
  summary: string;
  unmetAcceptanceCriteria: string[];
  unmetRequirements: string[];
  defectsBlocking: string[];
  qcPassed: boolean;
  reviewsPassed: boolean;
  withinAuthority: boolean;
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
  worktreeId: string | null;
  startedAt: string;
  updatedAt: string;
  pausedAt: string | null;
  directorAbortReason: string | null;
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
