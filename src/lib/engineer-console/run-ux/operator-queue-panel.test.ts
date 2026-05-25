import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatorQueuePanel } from "@/components/engineer-console/operator-queue-panel";

describe("OperatorQueuePanel", () => {
  it("renders grouped queue sections and direct run links", () => {
    const html = renderToStaticMarkup(
      React.createElement(OperatorQueuePanel, {
        registeredRepoCount: 1,
        taskCount: 2,
        taskCountWithoutRuns: 0,
        items: [
          {
            id: "run:needs-action",
            kind: "run",
            title: "Queue test task",
            taskId: "task-1",
            taskTitle: "Queue test task",
            runId: "run-12345678",
            runIdShort: "run-1234",
            repoLabel: "repo (/tmp/repo)",
            currentStageLabel: "Worker plan",
            nextAction: "Review and execute the worker plan.",
            status: "pending",
            blockerCount: 0,
            warningCount: 1,
            href: "/engineer/runs/run-12345678",
            priority: 60,
            bucket: "needs_action",
            reason: "The run is still in active preparation.",
            sortKey: "0001",
            lastUpdatedAt: "2026-05-01T11:00:00.000Z",
            lastUpdatedLabel: "Started",
            canStartRun: false,
          },
          {
            id: "setup:verify-ci",
            kind: "setup",
            title: "Latest verify:ci result",
            taskId: null,
            taskTitle: "Latest verify:ci result",
            runId: null,
            runIdShort: null,
            repoLabel: "Dashboard setup",
            currentStageLabel: "Setup",
            nextAction: "Track verify:ci manually in CI or the staging checklist before sign-off.",
            status: "not_checked",
            blockerCount: 0,
            warningCount: 1,
            href: "/engineer",
            priority: 40,
            bucket: "setup_attention",
            reason: "This is not tracked in the UI yet.",
            sortKey: "0002",
            lastUpdatedAt: new Date(0).toISOString(),
            lastUpdatedLabel: "Manual",
            canStartRun: false,
            pathHint: "docs/staging-dry-run-report.md",
          },
        ],
      }),
    );

    expect(html).toContain("Operator Queue");
    expect(html).toContain("Needs operator action");
    expect(html).toContain("Staging checklist / setup attention");
    expect(html).toContain('href="/engineer/runs/run-12345678"');
    expect(html).toContain("Open run");
    expect(html).toContain("docs/staging-dry-run-report.md");
    expect(html).toContain("Filters are read-only");
  });

  it("renders empty-state guidance when no repos or tasks exist", () => {
    const html = renderToStaticMarkup(
      React.createElement(OperatorQueuePanel, {
        registeredRepoCount: 0,
        taskCount: 0,
        taskCountWithoutRuns: 0,
        items: [],
      }),
    );

    expect(html).toContain("Register a repo first");
    expect(html).toContain("Open registered repositories");
  });
});
