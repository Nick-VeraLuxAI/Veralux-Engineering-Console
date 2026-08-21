/**
 * FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE
 *
 * Primary path: normal FAITHFUL single-shot (thinking ON, temp 1.0/1.0, max_tokens≈10000).
 * Rescue path: NVIDIA ThinkingBudgetClient two-phase, invoked at most once when the
 * single-shot call exhausts the shared generation budget before a usable plan lands.
 *
 * Does NOT promote a global fixed reasoning_budget (e.g. 4000) as qualification default.
 * Explicit ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET remains an experimental always-two-phase override.
 *
 * Derived numbers (evidence/ae-q1-generation-budget + tokenizer /tokenize on 8082):
 * - Successful plan finals (tokenizer-aware + prior ests): p95≈1286 tokens
 * - FINAL_PLAN_RESERVE = ceil((p95 + 25% margin)/100)*100 = 1700
 * - Rescue reasoning budget = max_tokens(10000) - FINAL_PLAN_RESERVE = 8300
 */

export const CONDITIONAL_BUDGET_POLICY = "FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE" as const;

/** Tokenizer-aware final-plan reserve (p95 + margin), locked from evidence. */
export const FINAL_PLAN_RESERVE = 1700;

/** FAITHFUL planning max_tokens (shared reasoning+final in single-shot). */
export const FAITHFUL_PLAN_MAX_TOKENS = 10_000;

/**
 * Cap thinking during rescue so FINAL_PLAN_RESERVE remains for the worker-plan JSON.
 * Not a global default — only used when single-shot hits generation exhaustion.
 */
export const RESCUE_REASONING_BUDGET = FAITHFUL_PLAN_MAX_TOKENS - FINAL_PLAN_RESERVE; // 8300

/**
 * README documents a +500 grace after the budget threshold when no newline is seen.
 * The shipped ThinkingBudgetClient sample still hard-caps phase-1 at reasoning_budget;
 * we apply the documented grace on the phase-1 max_tokens ceiling only.
 */
export const REASONING_BUDGET_NEWLINE_GRACE_TOKENS = 500;

export type NanoPlanningPolicy =
  | typeof CONDITIONAL_BUDGET_POLICY
  | "ALWAYS_TWO_PHASE"
  | "SINGLE_SHOT_ONLY";

function parseTriState(raw: string | undefined): "true" | "false" | "unset" {
  if (raw == null || raw.trim() === "") return "unset";
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return "false";
  if (v === "true" || v === "1" || v === "on" || v === "yes") return "true";
  return "unset";
}

/**
 * Conditional rescue is ON by default under FAITHFUL planning.
 * Disable with ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE=false.
 */
export function isConditionalBudgetRescueEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return parseTriState(env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE) !== "false";
}

export function resolvePlanningPolicy(
  env: NodeJS.ProcessEnv = process.env,
  explicitReasoningBudget: number | null,
): NanoPlanningPolicy {
  if (explicitReasoningBudget != null && explicitReasoningBudget > 0) {
    return "ALWAYS_TWO_PHASE";
  }
  if (!isConditionalBudgetRescueEnabled(env)) {
    return "SINGLE_SHOT_ONLY";
  }
  return CONDITIONAL_BUDGET_POLICY;
}

/**
 * Evidence-derived rescue budget. Explicit env ENGINEER_CONSOLE_AE_NANO_RESCUE_REASONING_BUDGET
 * may override; otherwise RESCUE_REASONING_BUDGET (8300).
 * Clamped so FINAL_PLAN_RESERVE stays available under FAITHFUL_PLAN_MAX_TOKENS.
 */
export function resolveRescueReasoningBudget(
  env: NodeJS.ProcessEnv = process.env,
  maxTokens: number = FAITHFUL_PLAN_MAX_TOKENS,
): number {
  const raw = env.ENGINEER_CONSOLE_AE_NANO_RESCUE_REASONING_BUDGET?.trim();
  let budget = RESCUE_REASONING_BUDGET;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) budget = Math.floor(n);
  }
  const maxBudget = Math.max(512, maxTokens - FINAL_PLAN_RESERVE);
  const minBudget = 512;
  return Math.min(maxBudget, Math.max(minBudget, budget));
}

export interface SingleShotRescueSignal {
  finishReason: string | null;
  rawResponse: string;
  parsed: Record<string, unknown> | null;
  parseErrors: string[];
  schemaValid: boolean;
  reasoningContent: string | null;
  generationBudgetExhausted: boolean;
}

/**
 * Rescue only for generation-cutoff failures — never for semantic/schema-valid bad plans
 * that finished with stop and complete JSON.
 */
export function shouldTriggerBudgetRescue(signal: SingleShotRescueSignal): boolean {
  if (signal.schemaValid && signal.parsed && signal.finishReason === "stop") {
    return false;
  }

  if (signal.generationBudgetExhausted || signal.finishReason === "length") {
    return true;
  }

  // Unfinished reasoning: length-class truncation without a closed think block / empty final.
  const reasoning = signal.reasoningContent ?? "";
  const unfinishedReasoning =
    reasoning.length > 0 &&
    !reasoning.includes("</think>") &&
    !signal.rawResponse.trim();
  if (unfinishedReasoning) {
    return true;
  }

  // Absent/incomplete JSON attributable to cutoff (empty or truncated JSON, no valid parse).
  const raw = signal.rawResponse.trim();
  if (!raw) {
    return true;
  }
  const looksTruncatedJson =
    (raw.startsWith("{") || raw.startsWith("[")) &&
    (!signal.parsed || signal.parseErrors.length > 0) &&
    !/"operations"\s*:\s*\[[\s\S]*\]\s*\}/.test(raw);
  if (looksTruncatedJson && (signal.finishReason === "length" || signal.generationBudgetExhausted)) {
    return true;
  }

  // Semantic / complete-but-invalid plans: do not rescue.
  return false;
}

export interface ConditionalRescueTelemetryFields {
  policy: NanoPlanningPolicy;
  rescueTriggered: boolean;
  singleShotFinishReason: string | null;
  singleShotCompletionTokens: number | null;
  singleShotReasoningTokens: number | null;
  singleShotFinalLen: number | null;
  rescueReasoningBudget: number | null;
  phase1FinishReason: string | null;
  phase2FinishReason: string | null;
  finalJsonValid: boolean;
  workerPlanValid: boolean;
  generationRepairFailed: boolean;
}
