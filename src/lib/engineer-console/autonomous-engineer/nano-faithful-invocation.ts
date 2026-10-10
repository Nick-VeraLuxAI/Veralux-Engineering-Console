/**
 * NVIDIA-faithful Nano invocation envelope for AE (promoted Console runtime).
 * Rollback: ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false → CONTROL (think-off).
 * Default: faithful ON; DEGRADED when serve cannot host the faithful recipe.
 */
import type { AutonomousWorkerRole } from "./worker-schemas";

export type NanoFaithfulSamplingMode = "reasoning" | "tool" | "think_off";
export type NanoRuntimeMode = "FAITHFUL" | "DEGRADED" | "CONTROL";

export interface NanoFaithfulInvocationProfile {
  enabled: boolean;
  enableThinking: boolean;
  temperature: number;
  topP: number | undefined;
  maxTokens: number;
  samplingMode: NanoFaithfulSamplingMode;
  truncateHistoryThinking: boolean;
  runtimeMode: NanoRuntimeMode;
}

export interface NanoInvocationTelemetry {
  trajectoryId: string | null;
  role: AutonomousWorkerRole;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  finalTokens: number | null;
  maxTokens: number;
  finishReason: string | null;
  contextMaxModelLen: number | null;
  temperature: number;
  topP: number | null;
  enableThinking: boolean;
  reasoningParser: string | null;
  toolParser: string | null;
  generationBudgetExhausted: boolean;
  runtimeMode: NanoRuntimeMode;
  /** Explicit reasoning cap when two-phase budget control is active; null when unset. */
  reasoningBudget: number | null;
  /** Whether NVIDIA-style two-phase thinking→final continuation was used. */
  twoPhaseReasoning: boolean;
  /** Phase-1 finish_reason when two-phase ran. */
  phase1FinishReason?: string | null;
  /** Phase-2 finish_reason when two-phase ran. */
  phase2FinishReason?: string | null;
  /** Planning policy: single-shot, always two-phase, or conditional rescue. */
  policy?: string | null;
  /** True when single-shot exhausted and a one-shot budget rescue ran. */
  rescueTriggered?: boolean;
  singleShotFinishReason?: string | null;
  singleShotCompletionTokens?: number | null;
  singleShotReasoningTokens?: number | null;
  singleShotFinalLen?: number | null;
  rescueReasoningBudget?: number | null;
  finalJsonValid?: boolean;
  workerPlanValid?: boolean;
  generationRepairFailed?: boolean;
}

const REASONING_ROLES: AutonomousWorkerRole[] = [
  "planning",
  "replan",
  "diagnosis",
  "review",
];

const PLAN_ROLES: AutonomousWorkerRole[] = ["planning", "replan"];

/** NVIDIA coding/agentic default ~10k generation; leave headroom under experimental context. */
const FAITHFUL_REASONING_MAX_TOKENS = 10_000;
const FAITHFUL_NON_PLAN_MAX_TOKENS = 4_096;

/**
 * Optional explicit reasoning budget (NVIDIA ThinkingBudgetClient pattern).
 * Unset = FAITHFUL single-shot first; conditional budget rescue may still recover GBE.
 * When set (experimental), planning/replan use always-two-phase (NOT qualification default).
 * Rollback: unset / empty / 0.
 * Do NOT set 4000 globally for qualification — that regressed sanity (jobs/ledger/state).
 */
export function resolveNanoReasoningBudget(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** Roles that emit large final JSON plans and benefit from reserved final headroom. */
export function roleUsesReasoningBudgetGate(role: AutonomousWorkerRole): boolean {
  return PLAN_ROLES.includes(role);
}

/** Minimum max_model_len to consider the serve stack faithful-capable. */
export const FAITHFUL_MIN_MODEL_LEN = 65_536;

function parseTriState(raw: string | undefined): "true" | "false" | "unset" {
  if (raw == null || raw.trim() === "") return "unset";
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return "false";
  if (v === "true" || v === "1" || v === "on" || v === "yes") return "true";
  return "unset";
}

/**
 * Promoted default: faithful ON unless explicitly rolled back with false.
 * Set ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false for CONTROL behavior.
 */
export function isNanoFaithfulInvocationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseTriState(env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION) !== "false";
}

export function isNanoFaithfulContinuousToolsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isNanoFaithfulInvocationEnabled(env) &&
    env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_CONTINUOUS_TOOLS?.trim() === "true"
  );
}

