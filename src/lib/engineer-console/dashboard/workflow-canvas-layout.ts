import type { WorkflowMapNode, WorkflowMapNodeId, WorkflowMapTone } from "./workflow-map";

export interface WorkflowCanvasPoint {
  x: number;
  y: number;
}

export interface WorkflowCanvasSize {
  width: number;
  height: number;
}

export interface WorkflowCanvasViewState extends WorkflowCanvasPoint {
  zoom: number;
}

export interface WorkflowCanvasSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WorkflowCanvasChromeOptions {
  toolbarCollapsed?: boolean;
  hasMinimizedBar?: boolean;
}

export type WorkflowCanvasPort = "top" | "right" | "bottom" | "left";

export interface WorkflowCanvasEdge {
  id: string;
  source: WorkflowMapNodeId;
  target: WorkflowMapNodeId;
  sourcePort: WorkflowCanvasPort;
  targetPort: WorkflowCanvasPort;
  tone: WorkflowMapTone;
  animated: boolean;
}

export const WORKFLOW_CANVAS_MIN_ZOOM = 0.5;
export const WORKFLOW_CANVAS_MAX_ZOOM = 1.75;
export const WORKFLOW_CANVAS_DEFAULT_ZOOM = 1;
export const WORKFLOW_CANVAS_OVERSCROLL = 220;
export const WORKFLOW_CANVAS_WORLD_SIZE: WorkflowCanvasSize = { width: 1600, height: 1040 };
export const WORKFLOW_CANVAS_NODE_SIZE: WorkflowCanvasSize = { width: 208, height: 128 };

const DEFAULT_LAYOUT: Record<WorkflowMapNodeId, WorkflowCanvasPoint> = {
  setup: { x: 120, y: 120 },
  repository: { x: 440, y: 120 },
  task: { x: 500, y: 390 },
  run: { x: 780, y: 390 },
  review: { x: 1110, y: 300 },
  pr: { x: 860, y: 650 },
  release: { x: 1160, y: 620 },
  audit: { x: 790, y: 870 },
};

