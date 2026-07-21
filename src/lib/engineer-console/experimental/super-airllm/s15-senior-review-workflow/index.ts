/** Public S15 approved senior-review workflow entrypoints. */

export * from "./types";
export * from "./comparison";
export * from "./bundle-store";
export * from "./acceptance-gate";
export * from "./eligibility";
export * from "./workflow";

export const S15_WORKFLOW_ARCHITECTURE = {
  flow: [
    "default worker review",
    "optional approved senior review (S14 execution approval)",
    "dual-result preservation",
    "structured rule-based comparison",
    "operator acceptance/rejection",
    "accepted result becomes eligible for downstream use",
  ],
  prohibits: [
    "automatic senior default replacement",
    "senior self-approval",
    "senior-executed actions",
    "execution_approval_as_acceptance",
    "bypass of existing action gates",
  ],
  longFormSeniorReviewProven: false,
  workflowIntegrationProven: true,
  usesS14NotS13Direct: true,
  allocatesCuda: false,
  stopsNano: false,
} as const;
