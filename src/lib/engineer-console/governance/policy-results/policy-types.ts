export const POLICY_RESULT_STATUSES = [
  "passed",
  "warning",
  "blocked",
  "requires_review",
] as const;

export type PolicyResultStatus = (typeof POLICY_RESULT_STATUSES)[number];

export type PolicyRuleOutcome = "pass" | "block" | "warn" | "review";

export interface PolicyRuleDefinition {
  id: string;
  outcome: "block" | "warn" | "review";
  description: string;
}

export interface EngineeringPolicyDefinition {
  id: string;
  name: string;
  version: string;
  rules: PolicyRuleDefinition[];
}

export interface PolicyRuleResult {
  ruleId: string;
  outcome: PolicyRuleOutcome;
  message: string;
  details?: Record<string, unknown>;
}

export interface PolicyEvaluationSignals {
  runStatus: string;
  workerPlanValidationStatus: string | null;
  governanceRiskLevel: string | null;
  blockedFileCount: number;
  changedFileCount: number;
  qualityGatesFailed: number;
  qualityGatesSkipped: number;
  qualityGatesPassed: number;
  evidenceBundlePresent: boolean;
  evidenceBundleUpdatedAfterDecision: boolean;
  decisionRecordCount: number;
  latestDecision: string | null;
  replayVerificationStatus: string | null;
  replayVerificationFailedChecks: number;
  replayVerificationWarningChecks: number;
  indexedFileMismatchCount: number;
  unindexedModifiedCount: number;
  packageLockChanged: boolean;
  migrationsChanged: boolean;
  draftValidationIssue: boolean;
  compatibilityBreakingCount: number;
  compatibilityWarningCount: number;
  compatibilityUnknownCount: number;
}

export interface PolicyEvaluationResult {
  runId: string;
  policyId: string;
  policyName: string;
  policyVersion: string;
  policyHash: string;
  status: PolicyResultStatus;
  summary: string;
  evaluatedAt: string;
  rules: PolicyRuleResult[];
  blockers: string[];
  warnings: string[];
  reviewRequired: string[];
  signals: PolicyEvaluationSignals;
  recommendedNextAction: string;
}

export interface PolicyResultRecord {
  id: string;
  runId: string;
  policyId: string | null;
  policyVersion: string;
  policyHash: string;
  status: PolicyResultStatus;
  summary: string | null;
  resultJson: string;
  createdAt: string;
}

export interface GovernancePolicyRecord {
  id: string;
  name: string;
  version: string;
  policyHash: string;
  policyJson: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class PolicyEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyEvaluationError";
  }
}
