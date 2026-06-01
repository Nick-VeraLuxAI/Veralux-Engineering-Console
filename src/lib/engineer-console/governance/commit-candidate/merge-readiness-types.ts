export const ENGINEERING_MERGE_READINESS_RESULT_SCHEMA =
  "engineering-merge-readiness-result/v1" as const;

export type MergeReadinessDecision = "ready" | "not_ready" | "blocked";

export const MERGE_READINESS_DECISIONS: readonly MergeReadinessDecision[] = [
  "ready",
  "not_ready",
  "blocked",
] as const;