const EDGE_LAYOUT: Array<{
  id: string;
  source: WorkflowMapNodeId;
  target: WorkflowMapNodeId;
  sourcePort: WorkflowCanvasPort;
  targetPort: WorkflowCanvasPort;
}> = [
  { id: "setup-repository", source: "setup", target: "repository", sourcePort: "right", targetPort: "left" },
  { id: "repository-task", source: "repository", target: "task", sourcePort: "bottom", targetPort: "top" },
  { id: "task-run", source: "task", target: "run", sourcePort: "right", targetPort: "left" },
  { id: "run-review", source: "run", target: "review", sourcePort: "right", targetPort: "left" },
  { id: "review-pr", source: "review", target: "pr", sourcePort: "bottom", targetPort: "top" },
  { id: "pr-release", source: "pr", target: "release", sourcePort: "right", targetPort: "left" },
  { id: "run-audit", source: "run", target: "audit", sourcePort: "bottom", targetPort: "top" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAxis(
  offset: number,
  viewportExtent: number,
  worldExtent: number,
  overscroll = WORKFLOW_CANVAS_OVERSCROLL,
): number {
  if (worldExtent <= viewportExtent) {
    return (viewportExtent - worldExtent) / 2;
  }

  return clamp(offset, viewportExtent - worldExtent - overscroll, overscroll);
}

function controlDistance(from: WorkflowCanvasPoint, to: WorkflowCanvasPoint): number {
  return Math.max(84, Math.min(180, Math.hypot(to.x - from.x, to.y - from.y) * 0.35));
}

function portControlPoint(
  point: WorkflowCanvasPoint,
  port: WorkflowCanvasPort,
  distance: number,
): WorkflowCanvasPoint {
  switch (port) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "right":
      return { x: point.x + distance, y: point.y };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
  }
}

function deriveEdgeTone(sourceTone: WorkflowMapTone, targetTone: WorkflowMapTone): WorkflowMapTone {
  if (targetTone === "blocked" || sourceTone === "blocked") return "blocked";
  if (targetTone === "warning" || sourceTone === "warning") return "warning";
  if (targetTone === "active" || sourceTone === "active") return "active";
  if (targetTone === "completed" || sourceTone === "completed") return "completed";
  if (targetTone === "ready" && sourceTone === "ready") return "ready";
  return "inactive";
}

export function getDefaultWorkflowCanvasLayout(): Record<WorkflowMapNodeId, WorkflowCanvasPoint> {
  return {
    setup: { ...DEFAULT_LAYOUT.setup },
    repository: { ...DEFAULT_LAYOUT.repository },
    task: { ...DEFAULT_LAYOUT.task },
    run: { ...DEFAULT_LAYOUT.run },
    review: { ...DEFAULT_LAYOUT.review },
    pr: { ...DEFAULT_LAYOUT.pr },
    release: { ...DEFAULT_LAYOUT.release },
    audit: { ...DEFAULT_LAYOUT.audit },
  };
}

export function getWorkflowCanvasSafeArea(
  viewportWidth: number,
  viewportHeight: number,
  chromeOptions: WorkflowCanvasChromeOptions = {},
): WorkflowCanvasSafeArea {
  const leftToolbarPadding = chromeOptions.toolbarCollapsed ? 64 : 132;
  const dockPadding = chromeOptions.hasMinimizedBar ? 228 : 184;
  if (viewportWidth >= 1280) {
    return { top: 150, right: 420, bottom: dockPadding, left: leftToolbarPadding };
  }
  if (viewportWidth >= 768) {
    return {
      top: 148,
      right: 104,
      bottom: chromeOptions.hasMinimizedBar ? 236 : 212,
      left: chromeOptions.toolbarCollapsed ? 44 : 84,
    };
  }
  return {
    top: Math.min(148, viewportHeight * 0.2),
    right: 28,
    bottom: chromeOptions.hasMinimizedBar ? 260 : 236,
    left: chromeOptions.toolbarCollapsed ? 24 : 64,
  };
}

export function clampWorkflowCanvasZoom(zoom: number): number {
  return clamp(zoom, WORKFLOW_CANVAS_MIN_ZOOM, WORKFLOW_CANVAS_MAX_ZOOM);
}

export function getWorkflowCanvasNodeRect(
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>,
  nodeId: WorkflowMapNodeId,
) {
  return {
    x: layout[nodeId].x,
    y: layout[nodeId].y,
    width: WORKFLOW_CANVAS_NODE_SIZE.width,
    height: WORKFLOW_CANVAS_NODE_SIZE.height,
  };
}

export function getWorkflowCanvasPortPoint(
  rect: { x: number; y: number; width: number; height: number },
  port: WorkflowCanvasPort,
): WorkflowCanvasPoint {
  switch (port) {
    case "top":
      return { x: rect.x + rect.width / 2, y: rect.y };
    case "right":
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case "bottom":
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    case "left":
      return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

export function getWorkflowCanvasBounds(layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>) {
  const rects = (Object.keys(layout) as WorkflowMapNodeId[]).map((nodeId) =>
    getWorkflowCanvasNodeRect(layout, nodeId),
  );

  return rects.reduce(
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

export function getDefaultWorkflowCanvasView(
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const bounds = getWorkflowCanvasBounds(getDefaultWorkflowCanvasLayout());
  const availableWidth = Math.max(1, viewportSize.width - safeArea.left - safeArea.right);
  const availableHeight = Math.max(1, viewportSize.height - safeArea.top - safeArea.bottom);

  return normalizeWorkflowCanvasView(
    {
      x:
        safeArea.left +
        (availableWidth - (bounds.maxX - bounds.minX) * WORKFLOW_CANVAS_DEFAULT_ZOOM) / 2 -
        bounds.minX * WORKFLOW_CANVAS_DEFAULT_ZOOM,
      y:
        safeArea.top +
        (availableHeight - (bounds.maxY - bounds.minY) * WORKFLOW_CANVAS_DEFAULT_ZOOM) / 2 -
        bounds.minY * WORKFLOW_CANVAS_DEFAULT_ZOOM,
      zoom: WORKFLOW_CANVAS_DEFAULT_ZOOM,
    },
    viewportSize,
  );
}

export function fitWorkflowCanvasView(
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const bounds = getWorkflowCanvasBounds(layout);
  const availableWidth = Math.max(1, viewportSize.width - safeArea.left - safeArea.right);
  const availableHeight = Math.max(1, viewportSize.height - safeArea.top - safeArea.bottom);
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clampWorkflowCanvasZoom(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
  );

  return normalizeWorkflowCanvasView(
    {
      x: safeArea.left + (availableWidth - boundsWidth * zoom) / 2 - bounds.minX * zoom,
      y: safeArea.top + (availableHeight - boundsHeight * zoom) / 2 - bounds.minY * zoom,
      zoom,
    },
    viewportSize,
  );
}

export function normalizeWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  viewportSize: WorkflowCanvasSize,
): WorkflowCanvasViewState {
  const zoom = clampWorkflowCanvasZoom(view.zoom);
  const worldWidth = WORKFLOW_CANVAS_WORLD_SIZE.width * zoom;
  const worldHeight = WORKFLOW_CANVAS_WORLD_SIZE.height * zoom;

  return {
    x: normalizeAxis(view.x, viewportSize.width, worldWidth),
    y: normalizeAxis(view.y, viewportSize.height, worldHeight),
    zoom,
  };
}

export function panWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  delta: WorkflowCanvasPoint,
  viewportSize: WorkflowCanvasSize,
): WorkflowCanvasViewState {
  return normalizeWorkflowCanvasView(
    {
      ...view,
      x: view.x + delta.x,
      y: view.y + delta.y,
    },
    viewportSize,
  );
}

export function zoomWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  nextZoom: number,
  anchorPoint: WorkflowCanvasPoint,
  viewportSize: WorkflowCanvasSize,
): WorkflowCanvasViewState {
  const zoom = clampWorkflowCanvasZoom(nextZoom);
  const worldX = (anchorPoint.x - view.x) / view.zoom;
  const worldY = (anchorPoint.y - view.y) / view.zoom;

  return normalizeWorkflowCanvasView(
    {
      x: anchorPoint.x - worldX * zoom,
      y: anchorPoint.y - worldY * zoom,
      zoom,
    },
    viewportSize,
  );
}

export function focusNodeInWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>,
  nodeId: WorkflowMapNodeId,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const rect = getWorkflowCanvasNodeRect(layout, nodeId);
  const margin = 24;
  const screenLeft = view.x + rect.x * view.zoom;
  const screenRight = screenLeft + rect.width * view.zoom;
  const screenTop = view.y + rect.y * view.zoom;
  const screenBottom = screenTop + rect.height * view.zoom;
  const minX = safeArea.left + margin;
  const maxX = viewportSize.width - safeArea.right - margin;
  const minY = safeArea.top + margin;
  const maxY = viewportSize.height - safeArea.bottom - margin;

  let nextX = view.x;
  let nextY = view.y;

  if (screenRight > maxX) {
    nextX -= screenRight - maxX;
  }
  if (screenLeft < minX) {
    nextX += minX - screenLeft;
  }
  if (screenBottom > maxY) {
    nextY -= screenBottom - maxY;
  }
  if (screenTop < minY) {
    nextY += minY - screenTop;
  }

  return normalizeWorkflowCanvasView({ ...view, x: nextX, y: nextY }, viewportSize);
}

export function moveWorkflowCanvasNode(
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>,
  nodeId: WorkflowMapNodeId,
  delta: WorkflowCanvasPoint,
): Record<WorkflowMapNodeId, WorkflowCanvasPoint> {
  const nextX = clamp(
    layout[nodeId].x + delta.x,
    0,
    WORKFLOW_CANVAS_WORLD_SIZE.width - WORKFLOW_CANVAS_NODE_SIZE.width,
  );
  const nextY = clamp(
    layout[nodeId].y + delta.y,
    0,
    WORKFLOW_CANVAS_WORLD_SIZE.height - WORKFLOW_CANVAS_NODE_SIZE.height,
  );

  return {
    ...layout,
    [nodeId]: { x: nextX, y: nextY },
  };
}

export function buildWorkflowCanvasEdges(nodes: WorkflowMapNode[]): WorkflowCanvasEdge[] {
  const nodesById = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<
    WorkflowMapNodeId,
    WorkflowMapNode
  >;

  return EDGE_LAYOUT.map((edge) => {
    const sourceTone = nodesById[edge.source]?.tone ?? "inactive";
    const targetTone = nodesById[edge.target]?.tone ?? "inactive";
    const tone = deriveEdgeTone(sourceTone, targetTone);

    return {
      ...edge,
      tone,
      animated: tone === "active" || tone === "warning",
    };
  });
}

export function buildWorkflowCanvasEdgePath(input: {
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>;
  edge: Pick<WorkflowCanvasEdge, "source" | "target" | "sourcePort" | "targetPort">;
}): string {
  const sourceRect = getWorkflowCanvasNodeRect(input.layout, input.edge.source);
  const targetRect = getWorkflowCanvasNodeRect(input.layout, input.edge.target);
  const from = getWorkflowCanvasPortPoint(sourceRect, input.edge.sourcePort);
  const to = getWorkflowCanvasPortPoint(targetRect, input.edge.targetPort);
  const distance = controlDistance(from, to);
  const controlStart = portControlPoint(from, input.edge.sourcePort, distance);
  const controlEnd = portControlPoint(to, input.edge.targetPort, distance);

  return `M ${from.x} ${from.y} C ${controlStart.x} ${controlStart.y}, ${controlEnd.x} ${controlEnd.y}, ${to.x} ${to.y}`;
}
