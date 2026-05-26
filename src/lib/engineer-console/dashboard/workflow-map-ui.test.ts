import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardIssueCenter } from "@/components/engineer-console/dashboard-issue-center";
import { EngineeringWorkflowMap } from "@/components/engineer-console/engineering-workflow-map";
import { WorkflowNodeInspector } from "@/components/engineer-console/workflow-node-inspector";
import { createCanvasOverlayStateMap, openCanvasOverlay } from "@/lib/engineer-console/dashboard/canvas-overlays";

describe("EngineeringWorkflowMap", () => {
  it("renders the required workflow nodes", () => {
    const html = renderToStaticMarkup(
      React.createElement(EngineeringWorkflowMap, {
        selectedNodeId: "run",
        onSelectNode: () => undefined,
        nodes: [
          { id: "setup", label: "Setup", tone: "ready", state: "Ready", shortState: "Setup ready", issueCount: 0 },
          { id: "repository", label: "Repository", tone: "warning", state: "Needs index", shortState: "1 repo", issueCount: 1 },
          { id: "task", label: "Task", tone: "ready", state: "Created", shortState: "1 task", issueCount: 0 },
          { id: "run", label: "Run", tone: "active", state: "Waiting approval", shortState: "1 blocker", issueCount: 1 },
          { id: "review", label: "Review", tone: "warning", state: "Required", shortState: "Approval pending", issueCount: 1 },
          { id: "pr", label: "PR", tone: "inactive", state: "Not ready", shortState: "Await review", issueCount: 0 },
          { id: "release", label: "Release", tone: "inactive", state: "Not started", shortState: "Await PR", issueCount: 0 },
          { id: "audit", label: "Audit", tone: "completed", state: "Recorded", shortState: "History preserved", issueCount: 0 },
        ],
      }),
    );

    expect(html).toContain("Workflow map");
    expect(html).toContain("Setup");
    expect(html).toContain("Repository");
    expect(html).toContain("Task");
    expect(html).toContain("Run");
    expect(html).toContain("Review");
    expect(html).toContain("PR");
    expect(html).toContain("Release");
    expect(html).toContain("Audit");
  });
});

describe("WorkflowNodeInspector", () => {
  it("renders the next action and navigation links", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowNodeInspector, {
        inspector: {
          nodeId: "review",
          title: "Review",
          state: "Required",
          whyItMatters: "Review is required before approval.",
          nextAction: "Open the run and review evidence.",
          blockers: [],
          warnings: ["Evidence is still missing."],
          primaryActionLabel: "Open review",
          primaryActionHref: "/engineer/runs/run-1#approval",
          secondaryActionLabel: "View details",
          secondaryActionHref: "/engineer?details=queue#dashboard-details-queue",
        },
      }),
    );

    expect(html).toContain("Node inspector");
    expect(html).toContain("Open the run and review evidence.");
    expect(html).toContain("Open review");
  });
});

describe("DashboardIssueCenter", () => {
  it("renders the dashboard issue count", () => {
    const overlayStates = openCanvasOverlay(
      createCanvasOverlayStateMap({
        "issue-center": "Issues: 1",
      }),
      "issue-center",
      { title: "Issues: 1" },
    );
    const html = renderToStaticMarkup(
      React.createElement(DashboardIssueCenter, {
        issues: [
          {
            id: "issue-1",
            severity: "warning",
            title: "Run waiting approval",
            message: "A run is waiting for approval.",
            destination: "Run review",
            suggestedAction: "Open review.",
            href: "/engineer/runs/run-1#approval",
            nodeId: "review",
            sortPriority: 10,
          },
        ],
        onOpenIssue: () => undefined,
        overlayState: overlayStates["issue-center"],
        isTopmost: true,
        onExpand: () => undefined,
        onClose: () => undefined,
        onMinimize: () => undefined,
        onBringToFront: () => undefined,
        onMove: () => undefined,
      }),
    );

    expect(html).toContain("Issues");
    expect(html).toContain("Run waiting approval");
    expect(html).toContain("Issues: 1");
  });
});
