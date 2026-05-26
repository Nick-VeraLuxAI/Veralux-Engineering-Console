import { describe, expect, it } from "vitest";
import {
  bringCanvasOverlayToFront,
  closeCanvasOverlay,
  createCanvasOverlayStateMap,
  getMinimizedCanvasOverlays,
  getTopCanvasOverlay,
  minimizeCanvasOverlay,
  moveCanvasOverlay,
  openCanvasOverlay,
  restoreCanvasOverlay,
} from "./canvas-overlays";

describe("canvas-overlays", () => {
  it("opens and restores overlays above the current stack", () => {
    let states = createCanvasOverlayStateMap();
    states = openCanvasOverlay(states, "issue-center");
    states = openCanvasOverlay(states, "node-inspector");

    expect(getTopCanvasOverlay(states)?.id).toBe("node-inspector");

    states = restoreCanvasOverlay(states, "issue-center");
    expect(getTopCanvasOverlay(states)?.id).toBe("issue-center");
    expect(states["issue-center"].isMinimized).toBe(false);
  });

  it("tracks minimized overlays separately from visible overlays", () => {
    let states = createCanvasOverlayStateMap();
    states = openCanvasOverlay(states, "detail-drawer");
    states = minimizeCanvasOverlay(states, "detail-drawer");

    expect(getMinimizedCanvasOverlays(states).map((overlay) => overlay.id)).toEqual(["detail-drawer"]);
    expect(getTopCanvasOverlay(states)).toBeNull();

    states = closeCanvasOverlay(states, "detail-drawer");
    expect(getMinimizedCanvasOverlays(states)).toHaveLength(0);
  });

  it("moves overlays and preserves local position", () => {
    let states = createCanvasOverlayStateMap();
    states = openCanvasOverlay(states, "priority-issue");
    states = moveCanvasOverlay(states, "priority-issue", { x: 160, y: 120 });

    expect(states["priority-issue"].position).toEqual({ x: 160, y: 120 });
  });

  it("brings clicked overlays to front deterministically", () => {
    let states = createCanvasOverlayStateMap();
    states = openCanvasOverlay(states, "priority-issue");
    states = openCanvasOverlay(states, "issue-center");
    states = bringCanvasOverlayToFront(states, "priority-issue");

    expect(getTopCanvasOverlay(states)?.id).toBe("priority-issue");
  });
});
