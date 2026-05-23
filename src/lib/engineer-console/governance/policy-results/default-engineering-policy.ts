import type { EngineeringPolicyDefinition } from "./policy-types";

export const DEFAULT_ENGINEERING_POLICY_ID = "builtin-engineering-policy-v1";

/** Built-in governance policy for VeraLux Engineering Console runs. */
export const DEFAULT_ENGINEERING_POLICY: EngineeringPolicyDefinition = {
  id: DEFAULT_ENGINEERING_POLICY_ID,
  name: "Default Engineering Governance Policy",
  version: "1.0.0",
  rules: [
    {
      id: "WORKER_PLAN_VALIDATION_FAILED",
      outcome: "block",
      description: "Worker plan validation failed",
    },
    {
      id: "GOVERNANCE_BLOCKED",
      outcome: "block",
      description: "Governance risk level is blocked",
    },
    {
      id: "PROTECTED_PATH_BLOCKED",
      outcome: "block",
      description: "Protected path changes are blocked",
    },
    {
      id: "QUALITY_GATE_FAILED",
      outcome: "block",
      description: "One or more quality gates failed",
    },
    {
      id: "REPLAY_VERIFICATION_FAILED",
      outcome: "block",
      description: "Replay verification failed",
    },
    {
      id: "EVIDENCE_BUNDLE_MISSING",
      outcome: "block",
      description: "Evidence bundle missing for approval-ready run",
    },
    {
      id: "GOVERNANCE_HIGH_RISK",
      outcome: "warn",
      description: "Governance risk level is high",
    },
    {
      id: "LARGE_CHANGE_SET",
      outcome: "warn",
      description: "More than 20 files changed",
    },
    {
      id: "INDEXED_FILE_MISMATCH",
      outcome: "warn",
      description: "Worker plan references files not in latest index",
    },
    {
      id: "REPLAY_VERIFICATION_WARNINGS",
      outcome: "warn",
      description: "Replay verification reported warnings",
    },
    {
      id: "EVIDENCE_REGENERATED_AFTER_DECISION",
      outcome: "warn",
      description: "Evidence bundle regenerated after human decision",
    },
    {
      id: "COMPATIBILITY_WARNINGS",
      outcome: "warn",
      description: "Compatibility warnings or unknown links detected",
    },
    {
      id: "COMPATIBILITY_BREAKING",
      outcome: "review",
      description: "Breaking cross-repo compatibility links detected",
    },
    {
      id: "GOVERNANCE_HIGH_RISK_REVIEW",
      outcome: "review",
      description: "High governance risk requires senior review",
    },
    {
      id: "PACKAGE_LOCK_CHANGED",
      outcome: "review",
      description: "package-lock.json changed",
    },
    {
      id: "MIGRATIONS_CHANGED",
      outcome: "review",
      description: "Database migrations changed",
    },
    {
      id: "UNINDEXED_TARGETS_MODIFIED",
      outcome: "review",
      description: "Modified files not present in latest file index",
    },
    {
      id: "QUALITY_GATES_ALL_SKIPPED",
      outcome: "review",
      description: "All quality gates skipped (no scripts detected)",
    },
    {
      id: "DRAFT_MANUAL_CORRECTION",
      outcome: "review",
      description: "Model draft required manual correction before execution",
    },
    {
      id: "REPLAY_NOT_VERIFIED",
      outcome: "review",
      description: "Replay verification not yet performed for approval-ready run",
    },
  ],
};
