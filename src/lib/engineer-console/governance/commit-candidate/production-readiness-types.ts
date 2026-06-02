export const ENGINEERING_PRODUCTION_READINESS_RESULT_SCHEMA =
  "engineering-production-readiness-result/v1" as const;

export type ProductionReadinessDecision = "ready" | "not_ready" | "blocked";

export const PRODUCTION_READINESS_DECISIONS: readonly ProductionReadinessDecision[] = [
  "ready",
  "not_ready",
  "blocked",
] as const;
