import { describe, expect, it } from "vitest";
import type { WorkflowMapNode } from "./workflow-map";
import {
  buildWorkflowCanvasEdgePath,
  buildWorkflowCanvasEdges,
  fitWorkflowCanvasView,
  getDefaultWorkflowCanvasLayout,
  getDefaultWorkflowCanvasView,
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
  it("creates a fit-to-view transform that differs from the default view", () => {
    const layout = getDefaultWorkflowCanvasLayout();
    const viewport = { width: 1280, height: 760 };
    const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height);
    const defaultView = getDefaultWorkflowCanvasView(viewport, safeArea);
    const fitView = fitWorkflowCanvasView(layout, viewport, safeArea);

    expect(fitView.zoom).toBeGreaterThanOrEqual(0.5);
    expect(fitView.zoom).toBeLessThanOrEqual(1.75);
    expect(fitView).not.toEqual(defaultView);
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

  it("restores default coordinates by rebuilding the default layout", () => {
    const defaultLayout = getDefaultWorkflowCanvasLayout();
    const movedLayout = moveWorkflowCanvasNode(defaultLayout, "review", { x: -160, y: 120 });
    const resetLayout = getDefaultWorkflowCanvasLayout();

    expect(movedLayout.review).not.toEqual(defaultLayout.review);
    expect(resetLayout.review).toEqual(defaultLayout.review);
  });
});
