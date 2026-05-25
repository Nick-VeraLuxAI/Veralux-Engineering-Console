import { describe, expect, it } from "vitest";
import type { RunCommandCenterState, RunWorkflowSummary } from "./run-ux-types";
import { deriveRunIssues } from "./run-issues";

function buildSummary(
  overrides: Partial<RunWorkflowSummary> = {},
): RunWorkflowSummary {
  return {
    run: {
      id: "run-1",
      status: "waiting_for_approval",
      currentStep: "waiting_for_approval",
      branchName: "engineer/test-run",
      riskLevel: "medium",
      agentMessage: null,
      ...(overrides.run ?? {}),
    },
    task: {
      id: "task-1",
      title: "Workspace issue test",
      description: "Verify issue routing.",
      ...(overrides.task ?? {}),
    },
    workerPlan: {
      hasDraft: false,
      exists: true,
      validationStatus: "valid",
      executionStatus: "executed",
      validationErrorCount: 0,
      validationWarningCount: 0,
      executionErrorCount: 0,
      executedOperationCount: 2,
      changedFileCount: 2,
      showReadmeSmokeHelper: false,
      ...(overrides.workerPlan ?? {}),
    },
    qualityGates: {
      count: 2,
      passedCount: 2,
      failedCount: 0,
      skippedCount: 0,
      failedCommands: [],
      skippedCommands: [],
      ...(overrides.qualityGates ?? {}),
    },
    approval: {
      reportAvailable: true,
      canApprove: true,
      governanceIssues: [],
      recommendedNextAction: "Approve the run.",
      decisionCount: 0,
      latestDecision: null,
      ...(overrides.approval ?? {}),
    },
    evidence: {
      exists: true,
      updatedAt: "2026-05-25T05:00:00.000Z",
      ...(overrides.evidence ?? {}),
    },
    replay: {
      exists: true,
      status: "passed",
      warningCount: 0,
      failedCount: 0,
      ...(overrides.replay ?? {}),
    },
    policy: {
      exists: true,
      status: "passed",
      blockers: [],
      warnings: [],
      reviewRequired: [],
      recommendedNextAction: "Proceed to approval.",
      ...(overrides.policy ?? {}),
    },
    review: {
      stageCount: 0,
      requiredCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
      ...(overrides.review ?? {}),
    },
    pr: {
      attemptCount: 0,
      latestStatus: null,
      latestPrUrl: null,
      latestPrNumber: null,
      latestCommitShaPrefix: null,
      latestReadinessStatus: null,
      latestReadinessBlockers: [],
      latestReadinessWarnings: [],
      latestErrorMessage: null,
      ...(overrides.pr ?? {}),
    },
    merge: {
      attemptCount: 0,
      latestStatus: null,
      latestMergeShaPrefix: null,
      ...(overrides.merge ?? {}),
    },
    deployment: {
      approvalCount: 0,
      latestApprovalDecision: null,
      latestExecutionStatus: null,
      latestHealthCheckStatus: null,
      latestHealthPolicyStatus: null,
      latestHealthPolicyRecommendedAction: null,
      latestHealthPolicyBlockers: [],
      latestHealthPolicyWarnings: [],
      ...(overrides.deployment ?? {}),
    },
    release: {
      checklistRecorded: false,
      checklistStatus: null,
      checklistBlockers: [],
      checklistNeedsAttention: [],
      checklistRecommendedAction: null,
      signoffCount: 0,
      latestSignoffDecision: null,
      latestSignoffRationale: null,
      ...(overrides.release ?? {}),
    },
    hardGates: {
      enabled: true,
      mergeStatus: "passed",
      mergeBlockers: [],
      deploymentApprovalStatus: "passed",
      deploymentApprovalBlockers: [],
      deploymentExecutionStatus: "passed",
      deploymentExecutionBlockers: [],
      signoffCompletedStatus: "passed",
      signoffCompletedBlockers: [],
      signoffExceptionsStatus: "passed",
      signoffExceptionsBlockers: [],
      ...(overrides.hardGates ?? {}),
    },
    audit: {
      eventCount: 12,
      chainOk: true,
      chainFailureCount: 0,
      chainFailures: [],
      ...(overrides.audit ?? {}),
    },
  };
}

