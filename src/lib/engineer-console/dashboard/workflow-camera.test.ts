import { describe, expect, it } from "vitest";
import {
  getDefaultWorkflowCanvasLayout,
  getDefaultWorkflowCanvasView,
  getWorkflowCanvasSafeArea,
} from "./workflow-canvas-layout";
import {
  centerNodeInWorkflowCanvasView,
  focusActivityRegionInWorkflowCanvasView,
  focusWorkflowCameraTarget,
} from "./workflow-camera";

describe("workflow-camera", () => {
  const viewport = { width: 1440, height: 900 };
  const safeArea = getWorkflowCanvasSafeArea(viewport.width, viewport.height);
  const layout = getDefaultWorkflowCanvasLayout();

  it("centers a node inside the safe area while keeping zoom stable", () => {
    const view = getDefaultWorkflowCanvasView(viewport, safeArea);
    const focused = centerNodeInWorkflowCanvasView(view, layout, "repository", viewport, safeArea);

    expect(focused.zoom).toBe(view.zoom);
    expect(focused.x).not.toBe(view.x);
    expect(focused.y).not.toBe(view.y);
  });

  it("keeps the selected node left of center when the right inspector safe area is reserved", () => {
    const view = getDefaultWorkflowCanvasView(viewport, safeArea);
    const focused = centerNodeInWorkflowCanvasView(view, layout, "run", viewport, safeArea);
    const nodeCenterX = layout.run.x + 104;
    const availableCenterX = safeArea.left + (viewport.width - safeArea.left - safeArea.right) / 2;

    expect(Math.round(focused.x + nodeCenterX * focused.zoom)).toBe(Math.round(availableCenterX));
    expect(availableCenterX).toBeLessThan(viewport.width / 2);
  });

  it("focuses the activity region without jumping to full fit view", () => {
    const view = getDefaultWorkflowCanvasView(viewport, safeArea);
    const focused = focusActivityRegionInWorkflowCanvasView(view, layout, viewport, safeArea);

    expect(focused).not.toEqual(view);
    expect(focused.zoom).toBeLessThanOrEqual(view.zoom);
  });

  it("routes fit and node targets through the semantic camera helper", () => {
    const view = getDefaultWorkflowCanvasView(viewport, safeArea);
    const fitView = focusWorkflowCameraTarget(view, { kind: "fit" }, layout, viewport, safeArea);
    const taskView = focusWorkflowCameraTarget(
      view,
      { kind: "node", nodeId: "task" },
      layout,
      viewport,
      safeArea,
    );

    expect(fitView).not.toEqual(view);
    expect(taskView.zoom).toBe(view.zoom);
    expect(taskView.x).not.toBe(view.x);
  });
});
