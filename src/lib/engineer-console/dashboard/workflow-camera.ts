import {
  clampWorkflowCanvasZoom,
  fitWorkflowCanvasView,
  getWorkflowCanvasNodeRect,
  normalizeWorkflowCanvasView,
  type WorkflowCanvasSafeArea,
  type WorkflowCanvasSize,
  type WorkflowCanvasViewState,
} from "./workflow-canvas-layout";
import type { WorkflowMapNodeId } from "./workflow-map";

export type WorkflowCameraTarget =
  | { kind: "fit" }
  | { kind: "activity" }
  | { kind: "node"; nodeId: WorkflowMapNodeId };

export interface WorkflowCameraRequest {
  sequence: number;
  target: WorkflowCameraTarget;
  motion?: "smooth" | "instant";
}

const ACTIVITY_REGION_NODE_IDS: WorkflowMapNodeId[] = ["run", "review", "audit"];

function getNodeRegionBounds(
  layout: Record<WorkflowMapNodeId, { x: number; y: number }>,
  nodeIds: WorkflowMapNodeId[],
) {
  return nodeIds
    .map((nodeId) => getWorkflowCanvasNodeRect(layout, nodeId))
    .reduce(
      (bounds, rect) => ({
        minX: Math.min(bounds.minX, rect.x),
        minY: Math.min(bounds.minY, rect.y),
        maxX: Math.max(bounds.maxX, rect.x + rect.width),
        maxY: Math.max(bounds.maxY, rect.y + rect.height),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );
}

export function centerNodeInWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  layout: Record<WorkflowMapNodeId, { x: number; y: number }>,
  nodeId: WorkflowMapNodeId,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const rect = getWorkflowCanvasNodeRect(layout, nodeId);
  const availableCenterX = safeArea.left + (viewportSize.width - safeArea.left - safeArea.right) / 2;
  const availableCenterY = safeArea.top + (viewportSize.height - safeArea.top - safeArea.bottom) / 2;
  const nodeCenterX = rect.x + rect.width / 2;
  const nodeCenterY = rect.y + rect.height / 2;

  return normalizeWorkflowCanvasView(
    {
      x: availableCenterX - nodeCenterX * view.zoom,
      y: availableCenterY - nodeCenterY * view.zoom,
      zoom: view.zoom,
    },
    viewportSize,
  );
}

export function focusActivityRegionInWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  layout: Record<WorkflowMapNodeId, { x: number; y: number }>,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const bounds = getNodeRegionBounds(layout, ACTIVITY_REGION_NODE_IDS);
  const availableWidth = Math.max(1, viewportSize.width - safeArea.left - safeArea.right);
  const availableHeight = Math.max(1, viewportSize.height - safeArea.top - safeArea.bottom);
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fitZoom = clampWorkflowCanvasZoom(Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight));
  const zoom = clampWorkflowCanvasZoom(Math.min(view.zoom, Math.max(fitZoom, 0.88)));

  return normalizeWorkflowCanvasView(
    {
      x: safeArea.left + (availableWidth - boundsWidth * zoom) / 2 - bounds.minX * zoom,
      y: safeArea.top + (availableHeight - boundsHeight * zoom) / 2 - bounds.minY * zoom,
      zoom,
    },
    viewportSize,
  );
}

export function focusWorkflowCameraTarget(
  view: WorkflowCanvasViewState,
  target: WorkflowCameraTarget,
  layout: Record<WorkflowMapNodeId, { x: number; y: number }>,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  switch (target.kind) {
    case "fit":
      return fitWorkflowCanvasView(layout, viewportSize, safeArea);
    case "activity":
      return focusActivityRegionInWorkflowCanvasView(view, layout, viewportSize, safeArea);
    case "node":
      return centerNodeInWorkflowCanvasView(view, layout, target.nodeId, viewportSize, safeArea);
  }
}