export function resolveConfiguredMaxModelLen(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * FAITHFUL vs DEGRADED vs CONTROL detection for evidence/telemetry.
 * - CONTROL: faithful flag explicitly off
 * - DEGRADED: faithful intended but serve context too small / forced degraded
 * - FAITHFUL: intended and serve knobs look capable (or max-model-len unset but not forced degraded)
 */
export function resolveNanoRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
): NanoRuntimeMode {
  if (!isNanoFaithfulInvocationEnabled(env)) return "CONTROL";
  const forced = env.ENGINEER_CONSOLE_AE_NANO_RUNTIME_MODE?.trim().toUpperCase();
  if (forced === "DEGRADED") return "DEGRADED";
  if (forced === "CONTROL") return "CONTROL";
  if (forced === "FAITHFUL") return "FAITHFUL";
  const maxLen = resolveConfiguredMaxModelLen(env);
  if (maxLen != null && maxLen < FAITHFUL_MIN_MODEL_LEN) return "DEGRADED";
  // CONTROL-era serve (8081 / 8k) without explicit max-model-len → DEGRADED, not pretend-faithful.
  const base = env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL || "";
  if (maxLen == null && /:8081(?:\/|$)/.test(base)) return "DEGRADED";
  return "FAITHFUL";
}

function isTruthyEnv(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/**
 * Live AE must not silently run the DEGRADED (8081/8k think-off) envelope.
 * Explicit CONTROL rollback (FAITHFUL_INVOCATION=false) remains allowed.
 * Escape hatch: ENGINEER_CONSOLE_AE_ALLOW_DEGRADED=true.
 */
export function assertLiveAeNanoEnvelope(
  env: NodeJS.ProcessEnv = process.env,
): NanoRuntimeMode {
  const mode = resolveNanoRuntimeMode(env);
  if (mode !== "DEGRADED") return mode;
  if (isTruthyEnv(env.ENGINEER_CONSOLE_AE_ALLOW_DEGRADED)) return mode;
  const base = env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL?.trim() || "(unset)";
  const maxLen = resolveConfiguredMaxModelLen(env);
  throw new Error(
    `Live AE refused DEGRADED Nano envelope (baseUrl=${base}, max_model_len=${maxLen ?? "unset"}). ` +
      `Point ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL at FAITHFUL 8082 with ` +
      `ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144, or set ENGINEER_CONSOLE_AE_ALLOW_DEGRADED=true ` +
      `for an intentional short-context run.`,
  );
}

function controlProfile(role: AutonomousWorkerRole): NanoFaithfulInvocationProfile {
  return {
    enabled: false,
    enableThinking: false,
    temperature: 0.1,
    topP: undefined,
    maxTokens: PLAN_ROLES.includes(role) ? 2048 : 768,
    samplingMode: "think_off",
    truncateHistoryThinking: false,
    runtimeMode: "CONTROL",
  };
}

export function resolveNanoFaithfulProfile(
  role: AutonomousWorkerRole,
  options: { toolSelection?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): NanoFaithfulInvocationProfile {
  const mode = resolveNanoRuntimeMode(env);
  if (mode === "CONTROL") {
    return controlProfile(role);
  }

  // DEGRADED: keep CONTROL sampling envelope but mark mode for evidence (do not pretend faithful).
  if (mode === "DEGRADED") {
    return {
      ...controlProfile(role),
      runtimeMode: "DEGRADED",
    };
  }

  if (options.toolSelection) {
    return {
      enabled: true,
      enableThinking: true,
      temperature: 0.6,
      topP: 0.95,
      maxTokens: FAITHFUL_REASONING_MAX_TOKENS,
      samplingMode: "tool",
      truncateHistoryThinking: true,
      runtimeMode: "FAITHFUL",
    };
  }

  const reasoningRole = REASONING_ROLES.includes(role);
  const thinkOffGreedy =
    env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_THINK_OFF_GREEDY?.trim() === "true";

  if (!reasoningRole && thinkOffGreedy) {
    return {
      enabled: true,
      enableThinking: false,
      temperature: 0,
      topP: 1.0,
      maxTokens: FAITHFUL_NON_PLAN_MAX_TOKENS,
      samplingMode: "think_off",
      truncateHistoryThinking: true,
      runtimeMode: "FAITHFUL",
    };
  }

  // Hard roles get NVIDIA reasoning sampling; lighter roles still think-on under faithful flag
  // unless think-off greedy secondary path is selected above.
  return {
    enabled: true,
    enableThinking: true,
    temperature: 1.0,
    topP: 1.0,
    maxTokens: PLAN_ROLES.includes(role) || reasoningRole
      ? FAITHFUL_REASONING_MAX_TOKENS
      : FAITHFUL_NON_PLAN_MAX_TOKENS,
    samplingMode: "reasoning",
    truncateHistoryThinking: true,
    runtimeMode: "FAITHFUL",
  };
}

/**
 * Prefer OpenAI-compatible `reasoning` / `reasoning_content`, then Nano `</think>` split.
 * Never looks for `</redacted_thinking>` (wrong tag for Nano).
 */
export function extractNanoFinalContent(message: {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
}): { finalContent: string; reasoningContent: string | null } {
  const reasoningContent =
    (typeof message.reasoning_content === "string" && message.reasoning_content) ||
    (typeof message.reasoning === "string" && message.reasoning) ||
    null;
  const raw = message.content ?? "";

  if (reasoningContent && raw.trim()) {
    return { finalContent: raw.trim(), reasoningContent };
  }

  const thinkClose = raw.lastIndexOf("</think>");
  if (thinkClose >= 0) {
    const after = raw.slice(thinkClose + "</think>".length).trim();
    const before = raw.slice(0, thinkClose).replace(/^[\s\S]*?<think>/, "").trim();
    return {
      finalContent: after,
      reasoningContent: reasoningContent ?? (before || null),
    };
  }

  return { finalContent: raw.trim(), reasoningContent };
}

export function isGenerationBudgetExhausted(finishReason: string | null | undefined): boolean {
  return finishReason === "length";
}

export function buildNanoInvocationTelemetry(input: {
  role: AutonomousWorkerRole;
  profile: NanoFaithfulInvocationProfile;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
  finishReason?: string | null;
  reasoningLen?: number | null;
  finalLen?: number | null;
  contextMaxModelLen?: number | null;
  trajectoryId?: string | null;
  reasoningBudget?: number | null;
  twoPhaseReasoning?: boolean;
  phase1FinishReason?: string | null;
  phase2FinishReason?: string | null;
  /** Override generationBudgetExhausted (e.g. two-phase recovered after phase-1 length). */
  generationBudgetExhausted?: boolean;
  policy?: string | null;
  rescueTriggered?: boolean;
  singleShotFinishReason?: string | null;
  singleShotCompletionTokens?: number | null;
  singleShotReasoningTokens?: number | null;
  singleShotFinalLen?: number | null;
  rescueReasoningBudget?: number | null;
  finalJsonValid?: boolean;
  workerPlanValid?: boolean;
  generationRepairFailed?: boolean;
}): NanoInvocationTelemetry {
  const finishReason = input.finishReason ?? null;
  const reasoningTokens =
    input.usage?.completion_tokens_details?.reasoning_tokens ?? null;
  const faithful = input.profile.runtimeMode === "FAITHFUL";
  const exhausted =
    typeof input.generationBudgetExhausted === "boolean"
      ? input.generationBudgetExhausted
      : isGenerationBudgetExhausted(finishReason);
  return {
    trajectoryId: input.trajectoryId ?? null,
    role: input.role,
    promptTokens: input.usage?.prompt_tokens ?? null,
    completionTokens: input.usage?.completion_tokens ?? null,
    reasoningTokens,
    finalTokens: typeof input.finalLen === "number" ? input.finalLen : null,
    maxTokens: input.profile.maxTokens,
    finishReason,
    contextMaxModelLen: input.contextMaxModelLen ?? null,
    temperature: input.profile.temperature,
    topP: input.profile.topP ?? null,
    enableThinking: input.profile.enableThinking,
    reasoningParser: faithful ? "nano_v3" : null,
    toolParser: faithful ? "qwen3_coder" : null,
    generationBudgetExhausted: exhausted,
    runtimeMode: input.profile.runtimeMode,
    reasoningBudget: input.reasoningBudget ?? null,
    twoPhaseReasoning: input.twoPhaseReasoning === true,
    phase1FinishReason: input.phase1FinishReason ?? null,
    phase2FinishReason: input.phase2FinishReason ?? null,
    policy: input.policy ?? null,
    rescueTriggered: input.rescueTriggered === true,
    singleShotFinishReason: input.singleShotFinishReason ?? null,
    singleShotCompletionTokens: input.singleShotCompletionTokens ?? null,
    singleShotReasoningTokens: input.singleShotReasoningTokens ?? null,
    singleShotFinalLen: input.singleShotFinalLen ?? null,
    rescueReasoningBudget: input.rescueReasoningBudget ?? null,
    finalJsonValid: input.finalJsonValid,
    workerPlanValid: input.workerPlanValid,
    generationRepairFailed: input.generationRepairFailed === true,
  };
}
