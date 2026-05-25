import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrStateCard } from "@/components/engineer-console/pr-state-card";
import { derivePrStateCardState, type PrStateReadiness, type PrStateRequest } from "./pr-state-ux";

function buildReadiness(
  overrides: Partial<PrStateReadiness> & { signals?: Partial<PrStateReadiness["signals"]> } = {},
): PrStateReadiness {
  return {
    status: "passed",
    blockers: [],
    warnings: [],
    recommendedAction: "Ready to create commit and draft PR.",
    ...overrides,
    signals: {
      branchName: "engineer/test-run",
      runBranchName: "engineer/test-run",
      currentBranchName: "engineer/test-run",
      currentBranchMatchesRunBranch: true,
      localRunBranchExists: true,
      remoteBranchExists: false,
      remoteBranchMatchesReusableCommit: false,
      reusableCommitShaPrefix: null,
      reusableCommitMessage: null,
      reusableCommitSource: "none",
      canResume: false,
      resumeReason: null,
      manualRecoveryRequired: false,
      manualRecoveryReason: null,
      existingPrUrl: null,
      existingPrNumber: null,
      ...overrides.signals,
    },
  };
}

function buildFailedRequest(overrides: Partial<PrStateRequest> = {}): PrStateRequest {
  return {
    id: "pr-1",
    status: "failed",
    readinessStatus: "passed",
    branchName: "engineer/test-run",
    baseBranch: "main",
    commitShaPrefix: null,
    prUrl: null,
    prNumber: null,
    errorMessage: "gh pr create failed",
    ...overrides,
  };
}

describe("derivePrStateCardState", () => {
  it("prefers resumable readiness over the latest failed request", () => {
    const state = derivePrStateCardState({
      readiness: buildReadiness({
        status: "requires_review",
        warnings: ["Replay verification reported warnings."],
        recommendedAction: "Ready to resume PR creation using the existing run commit.",
        signals: {
          reusableCommitShaPrefix: "eac138f12345",
          reusableCommitSource: "run_branch_history",
          canResume: true,
          resumeReason: "Ready to resume PR creation using the existing run commit.",
        },
      }),
      requests: [buildFailedRequest()],
    });

    expect(state.readiness.label).toBe("Requires review");
    expect(state.commit.label).toBe("Existing commit will be reused");
    expect(state.pr.label).toBe("Draft PR can be created");
    expect(state.nextAction.label).toBe("Retry draft PR creation");
    expect(state.createButtonLabel).toBe("Retry draft PR creation");
    expect(state.retryGuidance?.lastFailedStep).toBe("Create draft PR");
  });

  it("shows branch already pushed when the remote branch matches the reusable commit", () => {
    const state = derivePrStateCardState({
      readiness: buildReadiness({
        recommendedAction:
          "Ready to resume PR creation using the existing run commit. The remote branch already matches it, so push can be skipped.",
        signals: {
          reusableCommitShaPrefix: "eac138f12345",
          reusableCommitSource: "request_history",
          canResume: true,
          remoteBranchExists: true,
          remoteBranchMatchesReusableCommit: true,
        },
      }),
      requests: [buildFailedRequest({ commitShaPrefix: "eac138f12345" })],
    });

    expect(state.branch.label).toBe("Branch already pushed");
    expect(state.branch.detail).toMatch(/Push will be skipped/i);
  });

  it("explains checkout reconciliation instead of claiming local branch only", () => {
    const state = derivePrStateCardState({
      readiness: buildReadiness({
        recommendedAction: "Ready to resume PR creation using the existing run commit.",
        signals: {
          currentBranchName: "feature/local-work",
          currentBranchMatchesRunBranch: false,
          reusableCommitShaPrefix: "eac138f12345",
          reusableCommitSource: "run_branch_history",
          canResume: true,
          remoteBranchExists: false,
        },
      }),
      requests: [buildFailedRequest()],
    });

    expect(state.branch.label).toBe("Branch needs push");
    expect(state.branch.detail).toMatch(/Retry will first checkout engineer\/test-run/i);
    expect(state.branch.label).not.toBe("Local branch only");
  });

  it("keeps existing PR detection above retry state", () => {
    const state = derivePrStateCardState({
      readiness: buildReadiness({
        recommendedAction: "Ready to resume PR creation by reusing the existing PR record.",
        signals: {
          existingPrUrl: "https://github.com/org/repo/pull/77",
          existingPrNumber: "77",
          reusableCommitShaPrefix: "eac138f12345",
          canResume: true,
        },
      }),
      requests: [
        buildFailedRequest(),
        {
          id: "pr-2",
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

    expect(state.pr.label).toBe("Existing PR detected");
    expect(state.nextAction.label).toBe("Review existing PR");
    expect(state.createButtonDisabled).toBe(true);
  });

  it("renders previous failed step as historical context only", () => {
    const state = derivePrStateCardState({
      readiness: buildReadiness({
        recommendedAction: "Ready to resume PR creation using the existing run commit.",
        signals: {
          reusableCommitShaPrefix: "eac138f12345",
          canResume: true,
          remoteBranchExists: true,
          remoteBranchMatchesReusableCommit: true,
        },
      }),
      requests: [buildFailedRequest()],
    });

    const html = renderToStaticMarkup(React.createElement(PrStateCard, { state }));

    expect(html).toContain("Previous failed step");
    expect(html).toContain("Existing commit will be reused");
    expect(html).not.toContain(">Failed<");
  });
});
