import type { SeniorEscalationPackage } from "./types";

export const SENIOR_INVOCATION_V2_ID = "governed-live-senior-invocation-v2" as const;
export const SENIOR_INVOCATION_WIRED_INTO_AE_LOOP = false;
export const SENIOR_INVOCATION_DEFAULT_MAX_TOKENS = 1200;
export const REQUIRED_SENIOR_MODEL_NAME = "deepseek-v4-flash-ftw-tp1" as const;
export const REQUIRED_SENIOR_PROFILE_ID = "deepseek-senior" as const;

export const DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE =
  "You are DeepSeek-V4-Flash running locally inside VeraLux Engineering Console as the senior architect model. Do not claim to be trained by Google, OpenAI, Anthropic, or any other provider. You cannot modify files, run shell commands, approve changes, or bypass human gates. Your role is architecture review, root-cause diagnosis, QC planning, and escalation judgment.";

export const SENIOR_INVOCATION_BLOCKED_REASONS = [
  "package_missing",
  "escalation_not_recommended",
  "profile_not_deepseek_senior",
  "operator_approval_missing",
  "senior_config_disabled",
  "senior_base_url_not_explicit",
  "senior_model_not_explicit",
  "senior_url_not_localhost",
  "senior_url_is_nano_worker",
  "senior_model_mismatch",
  "requires_manual_serve_violated",
  "auto_serve_not_false",
  "concurrent_with_nano_not_false",
  "auto_call_not_manual",
  "package_already_invoked",
  "senior_endpoint_unavailable",
] as const;

export type SeniorInvocationBlockedReason = (typeof SENIOR_INVOCATION_BLOCKED_REASONS)[number];

export type SeniorInvocationStatus = "blocked" | "succeeded" | "failed";

export type SeniorInvocationGate = {
  id: string;
  passed: boolean;
  detail: string;
};

export type SeniorInvocationOperatorApproval = {
  approved: boolean;
  invocationRequested: boolean;
  approvedBy: string;
  approvedAt?: string;
  packageTaskId?: string | null;
  packageRunId?: string | null;
};

export type SeniorReviewRisks = {
  approval: string;
  security: string;
  dataContract: string;
};

export type SeniorReviewResponse = {
  rootCause: string;
  symptomPatchVsRealFix: string;
  missingEvidence: string[];
  nextWorkerMission: string;
  recommendedWorkerProfile: "nano-fast" | "nano-faithful" | string;
  qcGates: string[];
  risks: SeniorReviewRisks;
  humanGatesStillRequired: true;
};

export type SeniorInvocationUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type SeniorEndpointHealth = {
  available: boolean;
  checkedUrl: string;
  statusCode: number | null;
  error: string | null;
};

export type SeniorInvocationRequest = {
  package?: SeniorEscalationPackage | null;
  operatorApproval?: SeniorInvocationOperatorApproval | null;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  maxTokens?: number;
  skipHealthCheck?: boolean;
  /** AE loop auto path when ENGINEER_CONSOLE_SENIOR_ESCALATION_AUTO_CALL=true. */
  autoInvocation?: boolean;
};

export type SeniorInvocationGateDecision = {
  allowed: boolean;
  reasons: SeniorInvocationBlockedReason[];
  gates: SeniorInvocationGate[];
  baseUrl: string | null;
  model: string | null;
  seniorEnabled: boolean;
};

type SeniorInvocationBase = {
  profileId: typeof REQUIRED_SENIOR_PROFILE_ID;
  baseUrl: string | null;
  model: string | null;
  requestSummary: string;
  timingMs: number;
  humanGatesStillRequired: true;
  warnings: string[];
  gates: SeniorInvocationGate[];
  healthCheckMade: boolean;
};

export type SeniorInvocationBlockedResult = SeniorInvocationBase & {
  status: "blocked";
  networkCallMade: false;
  blockedReasons: SeniorInvocationBlockedReason[];
  rawResponse: null;
  parsedReview: null;
  usage: null;
};

export type SeniorInvocationSucceededResult = SeniorInvocationBase & {
  status: "succeeded";
  networkCallMade: true;
  blockedReasons: [];
  rawResponse: string;
  parsedReview: SeniorReviewResponse | null;
  usage: SeniorInvocationUsage | null;
};

export type SeniorInvocationFailedResult = SeniorInvocationBase & {
  status: "failed";
  networkCallMade: boolean;
  blockedReasons: [];
  failureMessage: string;
  rawResponse: string | null;
  parsedReview: null;
  usage: null;
};

export type SeniorInvocationResult =
  | SeniorInvocationBlockedResult
  | SeniorInvocationSucceededResult
  | SeniorInvocationFailedResult;
