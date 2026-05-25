export const RUN_PANEL_IDS = {
  runState: "run-state",
  workerPlan: "worker-plan",
  changedFiles: "changed-files",
  qualityGates: "quality-gates",
  evidence: "evidence",
  replay: "replay",
  policy: "policy",
  reviewStages: "review-stages",
  approval: "approval",
  prCreation: "pr-creation",
  mergeControls: "merge-controls",
  deploymentGates: "deployment-gates",
  deploymentExecution: "deployment-execution",
  deploymentHealth: "deployment-health",
  deploymentHealthPolicy: "deployment-health-policy",
  releaseChecklist: "release-checklist",
  releaseSignoff: "release-signoff",
  auditTimeline: "audit-timeline",
} as const;

export const RUN_LIFECYCLE_STEPS = [
  "task",
  "branch",
  "worker_plan",
  "quality_gates",
  "evidence",
  "replay",
  "policy",
  "review",
  "approval",
  "pr",
  "merge",
  "deployment",
  "health",
  "checklist",
  "signoff",
] as const;

export type RunLifecycleStepId = (typeof RUN_LIFECYCLE_STEPS)[number];
export type RunLifecycleStepStatus =
  | "not_started"
  | "ready"
  | "blocked"
  | "warning"
  | "passed"
  | "complete";

export interface RunWorkflowSummary {
  run: {
    id: string;
    status: string;
    currentStep: string | null;
    branchName: string | null;
    riskLevel: string | null;
    agentMessage: string | null;
  };
  task: {
    id: string;
    title: string;
    description: string;
  };
  workerPlan: {
    hasDraft: boolean;
    exists: boolean;
    validationStatus: string | null;
    executionStatus: string | null;
    validationErrorCount: number;
    validationWarningCount: number;
    executionErrorCount: number;
    executedOperationCount: number;
    changedFileCount: number;
    showReadmeSmokeHelper: boolean;
  };
  qualityGates: {
    count: number;
    passedCount: number;
    failedCount: number;
    skippedCount: number;
    failedCommands: string[];
    skippedCommands: string[];
  };
  approval: {
    reportAvailable: boolean;
    canApprove: boolean;
    governanceIssues: string[];
    recommendedNextAction: string | null;
    decisionCount: number;
    latestDecision: string | null;
  };
  evidence: {
    exists: boolean;
    updatedAt: string | null;
  };
  replay: {
    exists: boolean;
    status: string | null;
    warningCount: number;
    failedCount: number;
  };
  policy: {
    exists: boolean;
    status: string | null;
    blockers: string[];
    warnings: string[];
    reviewRequired: string[];
    recommendedNextAction: string | null;
  };
  review: {
    stageCount: number;
    requiredCount: number;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
    skippedCount: number;
  };
  pr: {
    attemptCount: number;
    latestStatus: string | null;
    latestPrUrl: string | null;
    latestErrorMessage: string | null;
  };
  merge: {
    attemptCount: number;
    latestStatus: string | null;
    latestMergeShaPrefix: string | null;
  };
  deployment: {
    approvalCount: number;
    latestApprovalDecision: string | null;
    latestExecutionStatus: string | null;
    latestHealthCheckStatus: string | null;
    latestHealthPolicyStatus: string | null;
    latestHealthPolicyRecommendedAction: string | null;
    latestHealthPolicyBlockers: string[];
    latestHealthPolicyWarnings: string[];
  };
  release: {
    checklistRecorded: boolean;
    checklistStatus: string | null;
    checklistBlockers: string[];
    checklistNeedsAttention: string[];
    checklistRecommendedAction: string | null;
    signoffCount: number;
    latestSignoffDecision: string | null;
    latestSignoffRationale: string | null;
  };
  hardGates: {
    enabled: boolean;
    mergeStatus: string | null;
    mergeBlockers: string[];
    deploymentApprovalStatus: string | null;
    deploymentApprovalBlockers: string[];
    deploymentExecutionStatus: string | null;
    deploymentExecutionBlockers: string[];
    signoffCompletedStatus: string | null;
    signoffCompletedBlockers: string[];
    signoffExceptionsStatus: string | null;
    signoffExceptionsBlockers: string[];
  };
}

export interface RunGuidanceItem {
  text: string;
  href?: string;
}

export interface RunCommandCenterAction {
  label: string;
  href: string;
}

export interface RunSecondaryActionSummary {
  label: string;
  description: string;
  href?: string;
}

export interface RunCommandCenterState {
  currentStageId: RunLifecycleStepId;
  currentStageLabel: string;
  nextRecommendedAction: string;
  explanation: string;
  primaryAction: RunCommandCenterAction;
  blockers: RunGuidanceItem[];
  warnings: RunGuidanceItem[];
  secondaryActions: RunSecondaryActionSummary[];
}

export interface RunLifecycleStepState {
  id: RunLifecycleStepId;
  label: string;
  status: RunLifecycleStepStatus;
  href: string;
}
