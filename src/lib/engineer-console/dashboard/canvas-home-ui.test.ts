import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanvasBottomDock } from "@/components/engineer-console/canvas-bottom-dock";
import { CanvasDetailDrawer } from "@/components/engineer-console/canvas-detail-drawer";
import { CanvasFloatingMenu } from "@/components/engineer-console/canvas-floating-menu";
import { CanvasIssueCard } from "@/components/engineer-console/canvas-issue-card";
import { CanvasMinimizedBar } from "@/components/engineer-console/canvas-minimized-bar";
import { CanvasNodeInspector } from "@/components/engineer-console/canvas-node-inspector";
import { bulkyProposalLabel } from "@/components/engineer-console/canvas-chat-workbench";
import { CanvasStageTabBar } from "@/components/engineer-console/canvas-stage-tab-bar";
import { CanvasMapChat } from "@/components/engineer-console/canvas-map-chat";
import { CommissionTaskForm } from "@/components/engineer-console/commission-task-form";
import { MultitaskFleetBoard } from "@/components/engineer-console/multitask-fleet-board";
import {
  CanvasTopBar,
  resolveCanvasWorkingRepo,
  summarizeCanvasIssues,
} from "@/components/engineer-console/canvas-top-bar";
import { RepoMapCanvas } from "@/components/engineer-console/repo-map-canvas";
import { emptyRepoControlPlane } from "@/lib/engineer-console/dashboard/repo-control-plane";
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
        onOpenIssues: () => undefined,
      }),
    );

    expect(html).toContain("Map");
    expect(html).toContain("Engineering Console");
    expect(html).toContain('data-canvas-command-bar="true"');
    expect(html).toContain("border-b");
    expect(html).not.toContain("absolute inset-x-0 top-3");
    expect(html).not.toContain("max-w-xl");
    expect(html).toContain("Trusted local");
    expect(html).toContain('data-canvas-open-issues="true"');
    expect(html).toContain("2 active workflow issues");
    expect(html).not.toContain('data-canvas-top-tab=');
    expect(html).not.toContain('data-engineer-back="true"');
  });

  it("shows a back control when the map can step out of a drill-in", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasTopBar, {
        activeContext: "repositories",
        workingRepoLabel: "PURE-POWER",
        showBack: true,
        onBack: () => undefined,
      }),
    );

    expect(html).toContain('data-engineer-back="true"');
    expect(html).toContain("Back");
  });

  it("names the working repository instead of Repositories", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasTopBar, {
        activeContext: "repositories",
        issueCount: 8,
        workingRepoLabel: "Video-Generation",
      }),
    );

    expect(html).toContain("Engineering Console");
    expect(html).toContain("Video-Generation");
    expect(html).toContain('data-canvas-working-repo="Video-Generation"');
    expect(html).not.toContain("Repositories");
    expect(resolveCanvasWorkingRepo([{ id: "a", name: "Video-Generation" }], null)?.name).toBe(
      "Video-Generation",
    );
    expect(
      resolveCanvasWorkingRepo(
        [
          { id: "a", name: "PURE-POWER" },
          { id: "b", name: "Video-Generation" },
        ],
        "b",
      )?.name,
    ).toBe("Video-Generation");
    expect(
      resolveCanvasWorkingRepo([{ id: "a", name: "PURE-POWER" }], "memory-module-id"),
    ).toBeNull();
  });

  it("uses the active context when the host repository repeats the product name", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasTopBar, {
        activeContext: "architecture",
        workingRepoLabel: "Engineering Console",
      }),
    );

    expect(html).toContain("Map");
    expect(html).toContain('data-canvas-working-repo="Engineering Console"');
    expect(html).toContain(">Map</span>");
  });

  it("summarizes issue severity for the issue launcher tooltip", () => {
    const issueSummary = summarizeCanvasIssues([
      { severity: "critical" },
      { severity: "warning" },
      { severity: "warning" },
      { severity: "info" },
    ]);
    const html = renderToStaticMarkup(
      React.createElement(CanvasTopBar, {
        activeContext: "architecture",
        issueCount: 4,
        issueSummary,
        onOpenIssues: () => undefined,
      }),
    );

    expect(issueSummary).toBe("1 critical · 2 warning · 1 info");
    expect(html).toContain('data-canvas-issue-summary="1 critical · 2 warning · 1 info"');
    expect(html).toContain("recommended actions");
    expect(summarizeCanvasIssues([])).toBe("No active workflow issues");
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
    expect(html).toContain("Start a repo");
    expect(html).toContain("Repositories");
    expect(html).toContain("Compatibility");
  });
});

