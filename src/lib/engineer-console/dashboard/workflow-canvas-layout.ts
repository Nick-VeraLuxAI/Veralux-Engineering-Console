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
  hasChatRail?: boolean;
  chatSafeLeft?: number;
  chatSafeBottom?: number;
}

export const WORKFLOW_CANVAS_CHAT_RAIL_WIDTH = 344;
export const WORKFLOW_CANVAS_CHAT_RAIL_MIN_VIEWPORT = 768;

export type WorkflowCanvasPort = "top" | "right" | "bottom" | "left";

export type WorkflowCanvasEdgeRole = "sequence" | "record";

export interface WorkflowCanvasEdge {
  id: string;
  source: WorkflowMapNodeId;
  target: WorkflowMapNodeId;
  sourcePort: WorkflowCanvasPort;
  targetPort: WorkflowCanvasPort;
  tone: WorkflowMapTone;
  animated: boolean;
  role: WorkflowCanvasEdgeRole;
}

export interface WorkflowCanvasPhase {
  id: "prepare" | "run" | "ship";
  label: string;
  x: number;
  y: number;
}

export const WORKFLOW_CANVAS_MIN_ZOOM = 0.28;
export const WORKFLOW_CANVAS_MAX_ZOOM = 1.75;
export const WORKFLOW_CANVAS_DEFAULT_ZOOM = 1;
export const WORKFLOW_CANVAS_OVERSCROLL = 220;
export const WORKFLOW_CANVAS_WORLD_SIZE: WorkflowCanvasSize = { width: 1600, height: 1040 };
export const WORKFLOW_CANVAS_NODE_SIZE: WorkflowCanvasSize = { width: 168, height: 80 };

const DEFAULT_LAYOUT: Record<WorkflowMapNodeId, WorkflowCanvasPoint> = {
  setup: { x: 260, y: 220 },
  repository: { x: 260, y: 350 },
  task: { x: 260, y: 480 },
  run: { x: 540, y: 350 },
  review: { x: 820, y: 220 },
  pr: { x: 820, y: 350 },
  release: { x: 820, y: 480 },
  audit: { x: 540, y: 510 },
};

const WORKFLOW_CANVAS_PHASES: WorkflowCanvasPhase[] = [
  { id: "prepare", label: "Prepare", x: 260, y: 176 },
  { id: "run", label: "Run", x: 540, y: 176 },
  { id: "ship", label: "Ship", x: 820, y: 176 },
];

