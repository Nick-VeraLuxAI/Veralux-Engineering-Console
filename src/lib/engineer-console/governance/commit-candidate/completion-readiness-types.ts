export const ENGINEERING_COMPLETION_READINESS_RESULT_SCHEMA =
  "engineering-completion-readiness-result/v1" as const;

export type CompletionReadinessDecision = "ready" | "not_ready" | "blocked";

export const COMPLETION_READINESS_DECISIONS: readonly CompletionReadinessDecision[] = [
  "ready",
  "not_ready",
  "blocked",
] as const;
