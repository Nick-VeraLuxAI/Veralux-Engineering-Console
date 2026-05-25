import { describe, expect, it } from "vitest";
import { deriveRunCommandCenterState, deriveRunLifecycleSteps } from "./derive-run-ux";
import {
  deriveRunCurrentActionZoneState,
  deriveRunSectionGroups,
  groupContainsPanel,
} from "./run-page-sections";
import { RUN_PANEL_IDS, type RunWorkflowSummary } from "./run-ux-types";

function buildSummary(
  overrides: Partial<RunWorkflowSummary> = {},
): RunWorkflowSummary {
  return {
    run: {
      id: "run-1",
      status: "waiting_for_approval",
      currentStep: "waiting_for_approval",
      branchName: "engineer/test-run",
      riskLevel: "low",
      agentMessage: null,
      ...(overrides.run ?? {}),
    },
    task: {
      id: "task-1",
      title: "Improve progressive disclosure",
      description: "Reduce run page density without removing panels.",
      ...(overrides.task ?? {}),
    },
    workerPlan: {
      hasDraft: true,
      exists: true,
      validationStatus: "valid",
      executionStatus: "executed",
      validationErrorCount: 0,
      validationWarningCount: 0,
      executionErrorCount: 0,
      executedOperationCount: 3,
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
      enabled: false,
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
      eventCount: 10,
      chainOk: true,
      chainFailureCount: 0,
      chainFailures: [],
      ...(overrides.audit ?? {}),
    },
  };
}

describe("deriveRunSectionGroups", () => {
  it("keeps technical audit collapsed by default when chain verification is healthy", () => {
    const summary = buildSummary();
    const guidance = deriveRunCommandCenterState(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(groups.find((group) => group.id === "technical_audit")?.defaultExpanded).toBe(false);
  });

  it("expands technical audit when chain verification fails", () => {
    const summary = buildSummary({
      audit: {
        eventCount: 10,
        chainOk: false,
        chainFailureCount: 1,
        chainFailures: ["tampered-hash"],
      },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(groups.find((group) => group.id === "technical_audit")?.defaultExpanded).toBe(true);
  });

  it("expands the PR and release group when PR work is active", () => {
    const summary = buildSummary({
      run: { currentStep: "approved_by_operator", status: "completed" },
      approval: { latestDecision: "approved", decisionCount: 1, canApprove: false },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(guidance.currentStageId).toBe("pr");
    expect(groups.find((group) => group.id === "pr_release")?.defaultExpanded).toBe(true);
  });

  it("expands active work when the run is waiting for approval", () => {
    const summary = buildSummary();
    const guidance = deriveRunCommandCenterState(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(guidance.currentStageId).toBe("approval");
    expect(groups.find((group) => group.id === "active_work")?.defaultExpanded).toBe(true);
  });

  it("expands active work before the worker plan has executed", () => {
    const summary = buildSummary({
      run: { status: "running", currentStep: "worker_plan_executing" },
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
      },
      qualityGates: {
        count: 0,
        passedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        failedCommands: [],
        skippedCommands: [],
      },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(guidance.currentStageId).toBe("worker_plan");
    expect(groups.find((group) => group.id === "active_work")?.defaultExpanded).toBe(true);
  });

  it("expands the release group when checklist or sign-off work is active", () => {
    const summary = buildSummary({
      run: { currentStep: "release_checklist", status: "completed" },
      approval: { latestDecision: "approved", decisionCount: 1, canApprove: false },
      pr: { attemptCount: 1, latestStatus: "pr_created", latestPrUrl: "https://example.com/pr/1" },
      merge: { attemptCount: 1, latestStatus: "merged", latestMergeShaPrefix: "abc123def456" },
      deployment: {
        approvalCount: 1,
        latestApprovalDecision: "approved",
        latestExecutionStatus: "succeeded",
        latestHealthCheckStatus: "passed",
        latestHealthPolicyStatus: "healthy",
        latestHealthPolicyRecommendedAction: null,
        latestHealthPolicyBlockers: [],
        latestHealthPolicyWarnings: [],
      },
      release: {
        checklistRecorded: true,
        checklistStatus: "passed",
        checklistBlockers: [],
        checklistNeedsAttention: [],
        checklistRecommendedAction: "Record sign-off.",
        signoffCount: 0,
        latestSignoffDecision: null,
        latestSignoffRationale: null,
      },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(groups.find((group) => group.id === "pr_release")?.defaultExpanded).toBe(true);
  });

  it("keeps lifecycle and current action links pointed at stable panel anchors", () => {
    const summary = buildSummary({
      run: { currentStep: "approved_by_operator", status: "completed" },
      approval: { latestDecision: "approved", decisionCount: 1, canApprove: false },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const currentAction = deriveRunCurrentActionZoneState(summary, guidance);
    const steps = deriveRunLifecycleSteps(summary);
    const groups = deriveRunSectionGroups(summary, guidance);

    expect(currentAction.primaryAction.href).toBe(`#${RUN_PANEL_IDS.prCreation}`);
    expect(steps.find((step) => step.id === "pr")?.href).toBe(`#${RUN_PANEL_IDS.prCreation}`);
    expect(groupContainsPanel(groups, "pr_release", RUN_PANEL_IDS.prCreation)).toBe(true);
  });
});