const EDGE_LAYOUT: Array<{
  id: string;
  source: WorkflowMapNodeId;
  target: WorkflowMapNodeId;
  sourcePort: WorkflowCanvasPort;
  targetPort: WorkflowCanvasPort;
  role: WorkflowCanvasEdgeRole;
}> = [
  { id: "setup-repository", source: "setup", target: "repository", sourcePort: "bottom", targetPort: "top", role: "sequence" },
  { id: "repository-task", source: "repository", target: "task", sourcePort: "bottom", targetPort: "top", role: "sequence" },
  { id: "task-run", source: "task", target: "run", sourcePort: "right", targetPort: "left", role: "sequence" },
  { id: "run-review", source: "run", target: "review", sourcePort: "right", targetPort: "left", role: "sequence" },
  { id: "review-pr", source: "review", target: "pr", sourcePort: "bottom", targetPort: "top", role: "sequence" },
  { id: "pr-release", source: "pr", target: "release", sourcePort: "bottom", targetPort: "top", role: "sequence" },
  { id: "run-audit", source: "run", target: "audit", sourcePort: "bottom", targetPort: "top", role: "record" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAxis(
  offset: number,
  viewportExtent: number,
  worldExtent: number,
  overscroll = WORKFLOW_CANVAS_OVERSCROLL,
  insetStart = 0,
  insetEnd = 0,
): number {
  const available = Math.max(1, viewportExtent - insetStart - insetEnd);
  if (worldExtent <= available) {
    return insetStart + (available - worldExtent) / 2;
  }

  return clamp(offset, viewportExtent - insetEnd - worldExtent - overscroll, insetStart + overscroll);
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

export function getWorkflowCanvasPhases(): WorkflowCanvasPhase[] {
  return WORKFLOW_CANVAS_PHASES.map((phase) => ({ ...phase }));
}

export function getWorkflowCanvasSafeArea(
  viewportWidth: number,
  viewportHeight: number,
  chromeOptions: WorkflowCanvasChromeOptions = {},
): WorkflowCanvasSafeArea {
  const leftToolbarPadding = chromeOptions.toolbarCollapsed ? 20 : 72;
  const dockPadding = chromeOptions.hasMinimizedBar ? 148 : 112;
  const chatRailPadding =
    viewportWidth >= WORKFLOW_CANVAS_CHAT_RAIL_MIN_VIEWPORT
      ? chromeOptions.chatSafeLeft ??
        (chromeOptions.hasChatRail ? WORKFLOW_CANVAS_CHAT_RAIL_WIDTH : 0)
      : 0;
  const chatBottom = chromeOptions.chatSafeBottom ?? 0;
  if (viewportWidth >= 1280) {
    return {
      top: 88,
      right: 28,
      bottom: Math.max(dockPadding, chatBottom),
      left: leftToolbarPadding + chatRailPadding,
    };
  }
  if (viewportWidth >= 768) {
    const tabletBottom = chromeOptions.hasMinimizedBar ? 156 : 120;
    return {
      top: 84,
      right: 24,
      bottom: Math.max(tabletBottom, chatBottom),
      left: (chromeOptions.toolbarCollapsed ? 18 : 64) + chatRailPadding,
    };
  }
  const phoneBottom = chromeOptions.hasMinimizedBar ? 168 : 128;
  return {
    top: 76,
    right: 16,
    bottom: Math.max(phoneBottom, chatBottom),
    left: chromeOptions.toolbarCollapsed ? 12 : 48,
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
  const phases = getWorkflowCanvasPhases();

  return [...rects, ...phases.map((phase) => ({ ...phase, width: WORKFLOW_CANVAS_NODE_SIZE.width, height: 24 }))].reduce(
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
  return fitWorkflowCanvasView(getDefaultWorkflowCanvasLayout(), viewportSize, safeArea);
}

export function fitWorkflowCanvasView(
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const bounds = getWorkflowCanvasBounds(layout);
  const margin = 40;
  const safeWidth = Math.max(1, viewportSize.width - safeArea.left - safeArea.right);
  const safeHeight = Math.max(1, viewportSize.height - safeArea.top - safeArea.bottom);
  const availableWidth = Math.max(1, safeWidth - margin * 2);
  const availableHeight = Math.max(1, safeHeight - margin * 2);
  const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clampWorkflowCanvasZoom(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
  );

  return {
    x: safeArea.left + (safeWidth - boundsWidth * zoom) / 2 - bounds.minX * zoom,
    y: safeArea.top + (safeHeight - boundsHeight * zoom) / 2 - bounds.minY * zoom,
    zoom,
  };
}

export function normalizeWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  viewportSize: WorkflowCanvasSize,
  safeArea?: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  const zoom = clampWorkflowCanvasZoom(view.zoom);
  const worldWidth = WORKFLOW_CANVAS_WORLD_SIZE.width * zoom;
  const worldHeight = WORKFLOW_CANVAS_WORLD_SIZE.height * zoom;

  return {
    x: normalizeAxis(view.x, viewportSize.width, worldWidth, WORKFLOW_CANVAS_OVERSCROLL, safeArea?.left ?? 0, safeArea?.right ?? 0),
    y: normalizeAxis(view.y, viewportSize.height, worldHeight, WORKFLOW_CANVAS_OVERSCROLL, safeArea?.top ?? 0, safeArea?.bottom ?? 0),
    zoom,
  };
}

export function panWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  delta: WorkflowCanvasPoint,
  viewportSize: WorkflowCanvasSize,
  safeArea?: WorkflowCanvasSafeArea,
): WorkflowCanvasViewState {
  return normalizeWorkflowCanvasView(
    {
      ...view,
      x: view.x + delta.x,
      y: view.y + delta.y,
    },
    viewportSize,
    safeArea,
  );
}

export function zoomWorkflowCanvasView(
  view: WorkflowCanvasViewState,
  nextZoom: number,
  anchorPoint: WorkflowCanvasPoint,
  viewportSize: WorkflowCanvasSize,
  safeArea?: WorkflowCanvasSafeArea,
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
    safeArea,
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

  return normalizeWorkflowCanvasView({ ...view, x: nextX, y: nextY }, viewportSize, safeArea);
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
      animated: edge.role === "sequence" && (tone === "active" || tone === "warning"),
    };
  });
}

export function areWorkflowCanvasNodesVisibleInView(
  layout: Record<WorkflowMapNodeId, WorkflowCanvasPoint>,
  view: WorkflowCanvasViewState,
  viewportSize: WorkflowCanvasSize,
  safeArea: WorkflowCanvasSafeArea,
  tolerance = 2,
): boolean {
  return (Object.keys(layout) as WorkflowMapNodeId[]).every((nodeId) => {
    const rect = getWorkflowCanvasNodeRect(layout, nodeId);
    const left = view.x + rect.x * view.zoom;
    const top = view.y + rect.y * view.zoom;
    const right = left + rect.width * view.zoom;
    const bottom = top + rect.height * view.zoom;
    return (
      left >= safeArea.left - tolerance &&
      top >= safeArea.top - tolerance &&
      right <= viewportSize.width - safeArea.right + tolerance &&
      bottom <= viewportSize.height - safeArea.bottom + tolerance
    );
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
