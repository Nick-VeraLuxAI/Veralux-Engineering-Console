import { describe, expect, it } from "vitest";
import type { WorkflowMapNode } from "./workflow-map";
import { defaultMapChatFrame, mapChatBottomSafePadding } from "./map-chat-frame";
import {
  areWorkflowCanvasNodesVisibleInView,
  buildWorkflowCanvasEdgePath,
  buildWorkflowCanvasEdges,
  fitWorkflowCanvasView,
  getDefaultWorkflowCanvasLayout,
  getDefaultWorkflowCanvasView,
  getWorkflowCanvasBounds,
  getWorkflowCanvasSafeArea,
  moveWorkflowCanvasNode,
  zoomWorkflowCanvasView,
} from "./workflow-canvas-layout";

const BASE_NODES: WorkflowMapNode[] = [
  { id: "setup", label: "Setup", tone: "ready", state: "Ready", shortState: "Setup ready", issueCount: 0 },
  { id: "repository", label: "Repository", tone: "ready", state: "Registered", shortState: "Repo ready", issueCount: 0 },
  { id: "task", label: "Task", tone: "active", state: "Created", shortState: "1 task", issueCount: 0 },
  { id: "run", label: "Run", tone: "warning", state: "Waiting approval", shortState: "Needs review", issueCount: 1 },
  { id: "review", label: "Review", tone: "inactive", state: "Not ready", shortState: "Await run", issueCount: 0 },
  { id: "pr", label: "PR", tone: "inactive", state: "Not ready", shortState: "Await review", issueCount: 0 },
  { id: "release", label: "Release", tone: "blocked", state: "Blocked", shortState: "Needs sign-off", issueCount: 1 },
  { id: "audit", label: "Audit", tone: "active", state: "Recording", shortState: "Audit trail", issueCount: 0 },
];

