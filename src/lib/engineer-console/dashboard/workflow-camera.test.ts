import { describe, expect, it } from "vitest";
import { defaultMapChatFrame, mapChatBottomSafePadding } from "./map-chat-frame";
import {
  areWorkflowCanvasNodesVisibleInView,
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

  it("keeps the whole pipeline visible instead of cropping to a node at fit zoom", () => {
    const view = getDefaultWorkflowCanvasView(viewport, safeArea);
    const focused = centerNodeInWorkflowCanvasView(view, layout, "repository", viewport, safeArea);

    expect(focused.zoom).toBe(view.zoom);
    expect(areWorkflowCanvasNodesVisibleInView(layout, focused, viewport, safeArea)).toBe(true);
  });

  it("centers a node in the remaining safe area when already zoomed in", () => {
    const view = getDefaultWorkflowCanvasView(viewport, safeArea);
    const zoomed = { ...view, zoom: Math.min(1.75, view.zoom * 1.45) };
    const focused = centerNodeInWorkflowCanvasView(zoomed, layout, "run", viewport, safeArea);
    const nodeCenterX = layout.run.x + 84;
    const availableCenterX = safeArea.left + (viewport.width - safeArea.left - safeArea.right) / 2;

    expect(Math.round(focused.x + nodeCenterX * focused.zoom)).toBe(Math.round(availableCenterX));
    expect(availableCenterX).toBeGreaterThan(viewport.width / 2 - 40);
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

    expect(fitView).toEqual(view);
    expect(taskView.zoom).toBe(view.zoom);
    expect(areWorkflowCanvasNodesVisibleInView(layout, taskView, viewport, safeArea)).toBe(true);
  });

  it("keeps the whole map visible when centering a node over a phone chat sheet", () => {
    const phone = { width: 390, height: 844 };
    const safeArea = getWorkflowCanvasSafeArea(phone.width, phone.height, {
      toolbarCollapsed: true,
      chatSafeBottom: mapChatBottomSafePadding(defaultMapChatFrame(phone), phone.height, phone.width),
    });
    const view = getDefaultWorkflowCanvasView(phone, safeArea);
    const focused = centerNodeInWorkflowCanvasView(view, layout, "repository", phone, safeArea);

    expect(areWorkflowCanvasNodesVisibleInView(layout, focused, phone, safeArea)).toBe(true);
  });
});
