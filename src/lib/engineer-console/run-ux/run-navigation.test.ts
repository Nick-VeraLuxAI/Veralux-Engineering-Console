import { describe, expect, it } from "vitest";
import { RUN_PANEL_IDS, type RunWorkflowSummary } from "./run-ux-types";
import { deriveRunCommandCenterState } from "./derive-run-ux";
import {
  RUN_NAV_TARGET_IDS,
  buildRunExpertSummaryItems,
  buildRunQuickNavItems,
  expandGroupForTarget,
  resolveRunNavigationShortcut,
} from "./run-navigation";

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
      title: "Add faster operator jumps",
      description: "Speed up repeat navigation without changing workflow behavior.",
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

describe("run navigation helpers", () => {
  it("builds quick nav items with stable anchors", () => {
    const summary = buildSummary();
    const guidance = deriveRunCommandCenterState(summary);
    const items = buildRunQuickNavItems(summary, guidance);

    expect(items.map((item) => item.label)).toEqual([
      "Current action",
      "Worker plan",
      "Approval",
      "Evidence",
      "Replay",
      "Policy",
      "Reviews",
      "PR",
      "Merge",
      "Deploy",
      "Checklist",
      "Sign-off",
      "Audit",
    ]);
    expect(items.find((item) => item.id === "pr")?.href).toBe(`#${RUN_PANEL_IDS.prCreation}`);
    expect(items.find((item) => item.id === "audit")?.href).toBe(`#${RUN_PANEL_IDS.auditTimeline}`);
    expect(items.find((item) => item.id === "current-action")?.href).toBe(
      `#${RUN_NAV_TARGET_IDS.currentAction}`,
    );
  });

  it("expands the PR and release group for PR targets", () => {
    const expanded = expandGroupForTarget(
      {
        active_work: false,
        governance_review: false,
        pr_release: false,
        technical_audit: false,
      },
      RUN_PANEL_IDS.prCreation,
    );

    expect(expanded.pr_release).toBe(true);
  });

  it("expands the technical audit group for audit targets", () => {
    const expanded = expandGroupForTarget(
      {
        active_work: false,
        governance_review: false,
        pr_release: false,
        technical_audit: false,
      },
      RUN_NAV_TARGET_IDS.auditChainDiagnostics,
    );

    expect(expanded.technical_audit).toBe(true);
  });

  it("builds the expert summary strip with key statuses", () => {
    const summary = buildSummary({
      pr: { latestStatus: "pr_created", latestPrUrl: "https://example.com/pr/1" },
      release: { checklistRecorded: true, checklistStatus: "needs_attention" },
    });
    const guidance = deriveRunCommandCenterState(summary);
    const items = buildRunExpertSummaryItems(summary, guidance);

    expect(items.find((item) => item.label === "Run")?.status).toBe("waiting_for_approval");
    expect(items.find((item) => item.label === "PR")?.status).toBe("pr_created");
    expect(items.find((item) => item.label === "Release gates")?.status).toBe("disabled");
    expect(items.find((item) => item.label === "Sign-off")?.status).toBe("not started");
  });

  it("resolves safe keyboard shortcuts to navigation targets only", () => {
    const inputLikeTarget = {
      closest(selector: string) {
        return selector === "input, textarea, select" ? {} : null;
      },
    } as EventTarget;

    expect(
      resolveRunNavigationShortcut({
        pendingPrefix: null,
        key: "g",
        target: null,
      }),
    ).toEqual({ nextPendingPrefix: "g", targetId: null });

    expect(
      resolveRunNavigationShortcut({
        pendingPrefix: "g",
        key: "w",
        target: null,
      }),
    ).toEqual({ nextPendingPrefix: null, targetId: RUN_PANEL_IDS.workerPlan });

    expect(
      resolveRunNavigationShortcut({
        pendingPrefix: "g",
        key: "w",
        target: inputLikeTarget,
      }),
    ).toEqual({ nextPendingPrefix: null, targetId: null });
  });

  it("does not navigate on unrelated keys", () => {
    expect(
      resolveRunNavigationShortcut({
        pendingPrefix: null,
        key: "p",
        target: null,
      }),
    ).toEqual({ nextPendingPrefix: null, targetId: null });
  });
});
