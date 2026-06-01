export const ENGINEERING_PULL_REQUEST_MERGE_RESULT_SCHEMA =
  "engineering-pull-request-merge-result/v1" as const;

export type GovernedPrMergeMethod = "squash" | "merge" | "rebase";

export const GOVERNED_PR_MERGE_METHODS: readonly GovernedPrMergeMethod[] = [
  "squash",
  "merge",
  "rebase",
] as const;

export const DEFAULT_GOVERNED_PR_MERGE_METHOD: GovernedPrMergeMethod = "squash";
