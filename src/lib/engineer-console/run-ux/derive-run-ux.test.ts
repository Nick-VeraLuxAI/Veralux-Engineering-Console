import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunCommandCenter } from "@/components/engineer-console/run-command-center";
import { RunLifecycleStepper } from "@/components/engineer-console/run-lifecycle-stepper";
import {
  deriveRunCommandCenterState,
  deriveRunLifecycleSteps,
} from "./derive-run-ux";
import type { RunWorkflowSummary } from "./run-ux-types";

vi.mock("@/components/engineer-console/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) =>
    React.createElement("span", null, status),
}));

function buildSummary(
  overrides: Partial<RunWorkflowSummary> = {},
): RunWorkflowSummary {
  const run: RunWorkflowSummary["run"] = {
    id: "run-1",
    status: "waiting_for_approval",
    currentStep: "waiting_for_approval",
    branchName: "engineer/test-run",
    riskLevel: "low",
    agentMessage: null,
    ...(overrides.run ?? {}),
  };

  return {
    run,
    task: {
      id: "task-1",
      title: "Add operator UX guidance",
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
      executedOperationCount: 2,
      changedFileCount: 2,
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
      recommendedNextAction: "Proceed to review and approval.",
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
  };
}

describe("UX-1 run guidance", () => {
  it("run command center renders", () => {
    const summary = buildSummary();
    const guidance = deriveRunCommandCenterState(summary);
    const html = renderToStaticMarkup(
      React.createElement(RunCommandCenter, { summary, guidance }),
    );

    expect(html).toContain("Run Command Center");
    expect(html).toContain("Current lifecycle stage");
    expect(html).toContain(guidance.nextRecommendedAction);
  });

  it("lifecycle stepper renders all steps", () => {
    const summary = buildSummary();
    const steps = deriveRunLifecycleSteps(summary);
    const html = renderToStaticMarkup(
      React.createElement(RunLifecycleStepper, {
        steps,
        currentStageId: "approval",
      }),
    );

    expect(html).toContain("Lifecycle");
    expect(html).toContain("Worker Plan");
    expect(html).toContain("Quality Gates");
    expect(html).toContain("Sign-off");
  });

  it("evidence missing produces generate evidence guidance", () => {
    const summary = buildSummary({
      evidence: { exists: false, updatedAt: null },
      replay: { exists: false, status: null, warningCount: 0, failedCount: 0 },
      policy: {
        exists: false,
        status: null,
        blockers: [],
        warnings: [],
        reviewRequired: [],
        recommendedNextAction: null,
      },
    });

    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("evidence");
    expect(guidance.nextRecommendedAction).toBe("Generate evidence bundle.");
  });

  it("replay missing produces replay guidance", () => {
    const summary = buildSummary({
      replay: { exists: false, status: null, warningCount: 0, failedCount: 0 },
      policy: {
        exists: false,
        status: null,
        blockers: [],
        warnings: [],
        reviewRequired: [],
        recommendedNextAction: null,
      },
    });

    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("replay");
    expect(guidance.nextRecommendedAction).toBe("Run replay verification.");
  });

  it("policy missing produces policy guidance", () => {
    const summary = buildSummary({
      policy: {
        exists: false,
        status: null,
        blockers: [],
        warnings: [],
        reviewRequired: [],
        recommendedNextAction: null,
      },
    });

    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("policy");
    expect(guidance.nextRecommendedAction).toBe("Evaluate policy.");
  });

  it("policy requires review produces review and rationale guidance", () => {
    const summary = buildSummary({
      policy: {
        exists: true,
        status: "requires_review",
        blockers: [],
        warnings: [],
        reviewRequired: ["Document deployment rationale."],
        recommendedNextAction: "Complete senior review.",
      },
      review: {
        stageCount: 1,
        requiredCount: 1,
        approvedCount: 0,
        pendingCount: 1,
        rejectedCount: 0,
        skippedCount: 0,
      },
    });

    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("review");
    expect(guidance.nextRecommendedAction).toMatch(/Complete required review stages/i);
    expect(guidance.warnings.some((item) => /Senior review is required/i.test(item.text))).toBe(
      true,
    );
  });

  it("approved run produces PR guidance", () => {
    const summary = buildSummary({
      run: {
        id: "run-1",
        status: "completed",
        currentStep: "approved_by_operator",
        branchName: "engineer/test-run",
        riskLevel: "low",
        agentMessage: null,
      },
      approval: {
        reportAvailable: true,
        canApprove: true,
        governanceIssues: [],
        recommendedNextAction: "Proceed to PR creation.",
        decisionCount: 1,
        latestDecision: "approved",
      },
    });

    const guidance = deriveRunCommandCenterState(summary);
    expect(guidance.currentStageId).toBe("pr");
    expect(guidance.nextRecommendedAction).toBe(
      "Evaluate PR readiness and create a draft PR.",
    );
  });

  it("rendering guidance components does not call fetch", () => {
    const summary = buildSummary();
    const guidance = deriveRunCommandCenterState(summary);
    const steps = deriveRunLifecycleSteps(summary);
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);
    try {
      renderToStaticMarkup(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(RunCommandCenter, { summary, guidance }),
          React.createElement(RunLifecycleStepper, {
            steps,
            currentStageId: guidance.currentStageId,
          }),
        ),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
