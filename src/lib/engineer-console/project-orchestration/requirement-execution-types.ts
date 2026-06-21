export const ATTEMPT_STATUSES = [
  "pending",
  "assigned",
  "dispatched",
  "running",
  "evaluating",
  "verification",
  "succeeded",
  "failed",
  "retry_scheduled",
  "blocked",
  "cancelled",
  "abandoned",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTEMPT_OUTCOMES = [
  "implementation_complete",
  "implementation_incomplete",
  "tests_failed",
  "quality_gates_failed",
  "execution_error",
  "worker_timeout",
  "invalid_output",
  "scope_violation",
  "no_progress",
  "conflict",
  "approval_required",
  "cancelled",
  "readiness_failed",
  "dependency_hydration_failed",
  "context_budget_exceeded",
] as const;

export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const FAILURE_CATEGORIES = [
  "worker_execution_failure",
  "tool_failure",
  "timeout",
  "invalid_worker_output",
  "plan_validation_failure",
  "compile_failure",
  "test_failure",
  "lint_failure",
  "typecheck_failure",
  "build_failure",
  "quality_gate_failure",
  "scope_violation",
  "forbidden_file_change",
  "repository_conflict",
  "no_meaningful_change",
  "repeated_failure",
  "approval_required",
  "unknown_failure",
  "readiness_failed",
  "dependency_hydration_failed",
  "context_budget_exceeded",
  "post_tool_continuation_stalled_no_diff",
  "post_tool_continuation_stalled_with_diff",
  "workspace_identity_mismatch",
  "repository_identity_missing",
  "policy_violation",
  "transport_failure_before_side_effects",
  "indeterminate_after_side_effects",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export const RETRY_STRATEGIES = [
  "initial_implementation",
  "repair_from_test_failure",
  "repair_from_build_failure",
  "narrow_scope_diagnostic",
  "reinspect_repository",
  "alternative_implementation",
  "senior_model_review",
  "human_escalation",
] as const;

export type RetryStrategy = (typeof RETRY_STRATEGIES)[number];

export interface RequirementExecutionAttempt {
  id: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  runId: string | null;
  attemptNumber: number;
  status: AttemptStatus;
  workerRole: string;
  modelProvider: string;
  modelName: string;
  strategy: RetryStrategy;
  startedAt: string | null;
  completedAt: string | null;
  outcome: AttemptOutcome | null;
  failureCategory: FailureCategory | null;
  failureFingerprint: string | null;
  failureSummary: string | null;
  retryable: boolean;
  filesChangedSummary: string;
  commandsExecutedSummary: string;
  testSummary: string;
  qualityGateSummary: string;
  evidenceBundleId: string | null;
  supersedesAttemptId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerAssignmentCriterion {
  id: string;
  stableKey: string;
  description: string;
  verificationType: string;
}

export interface WorkerAssignmentContract {
  project_id: string;
  requirement_id: string;
  task_id: string;
  attempt_id: string;
  objective: string;
  requirement_description: string;
  acceptance_criteria: WorkerAssignmentCriterion[];
  dependencies: Array<{ requirement_id: string; stable_key?: string; status?: string }>;
  allowed_paths: string[];
  forbidden_paths: string[];
  required_checks: string[];
  execution_limits: {
    max_runtime_seconds: number;
    max_tool_calls: number;
    max_repair_cycles: number;
  };
  repository_state: {
    branch: string | null;
    base_commit: string | null;
    working_tree_policy: string;
  };
  model_routing?: {
    model_role_id: string;
    requested_model_name: string;
    requested_provider: string;
    requested_endpoint: string;
    selected_model_role_id: string | null;
    selected_model_name: string | null;
    selected_provider: string | null;
    selected_endpoint: string | null;
    runtime: string | null;
    context_window: number | null;
    transport_policy: Record<string, unknown>;
    fallback_used: boolean;
    fallback_reason: string | null;
    benchmark_status: string;
    routing_decision_id: string;
    route_status: string;
    repository_write_allowed: boolean;
    blocked_details?: {
      role: string;
      expected_endpoint: string;
      expected_model: string;
      failure_reason: string;
      next_operator_action: string;
    } | null;
  };
  workspace?: {
    workspace_id: string;
    repository_id: string;
    worktree_path: string;
    branch_name: string;
    base_branch: string;
    base_commit: string;
    source_attempt_id: string | null;
  };
  scope?: {
    allowed_paths: string[];
    forbidden_paths: string[];
    exclusive_claims: string[];
  };
  completion_contract: {
    return_changed_files: boolean;
    return_commands: boolean;
    return_test_results: boolean;
    return_known_limitations: boolean;
    return_evidence: boolean;
  };
  self_verification_allowed: false;
  context_package?: {
    estimated_tokens: number;
    max_initial_tokens: number;
    reserved_tokens: number;
    selected_files: Array<{ path: string; reason: string }>;
    omitted_context: string[];
    truncations: string[];
  };
}

export interface AttemptReadinessResult {
  id: string;
  attemptId: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  workspaceId: string | null;
  repositoryId: string | null;
  status: "ready" | "not_ready";
  checks: Array<{ name: string; status: "passed" | "failed" | "warning"; message: string }>;
  warnings: string[];
  blockers: string[];
  repositoryIdentity: Record<string, unknown>;
  workspaceIdentity: Record<string, unknown>;
  dependencyState: Record<string, unknown>;
  contextEstimate: Record<string, unknown>;
  requiredCommands: string[];
  createdAt: string;
}

export interface WorkerAssignmentRecord {
  id: string;
  attemptId: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  assignmentJson: string;
  validationStatus: "valid" | "invalid";
  validationErrorsJson: string;
  assignmentHash: string;
  createdAt: string;
}

export interface AttemptFailureRecord {
  id: string;
  attemptId: string;
  projectId: string;
  requirementId: string;
  runId: string | null;
  category: FailureCategory;
  summary: string;
  detailsJson: string;
  retryable: boolean;
  fingerprint: string;
  associatedCommand: string | null;
  affectedFilesJson: string;
  createdAt: string;
}

export interface QualityBaselineRecord {
  id: string;
  projectId: string;
  repoPath: string | null;
  registeredRepoId: string | null;
  baselineRevision: string;
  baselineJson: string;
  baselineHash: string;
  status: "approved" | "superseded";
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
}

export interface QualityBaselineComparisonRecord {
  id: string;
  attemptId: string;
  baselineId: string | null;
  comparisonJson: string;
  status: "passed" | "new_failure" | "worsened_failure" | "no_baseline";
  newFailuresJson: string;
  worsenedFailuresJson: string;
  repairedFailuresJson: string;
  createdAt: string;
}

export interface VerificationDecisionRecord {
  id: string;
  attemptId: string;
  projectId: string;
  requirementId: string;
  verifier: string;
  verifierModel: string | null;
  decision: "accepted" | "rejected" | "more_evidence_required" | "human_review_required";
  reason: string;
  evidenceSummaryJson: string;
  createdAt: string;
}

export interface FailureClassification {
  category: FailureCategory;
  outcome: AttemptOutcome;
  summary: string;
  details: Record<string, unknown>;
  retryable: boolean;
  fingerprint: string;
  associatedCommand?: string | null;
  affectedFiles?: string[];
}

export interface RetryPolicyDecision {
  action: "retry" | "change_strategy" | "escalate_model" | "block";
  nextStrategy: RetryStrategy;
  modelProvider: string;
  modelName: string;
  reason: string;
}
