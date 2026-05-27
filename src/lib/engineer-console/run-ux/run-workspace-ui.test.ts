import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunIssueCenter } from "@/components/engineer-console/run-issue-center";
import {
  RunWorkspaceShell,
  RunWorkspaceViewPanel,
} from "@/components/engineer-console/run-workspace-shell";
import type { RunIssueQueue } from "@/lib/engineer-console/run-ux/run-issues";

describe("RunWorkspaceShell", () => {
  it("renders workspace tabs and marks the active view", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RunWorkspaceShell,
        {
          taskTitle: "Workspace task",
          runIdShort: "abcd1234",
          runStatus: "waiting_for_approval",
          currentStageLabel: "Approval",
          riskLevel: "medium",
          blockerCount: 1,
          warningCount: 2,
          futureRequirementCount: 5,
          nextAction: "Review the approval report.",
          activeView: "overview",
          onSelectView: vi.fn(),
          viewIssueCounts: { overview: 2, review: 1 },
          currentIssue: null,
          onOpenCurrentIssue: vi.fn(),
        },
        React.createElement(
          React.Fragment,
          null,
          React.createElement(
            RunWorkspaceViewPanel,
            { viewId: "overview", activeView: "overview" },
            React.createElement("h2", null, "Overview content"),
          ),
          React.createElement(
            RunWorkspaceViewPanel,
            { viewId: "pr", activeView: "overview" },
            React.createElement("h2", null, "PR content"),
          ),
        ),
      ),
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Work Plan");
    expect(html).toContain("Review");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Overview content");
    expect(html).toContain("Current workspace:");
    expect(html).toContain(">2<");
    expect(html).toContain("future requirement");
    expect(html).toContain('hidden=""');
  });
});

const SAMPLE_QUEUE: RunIssueQueue = {
  active: [
    {
      id: "policy-review",
      kind: "policy_requires_review",
      severity: "warning",
      operatorSeverity: "warning",
      applicability: "active_now",
      lifecycleStage: "review",
      applicableFromStage: "policy",
      title: "Policy requires review",
      message: "Senior review is required before approval.",
      suggestedAction: "Open review stages.",
      view: "review",
      anchorId: "review-stages",
      sortPriority: 10,
    },
  ],
  future: [],
  historical: [],
  ordered: [],
  attention: {
    activeBlockerCount: 0,
    activeWarningCount: 1,
    activeInfoCount: 0,
    futureRequirementCount: 0,
    historicalCount: 0,
  },
};

describe("RunIssueCenter", () => {
  it("renders active issues in the overlay", () => {
    const html = renderToStaticMarkup(
      React.createElement(RunIssueCenter, {
        initiallyExpanded: true,
        onOpenIssue: vi.fn(),
        issueQueue: {
          ...SAMPLE_QUEUE,
          ordered: SAMPLE_QUEUE.active,
        },
      }),
    );

    expect(html).toContain("Issue Center");
    expect(html).toContain("Active now");
    expect(html).toContain("Policy requires review");
    expect(html).toContain("Suggested action: Open review stages.");
  });

  it("renders the no active issues state", () => {
    const html = renderToStaticMarkup(
      React.createElement(RunIssueCenter, {
        initiallyExpanded: true,
        onOpenIssue: vi.fn(),
        issueQueue: {
          active: [],
          future: [],
          historical: [],
          ordered: [],
          attention: {
            activeBlockerCount: 0,
            activeWarningCount: 0,
            activeInfoCount: 0,
            futureRequirementCount: 0,
            historicalCount: 0,
          },
        },
      }),
    );

    expect(html).toContain("All clear right now");
  });
});
