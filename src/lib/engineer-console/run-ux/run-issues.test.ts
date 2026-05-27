import { describe, expect, it } from "vitest";
import { deriveRunCommandCenterState } from "./derive-run-ux";
import type { RunCommandCenterState, RunWorkflowSummary } from "./run-ux-types";
import { deriveRunIssueQueue, deriveRunIssues } from "./run-issues";

function buildSummary(
  overrides: Partial<RunWorkflowSummary> = {},
): RunWorkflowSummary {
  return {
    run: {
      id: "run-1",
      status: "running",
      currentStep: "worker_plan",
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
      hasDraft: true,
      exists: true,
      validationStatus: "valid",
      executionStatus: null,
      validationErrorCount: 0,
      validationWarningCount: 0,
      executionErrorCount: 0,
      executedOperationCount: 0,
      changedFileCount: 0,
      showReadmeSmokeHelper: false,
      ...(overrides.workerPlan ?? {}),
    },
    qualityGates: {
      count: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      failedCommands: [],
      skippedCommands: [],
      ...(overrides.qualityGates ?? {}),
    },
    approval: {
      reportAvailable: false,
      canApprove: false,
      governanceIssues: [],
      recommendedNextAction: null,
      decisionCount: 0,
      latestDecision: null,
      ...(overrides.approval ?? {}),
    },
    evidence: {
      exists: false,
      updatedAt: null,
      ...(overrides.evidence ?? {}),
    },
    replay: {
      exists: false,
      status: null,
      warningCount: 0,
      failedCount: 0,
      ...(overrides.replay ?? {}),
    },
    policy: {
      exists: false,
      status: null,
      blockers: [],
      warnings: [],
      reviewRequired: [],
      recommendedNextAction: null,
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
      mergeStatus: "blocked",
      mergeBlockers: ["Replay verification has not been run (hard release gates)."],
      deploymentApprovalStatus: "blocked",
      deploymentApprovalBlockers: ["Policy blocked (hard release gates)."],
      deploymentExecutionStatus: "blocked",
      deploymentExecutionBlockers: [],
      signoffCompletedStatus: "blocked",
      signoffCompletedBlockers: ["Checklist missing"],
      signoffExceptionsStatus: "blocked",
      signoffExceptionsBlockers: [],
      ...(overrides.hardGates ?? {}),
    },
    audit: {
      eventCount: 0,
      chainOk: true,
      chainFailureCount: 0,
      chainFailures: [],
      ...(overrides.audit ?? {}),
    },
  };
}

function workerPlanGuidance(summary: RunWorkflowSummary): RunCommandCenterState {
  return deriveRunCommandCenterState(summary);
}

