import type { AutonomousFailureClass } from "./types";

export interface FailureSignals {
  workerPlanValidationFailed?: boolean;
  workerPlanParseFailed?: boolean;
  workerPlanExecutionFailed?: boolean;
  qualityGatesFailed?: boolean;
  governanceBlocked?: boolean;
  protectedPathBlocked?: boolean;
  infrastructureError?: boolean;
  directorDecisionRequired?: boolean;
  governanceAuthorizationRequired?: boolean;
  budgetExhausted?: boolean;
  modelOutputUnusable?: boolean;
  /** finish_reason=length — not a semantic model failure */
  generationBudgetExhausted?: boolean;
}

export function classifyAutonomousFailure(signals: FailureSignals): AutonomousFailureClass {
  if (signals.budgetExhausted) return "BUDGET_EXHAUSTED";
  if (signals.generationBudgetExhausted) return "GENERATION_BUDGET_EXHAUSTED";
  if (signals.infrastructureError) return "INFRASTRUCTURE_FAILURE";
  if (signals.governanceAuthorizationRequired) return "GOVERNANCE_AUTHORIZATION_REQUIRED";
  if (signals.directorDecisionRequired) return "DIRECTOR_DECISION_REQUIRED";
  if (signals.governanceBlocked || signals.protectedPathBlocked) return "POLICY_BLOCK";
  if (signals.workerPlanParseFailed || signals.modelOutputUnusable) return "MODEL_OUTPUT_FAILURE";
  if (signals.workerPlanValidationFailed) return "VALIDATION_FAILURE";
  if (signals.qualityGatesFailed || signals.workerPlanExecutionFailed) return "ENGINEERING_FAILURE";
  return "ENGINEERING_FAILURE";
}

export function isTerminalFailureClass(failureClass: AutonomousFailureClass): boolean {
  return (
    failureClass === "INFRASTRUCTURE_FAILURE" ||
    failureClass === "POLICY_BLOCK" ||
    failureClass === "BUDGET_EXHAUSTED" ||
    failureClass === "GOVERNANCE_AUTHORIZATION_REQUIRED"
  );
}

export function isIterationFailureClass(failureClass: AutonomousFailureClass): boolean {
  return (
    failureClass === "ENGINEERING_FAILURE" ||
    failureClass === "MODEL_OUTPUT_FAILURE" ||
    failureClass === "GENERATION_BUDGET_EXHAUSTED" ||
    failureClass === "VALIDATION_FAILURE"
  );
}