describe("workflow-canvas-layout", () => {
  it("uses fit-to-view as the default camera so the whole map is visible", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const viewport = { width: 1280, height: 760 };
    const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height);
    const defaultView = getDefaultWorkflowCanvasView(viewport, safeArea);
    const fitView = fitWorkflowCanvasView(layout, viewport, safeArea);

    expect(fitView.zoom).toBeGreaterThanOrEqual(0.28);
    expect(fitView.zoom).toBeLessThanOrEqual(1.75);
    expect(defaultView).toEqual(fitView);
  });

  it("fits every node on a short laptop with the chat rail", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const cases = [
      { width: 1280, height: 640 },
      { width: 856, height: 640 },
      { width: 1440, height: 700 },
    ];

    for (const viewport of cases) {
      const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
        toolbarCollapsed: true,
        chatSafeLeft: 356,
      });
      const view = fitWorkflowCanvasView(layout, viewport, safeArea);
      expect(areWorkflowCanvasNodesVisibleInView(layout, view, viewport, safeArea)).toBe(true);
    }
  });

  it("centers the pipeline in the remaining safe area", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const viewport = { width: 1440, height: 900 };
    const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: true,
      chatSafeLeft: 356,
    });
    const view = fitWorkflowCanvasView(layout, viewport, safeArea);
    const bounds = getWorkflowCanvasBounds(layout);
    const midX = view.x + ((bounds.minX + bounds.maxX) / 2) * view.zoom;
    const midY = view.y + ((bounds.minY + bounds.maxY) / 2) * view.zoom;
    const safeMidX = safeArea.left + (viewport.width - safeArea.left - safeArea.right) / 2;
    const safeMidY = safeArea.top + (viewport.height - safeArea.top - safeArea.bottom) / 2;

    expect(Math.abs(midX - safeMidX)).toBeLessThan(2);
    expect(Math.abs(midY - safeMidY)).toBeLessThan(2);
    expect(areWorkflowCanvasNodesVisibleInView(layout, view, viewport, safeArea)).toBe(true);
  });

  it("zooms around an anchor point", () => {
    const viewport = { width: 1280, height: 760 };
    const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height);
    const defaultView = getDefaultWorkflowCanvasView(viewport, safeArea);
    const zoomedIn = zoomWorkflowCanvasView(defaultView, 1.25, { x: 640, y: 320 }, viewport);
    const zoomedOut = zoomWorkflowCanvasView(zoomedIn, 0.8, { x: 640, y: 320 }, viewport);

    expect(zoomedIn.zoom).toBeGreaterThan(defaultView.zoom);
    expect(zoomedOut.zoom).toBeLessThan(zoomedIn.zoom);
  });

  it("reserves the left gutter for the map chat rail on desktop", () => {
    const viewport = { width: 1280, height: 760 };
    const withoutChat = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: true,
    });
    const withChat = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: true,
      hasChatRail: true,
    });
    const phone = getWorkflowCanvasSafeArea(390, 844, {
      toolbarCollapsed: true,
      hasChatRail: true,
    });

    expect(withChat.left).toBe(withoutChat.left + 344);
    expect(
      getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
        toolbarCollapsed: true,
        chatSafeLeft: 400,
      }).left,
    ).toBe(withoutChat.left + 400);
    expect(phone.left).toBeLessThan(80);
    expect(
      getWorkflowCanvasSafeArea(390, 844, {
        toolbarCollapsed: true,
        chatSafeBottom: 400,
      }).bottom,
    ).toBeGreaterThanOrEqual(400);
  });

  it("expands the left safe area when the toolbar is open", () => {
    const viewport = { width: 1280, height: 760 };
    const collapsedSafeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: true,
    });
    const expandedSafeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: false,
    });
    const layout = getDefaultWorkflowCanvasLayout();
    const collapsedFit = fitWorkflowCanvasView(layout, viewport, collapsedSafeArea);
    const expandedFit = fitWorkflowCanvasView(layout, viewport, expandedSafeArea);

    expect(expandedSafeArea.left).toBeGreaterThan(collapsedSafeArea.left);
    expect(expandedFit.zoom).toBeLessThanOrEqual(collapsedFit.zoom);
  });

  it("moves a node locally and changes the connected edge path", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const movedLayout = moveWorkflowCanvasNode(layout, "run", { x: 110, y: 40 });
    const edges = buildWorkflowCanvasEdges(BASE_NODES);
    const taskRunEdge = edges.find((edge) => edge.id === "task-run");

    expect(taskRunEdge).toBeTruthy();
    const originalPath = buildWorkflowCanvasEdgePath({
      layout,
      edge: taskRunEdge!,
    });
    const movedPath = buildWorkflowCanvasEdgePath({
      layout: movedLayout,
      edge: taskRunEdge!,
    });

    expect(movedLayout.run.x).not.toBe(layout.run.x);
    expect(movedPath).not.toBe(originalPath);
  });

  it("derives status-aware edge tones from node states", () => {
    const edges = buildWorkflowCanvasEdges(BASE_NODES);

    expect(edges.find((edge) => edge.id === "task-run")?.tone).toBe("warning");
    expect(edges.find((edge) => edge.id === "run-audit")?.tone).toBe("warning");
    expect(edges.find((edge) => edge.id === "pr-release")?.tone).toBe("blocked");
  });

  it("connects stages in workflow order instead of a star around run", () => {
    const edges = buildWorkflowCanvasEdges(BASE_NODES);

    expect(edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "setup->repository",
      "repository->task",
      "task->run",
      "run->review",
      "review->pr",
      "pr->release",
      "run->audit",
    ]);
    expect(edges.filter((edge) => edge.role === "sequence")).toHaveLength(6);
    expect(edges.find((edge) => edge.id === "run-audit")?.role).toBe("record");
  });

  it("fits the whole pipeline on a mobile viewport", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const viewport = { width: 390, height: 844 };
    const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: true,
    });
    const view = fitWorkflowCanvasView(layout, viewport, safeArea);

    expect(view.zoom).toBeGreaterThanOrEqual(0.28);
    expect(areWorkflowCanvasNodesVisibleInView(layout, view, viewport, safeArea)).toBe(true);
  });

  it("zooms out when the tree bounds grow", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const viewport = { width: 1112, height: 900 };
    const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height, {
      toolbarCollapsed: true,
    });
    const compact = fitWorkflowCanvasView(layout, viewport, safeArea);
    const grown = moveWorkflowCanvasNode(
      moveWorkflowCanvasNode(layout, "release", { x: 240, y: 0 }),
      "setup",
      { x: -90, y: 90 },
    );
    const grownView = fitWorkflowCanvasView(grown, viewport, safeArea);

    expect(grownView.zoom).toBeLessThan(compact.zoom);
    expect(areWorkflowCanvasNodesVisibleInView(grown, grownView, viewport, safeArea)).toBe(true);
  });

  it("fits the pipeline inside a split map pane without a chat-rail inset", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const pane = { width: 1440 - 328, height: 900 };
    const safeArea = getWorkflowCanvasSafeArea(pane.width, pane.height, {
      toolbarCollapsed: true,
    });
    const view = fitWorkflowCanvasView(layout, pane, safeArea);

    expect(safeArea.left).toBeLessThan(80);
    expect(areWorkflowCanvasNodesVisibleInView(layout, view, pane, safeArea)).toBe(true);
  });

  it("fits the map above a compact phone chat sheet", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const phone = { width: 390, height: 844 };
    const short = { width: 320, height: 568 };
    const phoneSafe = getWorkflowCanvasSafeArea(phone.width, phone.height, {
      toolbarCollapsed: true,
      chatSafeBottom: mapChatBottomSafePadding(defaultMapChatFrame(phone), phone.height, phone.width),
    });
    const shortSafe = getWorkflowCanvasSafeArea(short.width, short.height, {
      toolbarCollapsed: true,
      chatSafeBottom: mapChatBottomSafePadding(defaultMapChatFrame(short), short.height, short.width),
    });

    expect(phoneSafe.bottom).toBeGreaterThan(200);
    expect(shortSafe.bottom).toBeGreaterThan(160);
    expect(areWorkflowCanvasNodesVisibleInView(layout, fitWorkflowCanvasView(layout, phone, phoneSafe), phone, phoneSafe)).toBe(
      true,
    );
    expect(areWorkflowCanvasNodesVisibleInView(layout, fitWorkflowCanvasView(layout, short, shortSafe), short, shortSafe)).toBe(
      true,
    );
  });

  it("restores default coordinates by rebuilding the default layout", () => {
    const defaultLayout = getDefaultWorkflowCanvasLayout();
    const movedLayout = moveWorkflowCanvasNode(defaultLayout, "review", { x: -160, y: 120 });
    const resetLayout = getDefaultWorkflowCanvasLayout();

    expect(movedLayout.review).not.toEqual(defaultLayout.review);
    expect(resetLayout.review).toEqual(defaultLayout.review);
  });
});
