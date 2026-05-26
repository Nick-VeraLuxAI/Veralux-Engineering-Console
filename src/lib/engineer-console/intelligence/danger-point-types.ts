export const DANGER_POINT_SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type DangerPointSeverity = (typeof DANGER_POINT_SEVERITIES)[number];

export const DANGER_POINT_CATEGORIES = [
  "intent_interpretation",
  "worker_plan_scope",
  "protected_domain",
  "verification",
  "policy_review",
  "audit_integrity",
  "pr_recovery",
  "release_governance",
  "deployment_health",
  "freshness_staleness",
] as const;

export type DangerPointCategory = (typeof DANGER_POINT_CATEGORIES)[number];

export const RUN_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type RunRiskLevel = (typeof RUN_RISK_LEVELS)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const ESCALATION_LEVELS = [
  "none",
  "operator_review",
  "required_review_stage",
  "senior_approval",
  "blocked",
] as const;

export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export const PLAYBOOK_SAFETY_LEVELS = ["safe", "cautious", "manual_only"] as const;

export type PlaybookSafetyLevel = (typeof PLAYBOOK_SAFETY_LEVELS)[number];

export const INTELLIGENCE_PATH_DOMAINS = [
  "docs",
  "tests",
  "ui",
  "staging_only",
  "app_logic",
  "api_logic",
  "integration_glue",
  "auth_security",
  "billing_pricing",
  "database_migration",
  "deployment_env",
  "governance_release",
  "tenant_isolation",
  "external_provider",
  "credential_handling",
  "payment_execution",
  "permission_escalation",
  "production_data",
] as const;

export type IntelligencePathDomain = (typeof INTELLIGENCE_PATH_DOMAINS)[number];

export interface DangerPoint {
  id: string;
  category: DangerPointCategory;
  severity: DangerPointSeverity;
  title: string;
  explanation: string;
  evidence: string[];
  recommendedAction: string;
  anchorTarget: string | null;
  humanReviewRequired: boolean;
  futurePlaybookPossible: boolean;
}

export interface PlaybookRecommendation {
  playbookId: string;
  title: string;
  description: string;
  safetyLevel: PlaybookSafetyLevel;
  requiresHumanConfirmation: boolean;
  targetPanelAnchor: string | null;
}

export interface ChangedFileRiskSummary {
  totalFiles: number;
  docsOnly: boolean;
  testOnly: boolean;
  uiDisplayOnly: boolean;
  stagingOnly: boolean;
  reversibleSimpleFileCreation: boolean;
  domainCounts: Partial<Record<IntelligencePathDomain, number>>;
  highRiskPaths: string[];
  criticalRiskPaths: string[];
  summary: string;
}

export interface RunRiskClassification {
  riskLevel: RunRiskLevel;
  riskScore: number;
  reasons: string[];
  highestSeverity: DangerPointSeverity;
  changedFileRiskSummary: ChangedFileRiskSummary;
}

export interface RunConfidenceAssessment {
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
}

export interface RunEscalationAssessment extends RunConfidenceAssessment {
  escalationLevel: EscalationLevel;
  escalationReason: string;
  humanReviewRequired: boolean;
  recommendedNextAction: string;
}

export interface RunIntelligenceSummary {
  dangerPoints: DangerPoint[];
  riskLevel: RunRiskLevel;
  riskScore: number;
  riskReasons: string[];
  highestSeverity: DangerPointSeverity;
  changedFileRiskSummary: ChangedFileRiskSummary;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  escalationLevel: EscalationLevel;
  escalationReason: string;
  humanReviewRequired: boolean;
  recommendedNextAction: string;
  playbookRecommendations: PlaybookRecommendation[];
  operatorSummary: string;
  whyThisMatters: string;
  signalAudit: {
    availableOnRunPage: string[];
    derivedLocally: string[];
  };
  technicalDetails: {
    taskSignals: string[];
    verificationSignals: string[];
    releaseSignals: string[];
    derivedNotes: string[];
  };
}
