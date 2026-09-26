/** S14 gated senior-worker adapter types — client to local S13 only. */

export const S14_RUNTIME_ID = "airllm-nemotron-super-120b-senior-candidate" as const;
export const S14_DEFAULT_S13_BASE_URL = "http://127.0.0.1:8091" as const;
export const S14_EXECUTION_MODE = "modelopt_fake_quant_cuda" as const;
export const S14_GENERATION_STRATEGY = "full_prefix_recomputation" as const;
/** Configured and verified S15.1 ceiling — do not claim higher without a new proof. */
export const S14_CONFIGURED_MAX_NEW_TOKENS = 32 as const;
export const S14_VERIFIED_MAX_NEW_TOKENS = 32 as const;

/** Bounded positive integer; validated against configured maximum. */
export type MaxNewTokens = number;

export type SeniorGenerationRequest = {
  veraRequestId: string;
  runId?: string;
  taskId?: string;
  prompt: string;
  maxNewTokens: MaxNewTokens;
  approvalReference: string;
  idempotencyKey: string;
  requestedAt: string;
  /** Explicit opt-in; default false. */
  allowFallback?: boolean;
  /** Must be true to request senior route. */
  seniorRequested?: boolean;
  runtimeId?: string;
};

export type GeneratedToken = {
  tokenId: number;
  decoded: string;
  selectedLogit: number;
};

export type SeniorGenerationResult = {
  veraRequestId: string;
  s13RequestId: string;
  state: "completed";
  model: string;
  executionMode: typeof S14_EXECUTION_MODE;
  generationStrategy: typeof S14_GENERATION_STRATEGY;
  generatedTokens: GeneratedToken[];
  nanoRestored: boolean;
  fallbackDetected: false;
  startedAt: string;
  completedAt: string;
};

export type SeniorBlockReason =
  | "senior_execution_not_requested"
  | "senior_execution_approval_missing"
  | "senior_execution_approval_mismatch"
  | "senior_execution_approval_expired"
  | "senior_execution_approval_scope_mismatch"
  | "senior_runtime_not_available"
  | "senior_request_shape_unsupported"
  | "senior_service_not_ready"
  | "senior_service_unavailable_before_submission"
  | "senior_route_disabled"
  | "senior_non_loopback_url_rejected"
  | "senior_source_fingerprint_mismatch"
  | "senior_recovery_required"
  | "senior_duplicate_payload_conflict"
  | "senior_status_unknown"
  | "senior_cancelled"
  | "senior_failed"
  | "senior_result_ambiguous";

export type SeniorRouteDecision = {
  eligible: boolean;
  approved: boolean;
  runtimeId: typeof S14_RUNTIME_ID | string;
  approvalReference: string | null;
  requestId: string;
  reason: string;
  decidedAt: string;
};

export type SeniorAdapterState =
  | "senior_decision_blocked"
  | "senior_queued"
  | "senior_acquiring_runtime"
  | "senior_executing"
  | "senior_operational_cleanup"
  | "senior_completed"
  | "senior_cancelled"
  | "senior_recovery_required"
  | "senior_failed"
  | "senior_status_unknown"
  | "senior_fallback_eligible"
  | "senior_submitted";

export type SeniorCorrelationRecord = {
  veraRequestId: string;
  runId: string;
  taskId: string;
  runtimeId: string;
  approvalReference: string;
  s13RequestId: string | null;
  idempotencyKey: string;
  prompt: string;
  maxNewTokens: MaxNewTokens;
  state: SeniorAdapterState;
  lastS13State: string | null;
  submittedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  result: SeniorGenerationResult | null;
  error: { code: SeniorBlockReason | string; message: string } | null;
  decision: SeniorRouteDecision | null;
  allowFallback: boolean;
  fallbackUsed: boolean;
  fallbackWorker: string | null;
};

export type SeniorApprovalArtifact = {
  schema: "s14_senior_execution_approval_v1";
  approvalReference: string;
  veraRequestId: string;
  runtimeId: typeof S14_RUNTIME_ID | string;
  operation: "senior_generate";
  approverIdentity: string;
  approvedAt: string;
  expiresAt: string | null;
  oneUse: boolean;
  scope: {
    maxNewTokens: MaxNewTokens;
    generationPolicy: "greedy";
  };
  artifactHash: string;
};

export type S13Health = {
  healthy?: boolean;
  serviceState?: string;
  sourceCommit?: string;
  sourceManifestSha256?: string;
  executableSourceSha256?: string;
  executionMode?: string;
  bind?: string;
  recoveryRequired?: boolean;
  httpLocalOnly?: boolean;
  veraluxIntegrationPerformed?: boolean;
  [key: string]: unknown;
};

export type S13Readiness = {
  serviceReady?: boolean;
  acceptingRequests?: boolean;
  recoveryRequired?: boolean;
  selectedNanoHealthy?: boolean;
  unaffectedNanoHealthy?: boolean;
  largeModelRunning?: boolean;
  [key: string]: unknown;
};

export type S13GenerationStatus = {
  requestId?: string;
  state?: string;
  result?: {
    generatedTokens?: Array<{
      tokenId?: number;
      decoded?: string;
      selectedLogit?: number;
    }>;
    nanoRestored?: boolean;
    fallbackDetected?: boolean;
    executionMode?: string;
    model?: string;
    createdAt?: string;
    completedAt?: string;
  };
  generatedTokens?: Array<{
    tokenId?: number;
    decoded?: string;
    selectedLogit?: number;
  }>;
  nanoRestored?: boolean;
  error?: string;
  workerPid?: number;
  [key: string]: unknown;
};

export type AdapterDeadlines = {
  connectMs: number;
  admissionMs: number;
  queuedWaitMs: number;
  activeExecutionMs: number;
  operationalCleanupMs: number;
  cancellationMs: number;
  pollIntervalMs: number;
};

export const DEFAULT_DEADLINES: AdapterDeadlines = {
  connectMs: 5_000,
  admissionMs: 30_000,
  queuedWaitMs: 3_600_000,
  /** 32 full-prefix passes can exceed 4h; keep correlation without replacement submit. */
  activeExecutionMs: 86_400_000,
  operationalCleanupMs: 600_000,
  cancellationMs: 600_000,
  pollIntervalMs: 2_000,
};
