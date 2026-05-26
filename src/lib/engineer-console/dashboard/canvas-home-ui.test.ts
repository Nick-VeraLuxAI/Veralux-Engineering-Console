import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasBottomDock } from "@/components/engineer-console/canvas-bottom-dock";
import { CanvasDetailDrawer } from "@/components/engineer-console/canvas-detail-drawer";
import { CanvasFloatingMenu } from "@/components/engineer-console/canvas-floating-menu";
import { CanvasIssueCard } from "@/components/engineer-console/canvas-issue-card";
import { CanvasMinimizedBar } from "@/components/engineer-console/canvas-minimized-bar";
import { CanvasNodeInspector } from "@/components/engineer-console/canvas-node-inspector";
import { CanvasTopBar } from "@/components/engineer-console/canvas-top-bar";
import { WorkflowCanvas } from "@/components/engineer-console/workflow-canvas";
import {
  createCanvasOverlayStateMap,
  minimizeCanvasOverlay,
  openCanvasOverlay,
} from "@/lib/engineer-console/dashboard/canvas-overlays";

describe("CanvasTopBar", () => {
  it("marks Architecture as the default active tab", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasTopBar, {
        activeContext: "architecture",
        issueCount: 2,
        environmentLabel: "Trusted local",
        onOpenQueue: () => undefined,
      }),
    );

    expect(html).toContain("Architecture");
    expect(html).toContain("Engineering Console");
    expect(html).toContain('data-canvas-command-bar="true"');
    expect(html).toContain("Trusted local");
    expect(html).not.toContain('data-canvas-top-tab=');
  });

  it("renders the floating menu affordance", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasFloatingMenu, {
        initiallyOpen: true,
        showSessionBar: false,
      }),
    );

    expect(html).toContain('data-canvas-menu-button="true"');
    expect(html).toContain("Home");
    expect(html).toContain("Repositories");
    expect(html).toContain("Compatibility");
  });
});

describe("WorkflowCanvas", () => {
  it("renders the spatial workflow nodes and connection lines", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowCanvas, {
        selectedNodeId: "run",
        onSelectNode: () => undefined,
        nodes: [
          { id: "setup", label: "Setup", tone: "ready", state: "Ready", shortState: "Setup ready", issueCount: 0 },
          { id: "repository", label: "Repository", tone: "warning", state: "Needs repo", shortState: "No repos", issueCount: 1 },
          { id: "task", label: "Task", tone: "inactive", state: "No task", shortState: "Create task", issueCount: 0 },
          { id: "run", label: "Run", tone: "warning", state: "Waiting approval", shortState: "Needs review", issueCount: 1 },
          { id: "review", label: "Review", tone: "warning", state: "Required", shortState: "Open review", issueCount: 1 },
          { id: "pr", label: "PR", tone: "inactive", state: "Not ready", shortState: "Await review", issueCount: 0 },
          { id: "release", label: "Release", tone: "blocked", state: "Blocked", shortState: "Needs sign-off", issueCount: 1 },
          { id: "audit", label: "Audit", tone: "active", state: "Recording", shortState: "Trace follows run", issueCount: 0 },
        ],
      }),
    );

    expect(html).toContain('data-workflow-canvas="true"');
    expect(html).toContain('data-canvas-edge="true"');
    expect(html).toContain('data-canvas-toolbar="true"');
    expect(html).toContain('data-canvas-toolbar-collapsed="false"');
    expect(html).toContain('data-canvas-toolbar-edge-tab="true"');
    expect(html).toContain('data-canvas-grid="true"');
    expect(html).toContain('data-canvas-zoom-label="true"');
    expect(html).toContain('data-canvas-focus-node="run"');
    expect(html).toContain('data-canvas-focus-glow="true"');
    expect(html).toContain('data-canvas-path-glow="true"');
    expect(html).toContain("--canvas-focus-x");
    expect(html).toContain('data-edge-tone="warning"');
    expect(html).toContain('data-edge-connected="true"');
    expect(html).toContain('data-edge-dimmed="true"');
    expect(html).toContain('data-node-selected="true"');
    expect(html).toContain('data-node-depth="selected"');
    expect(html).toContain('data-canvas-selected-node-glow="true"');
    expect(html).toContain("Audit");
    expect(html).toContain("Waiting approval");
  });
});

