import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunIssueCenter } from "@/components/engineer-console/run-issue-center";
import {
  RunWorkspaceShell,
  RunWorkspaceViewPanel,
} from "@/components/engineer-console/run-workspace-shell";

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
    expect(html).toContain('hidden=""');
  });
});

describe("RunIssueCenter", () => {
  it("renders active issues in the overlay", () => {
    const html = renderToStaticMarkup(
      React.createElement(RunIssueCenter, {
        initiallyExpanded: true,
        onOpenIssue: vi.fn(),
        issues: [
          {
            id: "policy-review",
            severity: "warning",
            title: "Policy requires review",
            message: "Senior review is required before approval.",
            suggestedAction: "Open review stages.",
            view: "review",
            anchorId: "review-stages",
            sortPriority: 10,
          },
        ],
      }),
    );

    expect(html).toContain("Issue Center");
    expect(html).toContain("Problems needing attention");
    expect(html).toContain("Review");
    expect(html).toContain("Suggested action: Open review stages.");
  });

  it("renders the no active issues state", () => {
    const html = renderToStaticMarkup(
      React.createElement(RunIssueCenter, {
        initiallyExpanded: true,
        onOpenIssue: vi.fn(),
        issues: [],
      }),
    );

    expect(html).toContain("All clear right now");
  });
});
