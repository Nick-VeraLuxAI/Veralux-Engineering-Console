import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HardReleaseGateBannerContent } from "@/components/engineer-console/hard-release-gate-banner";
import { PrStateCard } from "@/components/engineer-console/pr-state-card";
import { RunApprovalActionCard } from "@/components/engineer-console/run-approval-action-card";
import { ReviewStagesPanel } from "@/components/engineer-console/review-stages-panel";
import { RunCommandCenter } from "@/components/engineer-console/run-command-center";
import { RunLifecycleStepper } from "@/components/engineer-console/run-lifecycle-stepper";
import { derivePrStateCardState } from "@/lib/engineer-console/release/pr-creation/pr-state-ux";
import {
  deriveRunApprovalActionCardState,
  deriveRunCommandCenterState,
  deriveRunLifecycleSteps,
} from "./derive-run-ux";
import type { RunWorkflowSummary } from "./run-ux-types";

vi.mock("@/components/engineer-console/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) =>
    React.createElement("span", null, status),
}));

vi.mock("@/components/engineer-console/approval-actions", () => ({
  ApprovalActions: ({
    showApprove,
    showRequestFix,
    showStop,
  }: {
    showApprove?: boolean;
    showRequestFix?: boolean;
    showStop?: boolean;
  }) =>
    React.createElement(
      "div",
      null,
      showApprove ? "Approve run" : "",
      showRequestFix ? "Request Fix" : "",
      showStop ? "Stop Run" : "",
    ),
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
      description: "Improve operator clarity on the run page.",
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

  it("approval action card renders", () => {
    const summary = buildSummary();
    const state = deriveRunApprovalActionCardState(summary);
    const html = renderToStaticMarkup(
      React.createElement(RunApprovalActionCard, {
        runId: "run-1",
        state,
      }),
    );

    expect(html).toContain("Approval actions");
    expect(html).toContain("Current approval state");
  });

  it("PR state card renders and shows commit will be created before first attempt", () => {
    const state = derivePrStateCardState({
      readiness: {
        status: "passed",
        blockers: [],
        warnings: [],
        recommendedAction: "Ready to create commit and draft PR.",
        signals: {
          branchName: "engineer/test-run",
          runBranchName: "engineer/test-run",
          currentBranchName: "engineer/test-run",
          currentBranchMatchesRunBranch: true,
        },
      },
      requests: [],
    });
    const html = renderToStaticMarkup(React.createElement(PrStateCard, { state }));

    expect(html).toContain("PR state");
    expect(html).toContain("Commit will be created");
    expect(html).toContain("Create draft PR");
  });

  it("PR state card explains retry after partial failure with pushed branch", () => {
    const state = derivePrStateCardState({
      readiness: {
        status: "passed",
        blockers: [],
        warnings: [],
        recommendedAction: "Ready to resume PR creation using the existing run commit.",
        signals: {
          branchName: "engineer/test-run",
          runBranchName: "engineer/test-run",
          currentBranchName: "feature/local-work",
          currentBranchMatchesRunBranch: false,
          localRunBranchExists: true,
          remoteBranchExists: true,
          remoteBranchMatchesReusableCommit: true,
          reusableCommitShaPrefix: "eac138f12345",
          canResume: true,
        },
      },
      requests: [
        {
          id: "pr-1",
          status: "failed",
          readinessStatus: "passed",
          branchName: "engineer/test-run",
          baseBranch: "main",
          commitShaPrefix: null,
          prUrl: null,
          prNumber: null,
          errorMessage: "gh pr create failed",
        },
      ],
    });

    expect(state.commit.label).toBe("Existing commit will be reused");
    expect(state.branch.label).toBe("Branch already pushed");
    expect(state.nextAction.label).toBe("Retry draft PR creation");
    expect(state.retryGuidance?.lastFailedStep).toBe("Create draft PR");
  });

  it("PR state card shows existing PR detection", () => {
    const state = derivePrStateCardState({
      readiness: {
        status: "passed",
        blockers: [],
        warnings: [],
        recommendedAction: "Ready to resume PR creation by reusing the existing PR record.",
        signals: {
          branchName: "engineer/test-run",
          existingPrUrl: "https://github.com/org/repo/pull/77",
          existingPrNumber: "77",
        },
      },
      requests: [
        {
          id: "pr-1",
          status: "pr_created",
          readinessStatus: "passed",
          branchName: "engineer/test-run",
          baseBranch: "main",
          commitShaPrefix: "eac138f12345",
          prUrl: "https://github.com/org/repo/pull/77",
          prNumber: "77",
          errorMessage: null,
        },
      ],
    });
    const html = renderToStaticMarkup(React.createElement(PrStateCard, { state }));

    expect(html).toContain("Existing PR detected");
    expect(html).toContain("https://github.com/org/repo/pull/77");
  });

  it("PR state card shows manual recovery when clean tree has no reusable commit", () => {
    const state = derivePrStateCardState({
      readiness: {
        status: "blocked",
        blockers: [
          "No changed files detected for commit and no reusable run commit is recorded. Recovery required before retrying PR creation.",
        ],
        warnings: [],
        recommendedAction: "Resolve blockers before creating a PR.",
        signals: {
          branchName: "engineer/test-run",
          manualRecoveryRequired: true,
          manualRecoveryReason:
            "No changed files are available to commit and no reusable run commit could be found. Restore the approved changes or resume from the existing run branch/commit before retrying PR creation.",
        },
      },
      requests: [
        {
          id: "pr-1",
          status: "failed",
          readinessStatus: "blocked",
          branchName: "engineer/test-run",
          baseBranch: "main",
          commitShaPrefix: null,
          prUrl: null,
          prNumber: null,
          errorMessage:
            "No changed files are available to commit and no reusable run commit is recorded. Recovery required: restore the approved changes or resume from the existing run branch/commit before retrying PR creation.",
        },
      ],
    });

    expect(state.commit.label).toBe("Clean tree with no reusable commit");
    expect(state.nextAction.label).toBe("Manual recovery required");
  });

  it("hard release gate checklist renders with anchor links", () => {
    const html = renderToStaticMarkup(
      React.createElement(HardReleaseGateBannerContent, {
        config: { hardGatesEnabled: true },
        evaluation: {
          enabled: true,
          action: "merge",
          status: "blocked",
          blockers: [
            "Replay verification has not been run (hard release gates).",
            "Release checklist is blocked (hard release gates).",
          ],
          blockerCount: 2,
          recommendedAction: "Resolve hard release gate blockers.",
          signals: {
            checklistStatus: "blocked",
            signoffDecision: null,
            healthPolicyStatus: null,
            policyStatus: "passed",
            replayStatus: null,
          },
        },
      }),
    );

    expect(html).toContain("Action checklist");
    expect(html).toContain("Go to Replay verification");
    expect(html).toContain("#release-checklist");
  });

  it("approve is visible when run is ready", () => {
    const summary = buildSummary();
    const state = deriveRunApprovalActionCardState(summary);

    expect(state.approvalAvailable).toBe(true);
    expect(state.showApprove).toBe(true);
    expect(state.nextRequiredAction).toBe("Approve run.");
  });

  it("request fix is visible when worker plan executed", () => {
    const summary = buildSummary({
      run: {
        id: "run-1",
        status: "failed",
        currentStep: "worker_plan_execution_failed",
        branchName: "engineer/test-run",
        riskLevel: "low",
        agentMessage: null,
      },
    });
    const state = deriveRunApprovalActionCardState(summary);

    expect(state.showRequestFix).toBe(true);
  });

  it("stop is visible when run is active or failed", () => {
    const activeState = deriveRunApprovalActionCardState(buildSummary());
    const failedState = deriveRunApprovalActionCardState(
      buildSummary({
        run: {
          id: "run-1",
          status: "failed",
          currentStep: "fix_requested",
          branchName: "engineer/test-run",
          riskLevel: "medium",
          agentMessage: null,
        },
      }),
    );

    expect(activeState.showStop).toBe(true);
    expect(failedState.showStop).toBe(true);
  });

  it("rationale requirement is shown when policy requires review", () => {
    const summary = buildSummary({
      policy: {
        exists: true,
        status: "requires_review",
        blockers: [],
        warnings: [],
        reviewRequired: ["Senior review required."],
        recommendedNextAction: "Complete review before approval.",
      },
      review: {
        stageCount: 1,
        requiredCount: 1,
        approvedCount: 1,
        pendingCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
      },
    });
    const state = deriveRunApprovalActionCardState(summary);

    expect(state.rationale.approve).toBe("required");
    expect(state.nextRequiredAction).toBe("Provide rationale and approve run.");
  });

  it("approval blocked message points to review stages when reviews pending", () => {
    const summary = buildSummary({
      policy: {
        exists: true,
        status: "requires_review",
        blockers: [],
        warnings: [],
        reviewRequired: ["Senior review required."],
        recommendedNextAction: "Complete review before approval.",
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
    const state = deriveRunApprovalActionCardState(summary);

    expect(state.primaryHref).toBe("#review-stages");
    expect(state.nextRequiredAction).toBe("Complete required review stages.");
    expect(state.blockers.some((item) => /pending/i.test(item.text))).toBe(true);
  });

  it("command center points to PR retry when retry is available", () => {
    const summary = buildSummary({
      run: {
        id: "run-1",
        status: "completed",
        currentStep: "pr_creation_failed",
        branchName: "engineer/test-run",
        riskLevel: "low",
        agentMessage: null,
      },
      approval: {
        reportAvailable: true,
        canApprove: false,
        governanceIssues: [],
        recommendedNextAction: null,
        decisionCount: 1,
        latestDecision: "approved",
      },
      pr: {
        attemptCount: 1,
        latestStatus: "failed",
        latestPrUrl: null,
        latestPrNumber: null,
        latestCommitShaPrefix: "eac138f12345",
        latestReadinessStatus: "passed",
        latestReadinessBlockers: [],
        latestReadinessWarnings: [],
        latestErrorMessage: "gh pr create failed",
      },
    });
    const guidance = deriveRunCommandCenterState(summary);

    expect(guidance.currentStageId).toBe("pr");
    expect(guidance.nextRecommendedAction).toBe("Retry draft PR creation.");
    expect(guidance.warnings.some((item) => /No duplicate commit/i.test(item.text))).toBe(true);
  });

  it("command center points to release blocker when gates block", () => {
    const summary = buildSummary({
      run: {
        id: "run-1",
        status: "completed",
        currentStep: "merge_ready",
        branchName: "engineer/test-run",
        riskLevel: "low",
        agentMessage: null,
      },
      approval: {
        reportAvailable: true,
        canApprove: false,
        governanceIssues: [],
        recommendedNextAction: null,
        decisionCount: 1,
        latestDecision: "approved",
      },
      pr: {
        attemptCount: 1,
        latestStatus: "pr_created",
        latestPrUrl: "https://github.com/org/repo/pull/77",
        latestPrNumber: "77",
        latestCommitShaPrefix: "eac138f12345",
        latestReadinessStatus: "passed",
        latestReadinessBlockers: [],
        latestReadinessWarnings: [],
        latestErrorMessage: null,
      },
      hardGates: {
        enabled: true,
        mergeStatus: "blocked",
        mergeBlockers: [
          "Required review stages are still pending (hard release gates).",
          "Release checklist is blocked (hard release gates).",
          "Replay verification has not been run (hard release gates).",
        ],
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
    expect(guidance.nextRecommendedAction).toMatch(/Go to Review stages|Go to Release checklist|Go to Replay verification/);
    expect(guidance.blockers.length).toBeLessThanOrEqual(3);
    expect(guidance.blockers.some((item) => item.href === "#review-stages")).toBe(true);
  });

  it("review stages panel explains pending, approved, and rejected states", () => {
    const summary = buildSummary({
      policy: {
        exists: true,
        status: "requires_review",
        blockers: [],
        warnings: [],
        reviewRequired: ["Senior review required."],
        recommendedNextAction: "Complete review before approval.",
      },
      review: {
        stageCount: 3,
        requiredCount: 3,
        approvedCount: 1,
        pendingCount: 1,
        rejectedCount: 1,
        skippedCount: 0,
      },
    });

    const html = renderToStaticMarkup(
      React.createElement(ReviewStagesPanel, {
        runId: "run-1",
        workflowSummary: summary,
        initialStages: [
          {
            id: "stage-pending",
            stage: "architecture_review",
            status: "pending",
            required: true,
            reason: "Large diff requires architecture review.",
            reviewerActorLabel: null,
            reviewerNotes: null,
            evidenceBundleHashPrefix: "abc123def456",
            policyResultId: "policy-1",
            policyVersion: "1.0.0",
            completedAt: null,
          },
          {
            id: "stage-approved",
            stage: "implementation_review",
            status: "approved",
            required: true,
            reason: "Implementation review required.",
            reviewerActorLabel: "admin-reviewer",
            reviewerNotes: "Approved",
            evidenceBundleHashPrefix: "abc123def456",
            policyResultId: "policy-1",
            policyVersion: "1.0.0",
            completedAt: "2026-05-25T00:00:00.000Z",
          },
          {
            id: "stage-rejected",
            stage: "risky_diff_review",
            status: "rejected",
            required: true,
            reason: "Risky diff review required.",
            reviewerActorLabel: "operator-reviewer",
            reviewerNotes: "Rejected for missing rationale",
            evidenceBundleHashPrefix: "abc123def456",
            policyResultId: "policy-1",
            policyVersion: "1.0.0",
            completedAt: "2026-05-25T00:00:00.000Z",
          },
        ],
        initialSummary: {
          requiredCount: 3,
          approvedCount: 1,
          rejectedCount: 1,
          pendingCount: 1,
          skippedCount: 0,
        },
      }),
    );

    expect(html).toContain("Complete required review stages before final run approval.");
    expect(html).toContain("Pending");
    expect(html).toContain("Approved");
    expect(html).toContain("Rejected");
    expect(html).toContain("Why review is required:");
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
