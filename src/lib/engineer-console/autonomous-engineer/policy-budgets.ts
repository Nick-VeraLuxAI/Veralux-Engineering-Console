import type { AutonomousBudgetConfig } from "./types";

/** Policy-configurable AE budgets. Orchestrator must read these — never hardcode limits. */
export const DEFAULT_AUTONOMOUS_BUDGETS: AutonomousBudgetConfig = {
  max_iterations: 10,
  max_plans: 12,
  max_model_calls: 24,
  max_changed_files: 40,
  max_changed_bytes: 500_000,
  max_runtime_ms: 30 * 60 * 1000,
  max_investigation_reads: 80,
  max_context_bytes: 200_000,
  max_plan_repairs: 8,
  max_post_review_repairs: 4,
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveAutonomousBudgets(
  overrides: Partial<AutonomousBudgetConfig> = {},
): AutonomousBudgetConfig {
  const fromEnv: AutonomousBudgetConfig = {
    max_iterations: envInt("ENGINEER_CONSOLE_AE_MAX_ITERATIONS", DEFAULT_AUTONOMOUS_BUDGETS.max_iterations),
    max_plans: envInt("ENGINEER_CONSOLE_AE_MAX_PLANS", DEFAULT_AUTONOMOUS_BUDGETS.max_plans),
    max_model_calls: envInt("ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS", DEFAULT_AUTONOMOUS_BUDGETS.max_model_calls),
    max_changed_files: envInt(
      "ENGINEER_CONSOLE_AE_MAX_CHANGED_FILES",
      DEFAULT_AUTONOMOUS_BUDGETS.max_changed_files,
    ),
    max_changed_bytes: envInt(
      "ENGINEER_CONSOLE_AE_MAX_CHANGED_BYTES",
      DEFAULT_AUTONOMOUS_BUDGETS.max_changed_bytes,
    ),
    max_runtime_ms: envInt("ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS", DEFAULT_AUTONOMOUS_BUDGETS.max_runtime_ms),
    max_investigation_reads: envInt(
      "ENGINEER_CONSOLE_AE_MAX_INVESTIGATION_READS",
      DEFAULT_AUTONOMOUS_BUDGETS.max_investigation_reads,
    ),
    max_context_bytes: envInt(
      "ENGINEER_CONSOLE_AE_MAX_CONTEXT_BYTES",
      DEFAULT_AUTONOMOUS_BUDGETS.max_context_bytes,
    ),
    max_plan_repairs: envInt(
      "ENGINEER_CONSOLE_AE_MAX_PLAN_REPAIRS",
      DEFAULT_AUTONOMOUS_BUDGETS.max_plan_repairs ?? 8,
    ),
    max_post_review_repairs: envInt(
      "ENGINEER_CONSOLE_AE_MAX_POST_REVIEW_REPAIRS",
      DEFAULT_AUTONOMOUS_BUDGETS.max_post_review_repairs ?? 2,
    ),
  };

  return { ...fromEnv, ...overrides };
}