function buildGuidance(overrides: Partial<RunCommandCenterState> = {}): RunCommandCenterState {
  return {
    currentStageId: "approval",
    currentStageLabel: "Approval",
    nextRecommendedAction: "Review the approval report.",
    explanation: "Approval is the current focus.",
    primaryAction: {
      label: "Review approval report",
      href: "#approval",
    },
    blockers: [],
    warnings: [],
    secondaryActions: [],
    ...overrides,
  };
}

describe("deriveRunIssues", () => {
  it("returns no issues when the run has no derived problems", () => {
    const issues = deriveRunIssues(
      buildSummary({
        run: { status: "completed", currentStep: "release_signed_off" },
        approval: { latestDecision: "approved", decisionCount: 1, canApprove: false },
        release: {
          checklistRecorded: true,
          checklistStatus: "complete",
          checklistBlockers: [],
          checklistNeedsAttention: [],
          checklistRecommendedAction: null,
          signoffCount: 1,
          latestSignoffDecision: "completed",
          latestSignoffRationale: null,
        },
      }),
      buildGuidance({
        currentStageId: "signoff",
        currentStageLabel: "Sign-off",
        nextRecommendedAction: "Run is fully signed off.",
      }),
    );

    expect(issues).toHaveLength(0);
  });

  it("routes audit chain failures to the audit workspace", () => {
    const issues = deriveRunIssues(
      buildSummary({
        audit: {
          eventCount: 12,
          chainOk: false,
          chainFailureCount: 1,
          chainFailures: ["hash mismatch"],
        },
      }),
      buildGuidance(),
    );

    expect(issues[0]?.id).toBe("audit-chain-failed");
    expect(issues[0]?.severity).toBe("critical");
    expect(issues[0]?.view).toBe("audit");
  });

  it("routes PR retry state to the PR workspace", () => {
    const issues = deriveRunIssues(
      buildSummary({
        run: { status: "completed", currentStep: "approved_by_operator" },
        approval: { latestDecision: "approved", decisionCount: 1, canApprove: false },
        pr: {
          attemptCount: 1,
          latestStatus: "failed",
          latestPrUrl: null,
          latestPrNumber: null,
          latestCommitShaPrefix: "abc12345",
          latestReadinessStatus: "warning",
          latestReadinessBlockers: [],
          latestReadinessWarnings: [],
          latestErrorMessage: "network timeout",
        },
      }),
      buildGuidance({
        currentStageId: "pr",
        currentStageLabel: "PR",
        nextRecommendedAction: "Retry draft PR creation.",
      }),
    );

    const issue = issues.find((entry) => entry.id === "pr-retry-available");
    expect(issue?.view).toBe("pr");
    expect(issue?.anchorId).toBe("pr-creation");
  });

  it("routes hard release gate blockers to the release workspace", () => {
    const issues = deriveRunIssues(
      buildSummary({
        hardGates: {
          enabled: true,
          mergeStatus: "blocked",
          mergeBlockers: ["Release checklist not completed"],
          deploymentApprovalStatus: "passed",
          deploymentApprovalBlockers: [],
          deploymentExecutionStatus: "passed",
          deploymentExecutionBlockers: [],
          signoffCompletedStatus: "passed",
          signoffCompletedBlockers: [],
          signoffExceptionsStatus: "passed",
          signoffExceptionsBlockers: [],
        },
      }),
      buildGuidance({
        currentStageId: "merge",
        currentStageLabel: "Merge",
        nextRecommendedAction: "Review merge controls.",
      }),
    );

    const issue = issues.find((entry) => entry.id === "hard-release-gates-blocked");
    expect(issue?.severity).toBe("critical");
    expect(issue?.view).toBe("release");
    expect(issue?.anchorId).toBe("merge-controls");
  });
});