describe("deriveRunIssueQueue lifecycle applicability", () => {
  it("does not show release gates, policy, replay, or approval as active blockers at Worker Plan stage", () => {
    const summary = buildSummary({
      run: { status: "running", currentStep: "worker_plan" },
      workerPlan: {
        hasDraft: true,
        exists: true,
        validationStatus: "valid",
        executionStatus: null,
      },
    });
    const guidance = workerPlanGuidance(summary);
    expect(guidance.currentStageId).toBe("worker_plan");

    const queue = deriveRunIssueQueue(summary, guidance);
    const activeIds = queue.active.map((issue) => issue.id);

    expect(activeIds).not.toContain("hard-release-gates-blocked");
    expect(activeIds).not.toContain("policy-blocked");
    expect(activeIds).not.toContain("replay-missing");
    expect(activeIds).not.toContain("approval-pending");

    const futureIds = queue.future.map((issue) => issue.id);
    expect(futureIds).toContain("hard-release-gates-blocked");
    expect(futureIds).toContain("replay-missing");
    expect(futureIds).toContain("policy-missing");
  });

  it("does not show replay missing as an active warning before replay is applicable", () => {
    const summary = buildSummary();
    const guidance = workerPlanGuidance(summary);
    const replayMissing = deriveRunIssueQueue(summary, guidance).future.find(
      (issue) => issue.id === "replay-missing",
    );

    expect(replayMissing?.applicability).toBe("future_requirement");
    expect(replayMissing?.severity).toBe("info");
    expect(replayMissing?.title).toContain("after evidence");
  });

  it("counts active blockers consistently between attention summary and active issues", () => {
    const summary = buildSummary({
      workerPlan: {
        hasDraft: false,
        exists: true,
        validationStatus: "invalid",
        executionStatus: "failed",
        validationErrorCount: 2,
        executionErrorCount: 1,
      },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const queue = deriveRunIssueQueue(summary, guidance);
    const manualCriticalCount = queue.active.filter((issue) => issue.severity === "critical").length;

    expect(queue.attention.activeBlockerCount).toBe(manualCriticalCount);
    expect(queue.attention.activeBlockerCount).toBeGreaterThan(0);
    expect(guidance.currentStageId).toBe("worker_plan");
  });

  it("shows run-scoped audit chain failure as an active blocker", () => {
    const summary = buildSummary({
      audit: {
        eventCount: 4,
        chainOk: false,
        chainFailureCount: 1,
        chainFailures: ["continuity_break_at_index_2"],
      },
    });
    const guidance = workerPlanGuidance(summary);
    const issue = deriveRunIssueQueue(summary, guidance).active.find(
      (entry) => entry.id === "audit-chain-failed",
    );

    expect(issue?.applicability).toBe("active_now");
    expect(issue?.severity).toBe("critical");
    expect(issue?.title).toContain("Current blocker");
  });

  it("shows scope-only audit failures as historical, not active blockers", () => {
    const summary = buildSummary({
      audit: {
        eventCount: 0,
        chainOk: false,
        chainFailureCount: 1,
        chainFailures: ["duplicate_chain_hash:abc123"],
      },
    });
    const guidance = workerPlanGuidance(summary);
    const queue = deriveRunIssueQueue(summary, guidance);

    expect(queue.active.some((issue) => issue.id === "audit-chain-failed")).toBe(false);
    expect(queue.historical.some((issue) => issue.id === "audit-scope-notice")).toBe(true);
  });

  it("shows PR blockers as active at PR stage", () => {
    const summary = buildSummary({
      run: { status: "completed", currentStep: "approved_by_operator" },
      workerPlan: {
        hasDraft: false,
        exists: true,
        validationStatus: "valid",
        executionStatus: "executed",
        executedOperationCount: 2,
        changedFileCount: 2,
      },
      qualityGates: { count: 2, passedCount: 2, failedCount: 0, skippedCount: 0 },
      evidence: { exists: true, updatedAt: "2026-05-25T05:00:00.000Z" },
      replay: { exists: true, status: "passed", warningCount: 0, failedCount: 0 },
      policy: {
        exists: true,
        status: "passed",
        blockers: [],
        warnings: [],
        reviewRequired: [],
        recommendedNextAction: null,
      },
      approval: {
        reportAvailable: true,
        canApprove: false,
        latestDecision: "approved",
        decisionCount: 1,
      },
      pr: {
        attemptCount: 1,
        latestStatus: "failed",
        latestPrUrl: null,
        latestPrNumber: null,
        latestCommitShaPrefix: "abc12345",
        latestReadinessStatus: "blocked",
        latestReadinessBlockers: ["PR readiness blocked"],
        latestReadinessWarnings: [],
        latestErrorMessage: "network timeout",
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
      },
    });
    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("pr");

    const prIssue = deriveRunIssueQueue(summary, guidance).active.find(
      (issue) => issue.id === "pr-retry-available",
    );
    expect(prIssue?.applicability).toBe("active_now");
  });

  it("shows hard release gate blockers as active at merge stage", () => {
    const summary = buildSummary({
      run: { status: "completed", currentStep: "approved_by_operator" },
      workerPlan: {
        hasDraft: false,
        exists: true,
        validationStatus: "valid",
        executionStatus: "executed",
        executedOperationCount: 2,
        changedFileCount: 2,
      },
      qualityGates: { count: 2, passedCount: 2, failedCount: 0, skippedCount: 0 },
      evidence: { exists: true, updatedAt: "2026-05-25T05:00:00.000Z" },
      replay: { exists: true, status: "passed", warningCount: 0, failedCount: 0 },
      policy: {
        exists: true,
        status: "passed",
        blockers: [],
        warnings: [],
        reviewRequired: [],
        recommendedNextAction: null,
      },
      approval: {
        reportAvailable: true,
        canApprove: false,
        latestDecision: "approved",
        decisionCount: 1,
      },
      pr: {
        attemptCount: 1,
        latestStatus: "pr_created",
        latestPrUrl: "https://example.com/pr/1",
        latestPrNumber: "1",
        latestCommitShaPrefix: "abc12345",
        latestReadinessStatus: "ready",
        latestReadinessBlockers: [],
        latestReadinessWarnings: [],
        latestErrorMessage: null,
      },
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
    });
    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("merge");

    const gateIssue = deriveRunIssueQueue(summary, guidance).active.find(
      (issue) => issue.id === "hard-release-gates-blocked",
    );
    expect(gateIssue?.applicability).toBe("active_now");
    expect(gateIssue?.severity).toBe("critical");
  });

  it("shows deployment health warnings as active at health stage", () => {
    const summary = buildSummary({
      run: { status: "completed", currentStep: "deployed" },
      workerPlan: {
        hasDraft: false,
        exists: true,
        validationStatus: "valid",
        executionStatus: "executed",
        executedOperationCount: 2,
        changedFileCount: 2,
      },
      qualityGates: { count: 2, passedCount: 2, failedCount: 0, skippedCount: 0 },
      evidence: { exists: true, updatedAt: "2026-05-25T05:00:00.000Z" },
      replay: { exists: true, status: "passed", warningCount: 0, failedCount: 0 },
      policy: {
        exists: true,
        status: "passed",
        blockers: [],
        warnings: [],
        reviewRequired: [],
        recommendedNextAction: null,
      },
      approval: {
        reportAvailable: true,
        canApprove: false,
        latestDecision: "approved",
        decisionCount: 1,
      },
      pr: {
        attemptCount: 1,
        latestStatus: "pr_created",
        latestPrUrl: "https://example.com/pr/1",
        latestPrNumber: "1",
        latestCommitShaPrefix: "abc12345",
        latestReadinessStatus: "ready",
        latestReadinessBlockers: [],
        latestReadinessWarnings: [],
        latestErrorMessage: null,
      },
      merge: { attemptCount: 1, latestStatus: "merged", latestMergeShaPrefix: "def45678" },
      deployment: {
        approvalCount: 1,
        latestApprovalDecision: "approved",
        latestExecutionStatus: "succeeded",
        latestHealthCheckStatus: "unhealthy",
        latestHealthPolicyStatus: "unhealthy",
        latestHealthPolicyRecommendedAction: "Review health checks",
        latestHealthPolicyBlockers: ["Deployment health policy is unhealthy"],
        latestHealthPolicyWarnings: [],
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
      },
    });
    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("health");

    const healthIssue = deriveRunIssueQueue(summary, guidance).active.find(
      (issue) => issue.id === "deployment-health-warning",
    );
    expect(healthIssue?.applicability).toBe("active_now");
  });

  it("returns no issues when the run has no derived problems at sign-off", () => {
    const issues = deriveRunIssues(
      buildSummary({
        run: { status: "completed", currentStep: "release_signed_off" },
        workerPlan: {
          hasDraft: false,
          exists: true,
          validationStatus: "valid",
          executionStatus: "executed",
          executedOperationCount: 2,
          changedFileCount: 2,
        },
        qualityGates: { count: 2, passedCount: 2, failedCount: 0, skippedCount: 0 },
        evidence: { exists: true, updatedAt: "2026-05-25T05:00:00.000Z" },
        replay: { exists: true, status: "passed", warningCount: 0, failedCount: 0 },
        policy: {
          exists: true,
          status: "passed",
          blockers: [],
          warnings: [],
          reviewRequired: [],
          recommendedNextAction: null,
        },
        approval: { latestDecision: "approved", decisionCount: 1, canApprove: false },
        pr: {
          attemptCount: 1,
          latestStatus: "pr_created",
          latestPrUrl: "https://example.com/pr/1",
          latestPrNumber: "1",
          latestCommitShaPrefix: "abc12345",
          latestReadinessStatus: "ready",
          latestReadinessBlockers: [],
          latestReadinessWarnings: [],
          latestErrorMessage: null,
        },
        merge: { attemptCount: 1, latestStatus: "merged", latestMergeShaPrefix: "def45678" },
        deployment: {
          approvalCount: 1,
          latestApprovalDecision: "approved",
          latestExecutionStatus: "succeeded",
          latestHealthCheckStatus: "healthy",
          latestHealthPolicyStatus: "healthy",
          latestHealthPolicyRecommendedAction: null,
          latestHealthPolicyBlockers: [],
          latestHealthPolicyWarnings: [],
        },
        release: {
          checklistRecorded: true,
          checklistStatus: "complete",
          signoffCount: 1,
          latestSignoffDecision: "completed",
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
        },
      }),
      {
        currentStageId: "signoff",
        currentStageLabel: "Sign-off",
        nextRecommendedAction: "Run is fully signed off.",
        explanation: "Complete.",
        primaryAction: { label: "Review", href: "#" },
        blockers: [],
        warnings: [],
        secondaryActions: [],
      },
    );

    expect(issues).toHaveLength(0);
  });

  it("routes audit chain failures to the audit workspace", () => {
    const summary = buildSummary({
      audit: {
        eventCount: 12,
        chainOk: false,
        chainFailureCount: 1,
        chainFailures: ["payload_hash_mismatch_at_index_1"],
      },
      workerPlan: {
        hasDraft: false,
        exists: true,
        validationStatus: "valid",
        executionStatus: "executed",
        executedOperationCount: 2,
        changedFileCount: 2,
      },
      qualityGates: { count: 2, passedCount: 2, failedCount: 0, skippedCount: 0 },
      evidence: { exists: true, updatedAt: "2026-05-25T05:00:00.000Z" },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const issues = deriveRunIssues(summary, guidance);

    expect(issues[0]?.id).toBe("audit-chain-failed");
    expect(issues[0]?.view).toBe("audit");
  });
});
