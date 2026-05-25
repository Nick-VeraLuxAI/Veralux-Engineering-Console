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
            ageLabel: "1h old",
            isStale: true,
            staleKind: "stale_planning",
            staleReason: "Worker-plan follow-up has been inactive for more than 24 hours.",
            staleSuggestedAction: "Open the run and review the worker plan before continuing.",
            whyItMatters: "The queue is flagging this run because follow-up may have stalled.",
            handoffNote: "Use the run page audit/history before taking over.",
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
            ageLabel: null,
            isStale: false,
            staleKind: null,
            staleReason: null,
            staleSuggestedAction: null,
            whyItMatters: "This setup item affects whether operators can safely exercise the workflow.",
            handoffNote: "Use the setup panel and runbook before taking over.",
            canStartRun: false,
            pathHint: "docs/staging-dry-run-report.md",
          },
          {
            id: "run:approval",
            kind: "run",
            title: "Approval task",
            taskId: "task-2",
            taskTitle: "Approval task",
            runId: "run-approval",
            runIdShort: "run-appr",
            repoLabel: "repo (/tmp/repo)",
            currentStageLabel: "Approval",
            nextAction: "Review approval report and take a human decision.",
            status: "waiting_for_approval",
            blockerCount: 0,
            warningCount: 0,
            href: "/engineer/runs/run-approval",
            priority: 50,
            bucket: "ready_for_approval",
            reason: "Waiting for a human approval decision.",
            sortKey: "0003",
            lastUpdatedAt: "2026-05-01T12:00:00.000Z",
            lastUpdatedLabel: "Started",
            ageLabel: "25h old",
            isStale: true,
            staleKind: "stale_approval",
            staleReason: "No operator action has been recorded for this approval in over 24 hours.",
            staleSuggestedAction: "Review policy, evidence, and the approval report before taking over.",
            whyItMatters: "Approval work needs a human decision before PR work can proceed.",
            handoffNote:
              "Use the run page audit/history before taking over. Review Current Action and Technical Audit before approving.",
            canStartRun: false,
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
    expect(html).toContain("Queue presets and density modes are read-only");
    expect(html).toContain("What happened:");
    expect(html).toContain("Takeover guidance:");
    expect(html).toContain("Stale approval");
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

  it("renders compact mode without mutating queue data", () => {
    const item = {
      id: "run:compact",
      kind: "run" as const,
      title: "Compact task",
      taskId: "task-3",
      taskTitle: "Compact task",
      runId: "run-compact",
      runIdShort: "run-comp",
      repoLabel: "repo (/tmp/repo)",
      currentStageLabel: "PR",
      nextAction: "Retry draft PR creation.",
      status: "failed",
      blockerCount: 1,
      warningCount: 0,
      href: "/engineer/runs/run-compact",
      priority: 40,
      bucket: "blocked_failed" as const,
      reason: "A draft PR retry is available.",
      sortKey: "0004",
      lastUpdatedAt: "2026-05-01T12:00:00.000Z",
      lastUpdatedLabel: "Started",
      ageLabel: "13h old",
      isStale: true,
      staleKind: "stale_failed_run" as const,
      staleReason: "This failed run has been unresolved for over 12 hours.",
      staleSuggestedAction: "Review the run before retrying.",
      whyItMatters: "Release follow-up affects downstream work.",
      handoffNote: "Review Current Action before taking over.",
      canStartRun: false,
    };

    const html = renderToStaticMarkup(
      React.createElement(OperatorQueuePanel, {
        registeredRepoCount: 1,
        taskCount: 1,
        taskCountWithoutRuns: 0,
        initialDensity: "compact",
        initialPreset: "blocked_failed",
        items: [item],
      }),
    );

    expect(html).toContain("Compact");
    expect(html).toContain("Next action: Retry draft PR creation.");
    expect(html).not.toContain("What happened:");
    expect(item.reason).toBe("A draft PR retry is available.");
  });
});
