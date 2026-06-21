import type { WorkerAssignmentContract } from "../project-orchestration/requirement-execution-types";

export type VeraExecutionStatus = "completed" | "failed" | "cancelled" | "timeout" | "blocked";

export interface VeraExecutionContext {
  workspace_path: string;
  repository_path: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  protected_paths: string[];
  permitted_commands: string[];
  prohibited_commands: string[];
  attempt_id: string;
  requirement_id: string;
  run_id: string;
  artifact_path: string;
  timeout_ms: number;
  origin: "engineering_console";
  preauthorized: boolean;
  model_routing?: WorkerAssignmentContract["model_routing"];
}

export interface VeraExecutionRequest {
  runId: string;
  attemptId: string;
  requirementId: string;
  taskId: string;
  title: string;
  instructions: string;
  assignment: WorkerAssignmentContract;
  executionContext: VeraExecutionContext;
  model?: string | null;
  escalation?: VeraEscalationRequest | null;
}

export interface VeraRunSubmissionResponse {
  run_id: string;
  status: string;
}

export interface VeraRunStatus {
  object?: string;
  run_id: string;
  status: string;
  model?: string | null;
  output?: string | null;
  error?: string | null;
  usage?: Record<string, unknown> | null;
  last_event?: string | null;
  transport_outcome?:
    | "FAILED_BEFORE_EXECUTION"
    | "FAILED_DURING_GENERATION_NO_TOOLS"
    | "INDETERMINATE_AFTER_TOOL_EXECUTION"
    | "COMPLETED"
    | "CANCELLED"
    | string
    | null;
  side_effects_observed?: boolean;
  last_successful_event?: string | null;
  stream_termination_reason?: string | null;
  normalized_failure_signature?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface VeraRunEvent {
  event: string;
  run_id?: string;
  timestamp?: number;
  tool?: string;
  preview?: string;
  duration?: number;
  error?: boolean | string;
  output?: string;
  usage?: Record<string, unknown>;
  delta?: string;
  [key: string]: unknown;
}

export interface VeraExecutionFailure {
  code: string;
  category:
    | "authentication"
    | "configuration"
    | "transport"
    | "timeout"
    | "model_unavailable"
    | "policy_violation"
    | "runtime"
    | "unknown";
  message: string;
  retryable: boolean;
}

export interface VeraEscalationRequest {
  requested: boolean;
  reason: string;
  model: string | null;
}

export interface VeraEscalationResult {
  status: "not_requested" | "requested" | "unavailable" | "completed";
  reason?: string;
  model?: string | null;
}

export interface VeraExecutionResult {
  status: VeraExecutionStatus;
  summary: string;
  provider: "vera";
  model: string;
  externalRunId: string | null;
  attemptId: string;
  requirementId: string;
  workspaceId: string;
  workspacePath: string;
  rawFinalOutput: string;
  events: VeraRunEvent[];
  usage: Record<string, unknown>;
  warnings: string[];
  failure: VeraExecutionFailure | null;
  escalation: VeraEscalationResult | null;
  modelRouting?: WorkerAssignmentContract["model_routing"] | null;
  startedAt: string;
  completedAt: string;
}

export interface VeraCancellationResult {
  externalRunId: string;
  status: string;
}
