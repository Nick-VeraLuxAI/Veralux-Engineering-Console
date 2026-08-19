import type { AutonomousBudgetConfig, AutonomousBudgetUsage, AutonomousFailureClass } from "./types";

export class BudgetExhaustedError extends Error {
  readonly dimension: keyof AutonomousBudgetConfig;
  readonly failureClass: AutonomousFailureClass = "BUDGET_EXHAUSTED";

  constructor(dimension: keyof AutonomousBudgetConfig, used: number, max: number) {
    super(`Autonomous budget exhausted: ${dimension} used ${used} of ${max}`);
    this.name = "BudgetExhaustedError";
    this.dimension = dimension;
  }
}

export function emptyBudgetUsage(): AutonomousBudgetUsage {
  return {
    iterations: 0,
    plans: 0,
    modelCalls: 0,
    changedFiles: 0,
    changedBytes: 0,
    runtimeMs: 0,
    investigationReads: 0,
    contextBytes: 0,
  };
}

const USAGE_TO_BUDGET: Record<keyof AutonomousBudgetUsage, keyof AutonomousBudgetConfig> = {
  iterations: "max_iterations",
  plans: "max_plans",
  modelCalls: "max_model_calls",
  changedFiles: "max_changed_files",
  changedBytes: "max_changed_bytes",
  runtimeMs: "max_runtime_ms",
  investigationReads: "max_investigation_reads",
  contextBytes: "max_context_bytes",
};

export function checkBudget(
  budget: AutonomousBudgetConfig,
  usage: AutonomousBudgetUsage,
  dimension: keyof AutonomousBudgetUsage,
  increment = 0,
): void {
  const maxKey = USAGE_TO_BUDGET[dimension];
  const next = usage[dimension] + increment;
  const max = budget[maxKey];
  if (next > max) {
    throw new BudgetExhaustedError(maxKey, next, max);
  }
}

export function wouldExceedBudget(
  budget: AutonomousBudgetConfig,
  usage: AutonomousBudgetUsage,
  dimension: keyof AutonomousBudgetUsage,
  increment = 0,
): boolean {
  const maxKey = USAGE_TO_BUDGET[dimension];
  return usage[dimension] + increment > budget[maxKey];
}

export function remainingBudget(
  budget: AutonomousBudgetConfig,
  usage: AutonomousBudgetUsage,
): AutonomousBudgetUsage {
  return {
    iterations: Math.max(0, budget.max_iterations - usage.iterations),
    plans: Math.max(0, budget.max_plans - usage.plans),
    modelCalls: Math.max(0, budget.max_model_calls - usage.modelCalls),
    changedFiles: Math.max(0, budget.max_changed_files - usage.changedFiles),
    changedBytes: Math.max(0, budget.max_changed_bytes - usage.changedBytes),
    runtimeMs: Math.max(0, budget.max_runtime_ms - usage.runtimeMs),
    investigationReads: Math.max(0, budget.max_investigation_reads - usage.investigationReads),
    contextBytes: Math.max(0, budget.max_context_bytes - usage.contextBytes),
  };
}