describe("Canvas-side surfaces", () => {
  it("renders the concise inspector, floating issue card, bottom dock, and detail drawer", () => {
    const baseOverlayStates = openCanvasOverlay(
      openCanvasOverlay(
        createCanvasOverlayStateMap({
          "node-inspector": "Run",
          "priority-issue": "Priority issue",
          "detail-drawer": "Operator queue",
        }),
        "node-inspector",
        { title: "Run" },
      ),
      "priority-issue",
      { title: "Priority issue" },
    );
    const inspectorHtml = renderToStaticMarkup(
      React.createElement(CanvasNodeInspector, {
        inspector: {
          nodeId: "run",
          title: "Run",
          state: "Waiting approval",
          whyItMatters: "Run state drives review, PR, release, and audit routing.",
          nextAction: "Review and execute the worker plan.",
          blockers: ["Worker plan still needs review."],
          warnings: [],
          primaryActionLabel: "Open run",
          primaryActionHref: "/engineer/runs/run-1",
          secondaryActionLabel: "View details",
          secondaryActionHref: "/engineer?details=queue#canvas-detail-drawer",
        },
        overlayState: baseOverlayStates["node-inspector"],
        isTopmost: true,
        onClose: () => undefined,
        onMinimize: () => undefined,
        onBringToFront: () => undefined,
        onMove: () => undefined,
      }),
    );
    const issueHtml = renderToStaticMarkup(
      React.createElement(CanvasIssueCard, {
        issue: {
          id: "issue-1",
          severity: "critical",
          title: "Release blocked",
          message: "Checklist and sign-off are incomplete.",
          destination: "Run release workspace",
          suggestedAction: "Open release.",
          href: "/engineer/runs/run-1#release-signoff",
          nodeId: "release",
          sortPriority: 10,
        },
        onOpenIssue: () => undefined,
        overlayState: baseOverlayStates["priority-issue"],
        isTopmost: false,
        subdued: true,
        onClose: () => undefined,
        onBringToFront: () => undefined,
        onMove: () => undefined,
      }),
    );
    const dockHtml = renderToStaticMarkup(
      React.createElement(CanvasBottomDock, {
        activeId: "workflow",
        links: [
          { id: "workflow", label: "Workflows", href: "/engineer" },
          { id: "repos", label: "Repos", href: "/engineer/repos" },
          { id: "tasks", label: "Tasks", href: "/engineer?details=tasks#canvas-detail-drawer" },
          { id: "docs", label: "Docs", href: "/engineer?details=docs#canvas-detail-drawer" },
        ],
      }),
    );
    const drawerHtml = renderToStaticMarkup(
      React.createElement(
        CanvasDetailDrawer,
        {
          detailPanel: "queue",
          title: "Operator queue",
          onClose: () => undefined,
          onMinimize: () => undefined,
          zIndex: 80,
          isTopmost: true,
          onBringToFront: () => undefined,
        },
        React.createElement("div", { id: "dashboard-details-queue" }, "Queue body"),
      ),
    );

    expect(inspectorHtml).toContain('data-overlay-window="node-inspector"');
    expect(inspectorHtml).toContain('data-inspector-supporting="true"');
    expect(inspectorHtml).toContain("Review and execute the worker plan.");
    expect(inspectorHtml).toContain('data-overlay-minimize="node-inspector"');
    expect(inspectorHtml).toContain('data-overlay-close="node-inspector"');
    expect(issueHtml).toContain('data-floating-issue-card="true"');
    expect(issueHtml).toContain('data-floating-issue-card-subdued="true"');
    expect(issueHtml).toContain("Release blocked");
    expect(issueHtml).toContain('data-overlay-close="priority-issue"');
    expect(dockHtml).toContain('data-canvas-bottom-dock="true"');
    expect(dockHtml).toContain("Workflows");
    expect(dockHtml).toContain("Docs");
    expect(drawerHtml).toContain('data-detail-drawer="true"');
    expect(drawerHtml).toContain("Operator queue");
    expect(drawerHtml).toContain('data-overlay-minimize="detail-drawer"');
    expect(drawerHtml).toContain('data-overlay-close="detail-drawer"');
  });

  it("renders minimized overlay pills with restore and close controls", () => {
    const minimizedStates = minimizeCanvasOverlay(
      minimizeCanvasOverlay(
        openCanvasOverlay(
          openCanvasOverlay(
            createCanvasOverlayStateMap({
              "issue-center": "Issues: 3",
              "node-inspector": "Run",
            }),
            "issue-center",
            { title: "Issues: 3" },
          ),
          "node-inspector",
          { title: "Run" },
        ),
        "issue-center",
      ),
      "node-inspector",
    );

    const html = renderToStaticMarkup(
      React.createElement(CanvasMinimizedBar, {
        overlays: [minimizedStates["issue-center"], minimizedStates["node-inspector"]],
        onRestore: () => undefined,
        onClose: () => undefined,
      }),
    );

    expect(html).toContain('data-canvas-minimized-bar="true"');
    expect(html).toContain('data-minimized-overlay="issue-center"');
    expect(html).toContain('data-minimized-overlay="node-inspector"');
    expect(html).toContain("Issues: 3");
    expect(html).toContain("Run");
  });
});