describe("CanvasMapChat", () => {
  it("renders workspace tabs across the stage", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasStageTabBar, {
        tabs: [
          { id: "workflow", label: "Workflow" },
          { id: "repo", label: "PURE-POWER" },
          { id: "plan", label: "Alignment", closable: true },
        ],
        activeId: "plan",
        onSelect: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain('data-canvas-stage-tabs="true"');
    expect(html).toContain('data-canvas-surface-tab="plan"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Alignment");
    expect(html).toContain('data-canvas-stage-tab-close="plan"');
    expect(html).toContain("Close Alignment");
  });

  it("names bulky workspace cards for the chat chip", () => {
    expect(bulkyProposalLabel({ type: "start_repo", name: "Orchard", description: null })).toBe("Orchard");
    expect(bulkyProposalLabel({ type: "alignment_questionnaire", jobTitles: [], questions: [] })).toBe(
      "Alignment",
    );
  });

  it("renders a left rail with modes and Nano 30B", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasMapChat, {
        mapSummary: "Setup: Needs setup; Repository: Needs repo; Task: Needs run",
      }),
    );

    expect(html).toContain('data-canvas-map-chat="true"');
    expect(html).toContain("Chat");
    expect(html).toContain("Plan");
    expect(html).toContain("Ask");
    expect(html).toContain("Multitask");
    expect(html).toContain("Agent");
    expect(html).toContain("Nano 30B");
    expect(html).toContain("DeepSeek");
    expect(html).toContain("Auto");
    expect(html).toContain("Working on Nano 30B");
    expect(html).toContain('data-map-chat-selectors="true"');
    expect(html).toContain("No repo selected");
    expect(html).toContain("Start a repo");
    expect(html).toContain('data-map-chat-start-repo="true"');
    expect(html).toContain("Commission a task");
    expect(html).toContain('data-map-chat-commission-task="true"');
    expect(html).toMatch(/I(&#x27;|')m Vera\. I can help with whatever you(&#x27;|')re trying to build/);
    expect(html).toContain('data-map-chat-threads="true"');
    expect(html).toContain('data-map-chat-thread-list="true"');
    expect(html).not.toContain('data-map-chat-thread="thread-ssr"');
    expect(html).toContain('data-map-chat-new-thread="true"');
    expect(html).toContain('data-map-chat-drag-handle="true"');
    expect(html).toContain('data-map-chat-move="true"');
    expect(html).toContain('data-map-chat-resize="se"');
    expect(html).toContain('data-map-chat-resize="e"');
    expect(html).toContain('data-map-chat-log="true"');
    expect(html).toContain('data-map-chat-layout="overlay"');
  });

  it("renders as a docked rail that fills its slot", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasMapChat, {
        layout: "docked",
        dockSize: { width: 328, height: 320 },
        mapSummary: "Setup: Needs setup; Repository: Needs repo; Task: Needs run",
      }),
    );

    expect(html).toContain('data-map-chat-layout="docked"');
    expect(html).toContain('data-map-chat-splitter="true"');
    expect(html).toContain('data-map-chat-sheet-snap="true"');
    expect(html).toContain("Drag to resize and snap chat");
    expect(html).toContain("relative flex h-full");
    expect(html).not.toContain("absolute z-30");
    expect(html).toContain("Chat");
    expect(html).toContain("Ask");
    expect(html).toContain("Nano 30B");
  });

  it("renders a commission-task form without a repo path or start-run default", () => {
    const html = renderToStaticMarkup(
      React.createElement(CommissionTaskForm, {
        initialTitle: "Add a login gate",
        workingRepo: { id: "repo-1", name: "PURE-POWER" },
      }),
    );
    expect(html).toContain('data-commission-task-form="true"');
    expect(html).toContain("Working repo: PURE-POWER");
    expect(html).toContain("Start Autonomous Run after creating this task");
    expect(html).toContain('data-commission-task-start-run="true"');
    expect(html).not.toContain("checked");
    expect(html).not.toContain("/home/");
    expect(html).not.toContain("localhost");
    expect(html).toContain("Create task");
  });

  it("renders a multitask fleet board without paths or an auto start-run", () => {
    const html = renderToStaticMarkup(
      React.createElement(MultitaskFleetBoard, {
        workingRepo: { id: "repo-1", name: "PURE-POWER" },
        proposal: {
          type: "multitask_fleet",
          items: [
            { type: "start_repo", name: "Orchard", description: "field crews" },
            {
              type: "commission_task",
              title: "Add a login gate",
              objective: "Add a login gate",
              success: null,
              constraints: null,
              repoId: "repo-1",
            },
          ],
        },
      }),
    );
    expect(html).toContain('data-multitask-fleet-board="true"');
    expect(html).toContain('data-multitask-fleet-item="0"');
    expect(html).toContain('data-multitask-fleet-item="1"');
    expect(html).toContain("does not spawn workers");
    expect(html).toContain('data-start-repo-form="true"');
    expect(html).not.toContain('data-commission-task-form="true"');
    expect(html).toContain("Add a login gate");
    expect(html).toContain('data-multitask-fleet-commence="true"');
    expect(html).toContain("Start Autonomous Run on every job");
    expect(html).not.toContain('data-commission-task-start-run="true"');
    expect(html).not.toContain("checked");
    expect(html).not.toContain("/home/");
    expect(html).not.toContain("localhost");
  });

  it("shows real titles on compact fleet cards and disables invalid drafts", () => {
    const valid = renderToStaticMarkup(
      React.createElement(MultitaskFleetBoard, {
        workingRepo: { id: "repo-1", name: "Memory-Module" },
        proposal: {
          type: "multitask_fleet",
          items: [
            {
              type: "commission_task",
              title: "Immutable Event Log",
              objective: "Define the append-only event log.",
              success: "Events have ids",
              constraints: null,
              repoId: "repo-1",
              startRunAfterCreate: false,
            },
            {
              type: "commission_task",
              title: "Memory Record Store",
              objective: "Define memory records derived from events.",
              success: "Provenance is preserved",
              constraints: null,
              repoId: "repo-1",
              startRunAfterCreate: false,
            },
          ],
        },
      }),
    );
    expect(valid).toContain("Immutable Event Log");
    expect(valid).toContain("Memory Record Store");
    expect(valid).toContain("Define the append-only event log.");
    expect(valid).toContain("Start Autonomous Run on every job");
    expect(valid).not.toContain('data-commission-task-start-run="true"');
    expect(valid).not.toContain("checked");

    const invalid = renderToStaticMarkup(
      React.createElement(CommissionTaskForm, {
        compact: true,
        initialTitle: "Start Autonomous Run after creating this task",
        initialObjective: "",
        workingRepo: { id: "repo-1", name: "Memory-Module" },
      }),
    );
    expect(invalid).toContain("Invalid draft");
    expect(invalid).toContain("disabled");
  });

  it("renders in-chat approve controls when a run is waiting", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasMapChat, {
        mapSummary: "Run: Waiting approval",
        pendingApproval: {
          runId: "run-1",
          title: "Memory Module V0",
          href: "/engineer/runs/run-1#approval",
        },
      }),
    );
    expect(html).toContain('data-chat-approval-bar="true"');
    expect(html).toContain("Checking whether Approve is allowed");
    expect(html).not.toContain('data-chat-approval-approve="true"');
  });

  it("shows the working repository and a model selector", () => {
    const html = renderToStaticMarkup(
      React.createElement(CanvasMapChat, {
        mapSummary: "Repository: Needs analysis",
        repos: [
          { id: "a", name: "PURE-POWER" },
          { id: "b", name: "Video-Generation" },
        ],
        workingRepo: { id: "b", name: "Video-Generation" },
      }),
    );

    expect(html).toContain("Video-Generation");
    expect(html).toContain("Working on Nano 30B · Video-Generation");
    expect(html).toContain('id="map-chat-repo"');
    expect(html).toContain('id="map-chat-model"');
    expect(html).toContain('data-map-chat-select="map-chat-model"');
    expect(html).toContain("Nano 30B");
    expect(html).toContain("DeepSeek");
    expect(html).toContain("Auto");
    expect(html).not.toContain("Primary worker");
    expect(html).not.toContain("<option");
    expect(html).not.toContain("No repo selected");
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
    expect(html).toContain('data-workflow-structure="pipeline"');
    expect(html).toContain("Engineering workflow");
    expect(html).toContain("Prepare");
    expect(html).toContain("Ship");
    expect(html).toContain('data-workflow-phase="prepare"');
    expect(html).toContain('data-canvas-edge="true"');
    expect(html).toContain('data-edge-role="sequence"');
    expect(html).toContain('data-canvas-toolbar="true"');
    expect(html).toContain('data-canvas-toolbar-collapsed="true"');
    expect(html).toContain('data-canvas-toolbar-edge-tab="true"');
    expect(html).toContain('data-canvas-grid="true"');
    expect(html).toContain('data-canvas-focus-node="run"');
    expect(html).toContain('data-camera-spring="false"');
    expect(html).toContain('data-pan-inertia="false"');
    expect(html).toContain('data-canvas-focus-glow="true"');
    expect(html).toContain('data-canvas-path-glow="true"');
    expect(html).toContain("--canvas-focus-x");
    expect(html).not.toContain("data-canvas-mapped-repo");
    expect(html).toContain('data-edge-tone="warning"');
    expect(html).toContain('data-edge-connected="true"');
    expect(html).toContain('data-edge-animated=');
    expect(html).toContain('data-edge-transient="false"');
    expect(html).toContain('data-edge-dimmed="false"');
    expect(html).not.toContain('data-edge-dimmed="true"');
    expect(html).toContain('data-node-selected="true"');
    expect(html).toContain('data-node-depth="selected"');
    expect(html).toContain('data-canvas-selected-node-glow="true"');
    expect(html).toContain('data-workflow-mobile-flow="true"');
    expect(html).toContain('data-mobile-workflow-node="setup"');
    expect(html).toContain('data-mobile-workflow-node="run"');
    expect(html).toContain('data-mobile-workflow-node="release"');
    expect(html).toContain("min-h-14");
    expect(html).toContain("Audit");
    expect(html).toContain("Waiting approval");
  });

  it("renders a left-to-right repository folder map", () => {
    const html = renderToStaticMarkup(
      React.createElement(RepoMapCanvas, {
        repo: {
          id: "r1",
          name: "PURE-POWER",
          path: "/tmp/pure-power",
          language: "TypeScript",
          fileCount: 4,
          folders: ["src", "docs"],
          github: null,
          control: {
            ...emptyRepoControlPlane(),
            freshness: "current",
            freshnessLabel: "File and code index ready",
            runOverlay: {
              runId: "run-1",
              label: "Latest run · 1 files",
              href: "/engineer/runs/run-1",
              changedNodeIds: ["folder:src/lib"],
              changedCount: 1,
            },
            contracts: {
              repo: {
                nodeId: "repo",
                label: "PURE-POWER",
                fileCount: 4,
                languages: [{ language: "typescript", count: 4 }],
                exportedCount: 2,
                symbols: [
                  { name: "buildMap", kind: "function", relativePath: "src/lib/map.ts", exported: true },
                ],
                routeCount: 0,
                routes: [],
                httpClientCount: 0,
                packageDepCount: 0,
                linkWarningCount: 0,
                linkBreakingCount: 0,
                links: [],
                scripts: ["test"],
                testRunner: "vitest",
                changedCount: 1,
                changedPaths: ["src/lib/map.ts"],
                neighborNodeIds: ["folder:src"],
              },
            },
          },
          visual: {
            id: "r1",
            name: "PURE-POWER",
            language: "TypeScript",
            fileCount: 4,
            source: "index",
            folders: [
              {
                id: "folder:src",
                name: "src",
                fileCount: 3,
                kind: "source",
                moreCount: 0,
                children: [
                  {
                    id: "folder:src/lib",
                    name: "lib",
                    fileCount: 2,
                    kind: "source",
                    moreCount: 0,
                    children: [],
                  },
                ],
              },
              {
                id: "folder:docs",
                name: "docs",
                fileCount: 1,
                kind: "docs",
                moreCount: 0,
                children: [],
              },
            ],
          },
        },
      }),
    );

    expect(html).toContain('data-repo-map-canvas="true"');
    expect(html).toContain('data-repo-map-node="repo"');
    expect(html).toContain('data-repo-map-node="folder:src"');
    expect(html).toContain('data-repo-map-node="folder:src/lib"');
    expect(html).toContain("PURE-POWER");
    expect(html).toContain("Repo details");
    expect(html).toContain('data-repo-contract-card="true"');
    expect(html).toContain("File and code index ready");
    expect(html).toContain("function buildMap");
    expect(html).toContain('data-repo-map-changed="true"');
    expect(html).toContain("Who uses this");
    expect(html).not.toContain("/tmp/pure-power");
    expect(html).not.toContain("localhost");
  });

  it("still shows a contract card when no repository is mapped", () => {
    const html = renderToStaticMarkup(React.createElement(RepoMapCanvas, { repo: null }));
    expect(html).toContain('data-repo-map-empty="true"');
    expect(html).toContain('data-repo-contract-card="true"');
    expect(html).toContain("No file index");
    expect(html).toContain('data-start-repo-form="true"');
    expect(html).toContain("Start repo");
    expect(html).toContain("Register an existing path");
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
          { id: "workflow", label: "Map", href: "/engineer" },
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
    expect(inspectorHtml).toContain('data-overlay-surface="true"');
    expect(inspectorHtml).toContain('data-overlay-closing="false"');
    expect(inspectorHtml).toContain('data-inspector-supporting="true"');
    expect(inspectorHtml).toContain("Review and execute the worker plan.");
    expect(inspectorHtml).toContain('data-overlay-minimize="node-inspector"');
    expect(inspectorHtml).toContain('data-overlay-close="node-inspector"');
    expect(issueHtml).toContain('data-floating-issue-card="true"');
    expect(issueHtml).toContain('data-floating-issue-card-subdued="true"');
    expect(issueHtml).toContain("Release blocked");
    expect(issueHtml).toContain('data-overlay-close="priority-issue"');
    expect(dockHtml).toContain('data-canvas-bottom-dock="true"');
    expect(dockHtml).toContain("Map");
    expect(dockHtml).toContain("Docs");
    expect(drawerHtml).toContain('data-detail-drawer="true"');
    expect(drawerHtml).toContain('data-detail-drawer-scrim="true"');
    expect(drawerHtml).toContain('data-detail-drawer-surface="true"');
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
