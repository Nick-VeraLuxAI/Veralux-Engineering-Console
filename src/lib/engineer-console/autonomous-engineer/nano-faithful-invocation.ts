/**
 * Temporary NVIDIA-faithful Nano invocation envelope for AE requalification.
 * Behind ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=true — default remains CONTROL (think-off).
 */
import type { AutonomousWorkerRole } from "./worker-schemas";

export type NanoFaithfulSamplingMode = "reasoning" | "tool" | "think_off";

export interface NanoFaithfulInvocationProfile {
  enabled: boolean;
  enableThinking: boolean;
  temperature: number;
  topP: number | undefined;
  maxTokens: number;
  samplingMode: NanoFaithfulSamplingMode;
  truncateHistoryThinking: boolean;
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

export function isNanoFaithfulInvocationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION?.trim() === "true";
}

export function isNanoFaithfulContinuousToolsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isNanoFaithfulInvocationEnabled(env) &&
    env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_CONTINUOUS_TOOLS?.trim() === "true"
  );
}

export function resolveNanoFaithfulProfile(
  role: AutonomousWorkerRole,
  options: { toolSelection?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): NanoFaithfulInvocationProfile {
  if (!isNanoFaithfulInvocationEnabled(env)) {
    return {
      enabled: false,
      enableThinking: false,
      temperature: 0.1,
      topP: undefined,
      maxTokens: PLAN_ROLES.includes(role) ? 2048 : 768,
      samplingMode: "think_off",
      truncateHistoryThinking: false,
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
}): NanoInvocationTelemetry {
  const finishReason = input.finishReason ?? null;
  const reasoningTokens =
    input.usage?.completion_tokens_details?.reasoning_tokens ??
    (typeof input.reasoningLen === "number" ? null : null);
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
    reasoningParser: input.profile.enabled ? "nano_v3" : null,
    toolParser: input.profile.enabled ? "qwen3_coder" : null,
    generationBudgetExhausted: isGenerationBudgetExhausted(finishReason),
  };
}
