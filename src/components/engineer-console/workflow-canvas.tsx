"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  focusWorkflowCameraTarget,
  type WorkflowCameraRequest,
} from "@/lib/engineer-console/dashboard/workflow-camera";
import { deriveWorkflowFocalPoint } from "@/lib/engineer-console/dashboard/workflow-focal-point";
import type { WorkflowMapNode, WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";
import {
  buildWorkflowCanvasEdgePath,
  buildWorkflowCanvasEdges,
  clampWorkflowCanvasZoom,
  fitWorkflowCanvasView,
  focusNodeInWorkflowCanvasView,
  getDefaultWorkflowCanvasLayout,
  getDefaultWorkflowCanvasView,
  getWorkflowCanvasSafeArea,
  moveWorkflowCanvasNode,
  panWorkflowCanvasView,
  type WorkflowCanvasPoint,
  type WorkflowCanvasSize,
  type WorkflowCanvasViewState,
  WORKFLOW_CANVAS_WORLD_SIZE,
  zoomWorkflowCanvasView,
} from "@/lib/engineer-console/dashboard/workflow-canvas-layout";
import { WorkflowCanvasEdge } from "./workflow-canvas-edge";
import { WorkflowCanvasNode } from "./workflow-canvas-node";
import { WorkflowCanvasToolbar } from "./workflow-canvas-toolbar";

const INITIAL_VIEWPORT_SIZE: WorkflowCanvasSize = { width: 1360, height: 760 };
const INITIAL_SAFE_AREA = getWorkflowCanvasSafeArea(INITIAL_VIEWPORT_SIZE.width, INITIAL_VIEWPORT_SIZE.height);
const INITIAL_VIEW = getDefaultWorkflowCanvasView(INITIAL_VIEWPORT_SIZE, INITIAL_SAFE_AREA);

type InteractionState =
  | {
      kind: "pan";
      lastClient: WorkflowCanvasPoint;
    }
  | {
      kind: "node";
      nodeId: WorkflowMapNodeId;
      lastClient: WorkflowCanvasPoint;
      moved: boolean;
    };

function centerAnchor(viewportSize: WorkflowCanvasSize): WorkflowCanvasPoint {
  return { x: viewportSize.width / 2, y: viewportSize.height / 2 };
}

function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

function pointerPoint(event: Pick<PointerEvent, "clientX" | "clientY">): WorkflowCanvasPoint {
  return { x: event.clientX, y: event.clientY };
}

function toneToRgb(tone: WorkflowMapNode["tone"]): string {
  switch (tone) {
    case "blocked":
      return "248 113 113";
    case "warning":
      return "251 191 36";
    case "active":
      return "125 211 252";
    case "ready":
    case "completed":
      return "110 231 183";
    case "inactive":
      return "148 163 184";
  }
}

function wheelAnchor(
  event: Pick<React.WheelEvent<HTMLElement>, "clientX" | "clientY">,
  element: HTMLElement,
): WorkflowCanvasPoint {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export function WorkflowCanvas({
  nodes,
  selectedNodeId,
  featuredIssueNodeId = null,
  cameraRequest,
  hasMinimizedBar = false,
  onSelectNode,
}: {
  nodes: WorkflowMapNode[];
  selectedNodeId: WorkflowMapNodeId;
  featuredIssueNodeId?: WorkflowMapNodeId | null;
  cameraRequest?: WorkflowCameraRequest | null;
  hasMinimizedBar?: boolean;
  onSelectNode: (nodeId: WorkflowMapNodeId, intent?: "node-click" | "node-pointerdown") => void;
}) {
  const containerRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);
  const suppressClickUntilRef = useRef(0);
  const motionTimeoutRef = useRef<number | null>(null);
  const viewRef = useRef<WorkflowCanvasViewState>(INITIAL_VIEW);
  const positionsRef = useRef(getDefaultWorkflowCanvasLayout());
  const initializedRef = useRef(false);
  const [viewportSize, setViewportSize] = useState<WorkflowCanvasSize>(INITIAL_VIEWPORT_SIZE);
  const [view, setView] = useState<WorkflowCanvasViewState>(INITIAL_VIEW);
  const [positions, setPositions] = useState(getDefaultWorkflowCanvasLayout);
  const [draggingNodeId, setDraggingNodeId] = useState<WorkflowMapNodeId | null>(null);
  const [layoutLocked, setLayoutLocked] = useState(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [cameraMotionEnabled, setCameraMotionEnabled] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const safeArea = useMemo(
    () =>
      getWorkflowCanvasSafeArea(viewportSize.width, viewportSize.height, {
        toolbarCollapsed,
        hasMinimizedBar,
      }),
    [hasMinimizedBar, toolbarCollapsed, viewportSize.height, viewportSize.width],
  );
  const edges = useMemo(() => buildWorkflowCanvasEdges(nodes), [nodes]);
  const connectedEdgeIds = useMemo(
    () =>
      new Set(
        edges
          .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
          .map((edge) => edge.id),
      ),
    [edges, selectedNodeId],
  );
  const connectedNodeIds = useMemo(() => {
    const nodeIds = new Set<WorkflowMapNodeId>([selectedNodeId]);
    edges.forEach((edge) => {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
      }
    });
    return nodeIds;
  }, [edges, selectedNodeId]);
  const focalPoint = useMemo(
    () =>
      deriveWorkflowFocalPoint({
        nodes,
        selectedNodeId,
        featuredIssueNodeId,
        layout: positions,
      }),
    [featuredIssueNodeId, nodes, positions, selectedNodeId],
  );
  const focusToneRgb = useMemo(() => toneToRgb(focalPoint.focalTone), [focalPoint.focalTone]);
  const pathRegion = useMemo(() => {
    const relatedNodeIds = Array.from(connectedNodeIds);
    if (relatedNodeIds.length === 0) {
      return null;
    }

    const bounds = relatedNodeIds
      .map((nodeId) => ({
        minX: positions[nodeId].x,
        minY: positions[nodeId].y,
        maxX: positions[nodeId].x + 208,
        maxY: positions[nodeId].y + 128,
      }))
      .reduce(
        (current, rect) => ({
          minX: Math.min(current.minX, rect.minX),
          minY: Math.min(current.minY, rect.minY),
          maxX: Math.max(current.maxX, rect.maxX),
          maxY: Math.max(current.maxY, rect.maxY),
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY,
        },
      );

    return {
      x: bounds.minX + (bounds.maxX - bounds.minX) / 2,
      y: bounds.minY + (bounds.maxY - bounds.minY) / 2,
    };
  }, [connectedNodeIds, positions]);
  const focalScreenPoint = useMemo(
    () => ({
      x: Math.round(view.x + focalPoint.worldCenter.x * view.zoom),
      y: Math.round(view.y + focalPoint.worldCenter.y * view.zoom),
    }),
    [focalPoint.worldCenter.x, focalPoint.worldCenter.y, view.x, view.y, view.zoom],
  );
  const pathScreenPoint = useMemo(
    () =>
      pathRegion
        ? {
            x: Math.round(view.x + pathRegion.x * view.zoom),
            y: Math.round(view.y + pathRegion.y * view.zoom),
          }
        : null,
    [pathRegion, view.x, view.y, view.zoom],
  );
  const selectedNodeGlow = useMemo(() => {
    const position = positions[focalPoint.focalNodeId];
    return {
      left: position.x + 104,
      top: position.y + 64,
    };
  }, [focalPoint.focalNodeId, positions]);
  const canvasStyle = useMemo(
    () =>
      ({
        "--canvas-focus-x": `${focalScreenPoint.x}px`,
        "--canvas-focus-y": `${focalScreenPoint.y}px`,
        "--canvas-path-x": `${pathScreenPoint?.x ?? focalScreenPoint.x}px`,
        "--canvas-path-y": `${pathScreenPoint?.y ?? focalScreenPoint.y}px`,
        "--canvas-focus-rgb": focusToneRgb,
      }) as React.CSSProperties,
    [focalScreenPoint.x, focalScreenPoint.y, focusToneRgb, pathScreenPoint?.x, pathScreenPoint?.y],
  );

  viewRef.current = view;
  positionsRef.current = positions;

  const applyViewChange = useCallback(
    (
      nextView:
        | WorkflowCanvasViewState
        | ((current: WorkflowCanvasViewState) => WorkflowCanvasViewState),
      motion: "smooth" | "instant" = "instant",
    ) => {
      const resolvedMotion = prefersReducedMotion ? "instant" : motion;
      if (motionTimeoutRef.current) {
        window.clearTimeout(motionTimeoutRef.current);
        motionTimeoutRef.current = null;
      }
      setCameraMotionEnabled(resolvedMotion === "smooth");
      setView(nextView);
      if (resolvedMotion === "smooth") {
        motionTimeoutRef.current = window.setTimeout(() => {
          setCameraMotionEnabled(false);
          motionTimeoutRef.current = null;
        }, 260);
      }
    },
    [prefersReducedMotion],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewport = () => {
      setViewportSize({
        width: Math.max(container.clientWidth, 1),
        height: Math.max(container.clientHeight, 1),
      });
    };

    updateViewport();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewport);
      return () => window.removeEventListener("resize", updateViewport);
    }

    const observer = new ResizeObserver(updateViewport);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      const defaultView = getDefaultWorkflowCanvasView(viewportSize, safeArea);
      setView(
        focusWorkflowCameraTarget(
          defaultView,
          { kind: "node", nodeId: focalPoint.focalNodeId },
          positionsRef.current,
          viewportSize,
          safeArea,
        ),
      );
      return;
    }

    setView((current) =>
      focusNodeInWorkflowCanvasView(current, positionsRef.current, selectedNodeId, viewportSize, safeArea),
    );
  }, [focalPoint.focalNodeId, safeArea, selectedNodeId, viewportSize]);

  useEffect(() => {
    if (draggingNodeId) return;
    setView((current) =>
      focusNodeInWorkflowCanvasView(current, positions, selectedNodeId, viewportSize, safeArea),
    );
  }, [draggingNodeId, positions, safeArea, selectedNodeId, viewportSize]);

  useEffect(() => {
    return () => {
      if (motionTimeoutRef.current) {
        window.clearTimeout(motionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!cameraRequest) return;
    applyViewChange(
      (current) =>
        focusWorkflowCameraTarget(current, cameraRequest.target, positionsRef.current, viewportSize, safeArea),
      cameraRequest.motion ?? "smooth",
    );
  }, [applyViewChange, cameraRequest, safeArea, viewportSize]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;

      const nextPointer = pointerPoint(event);
      const delta = {
        x: nextPointer.x - interaction.lastClient.x,
        y: nextPointer.y - interaction.lastClient.y,
      };

      if (interaction.kind === "pan") {
        setCameraMotionEnabled(false);
        setView((current) => panWorkflowCanvasView(current, delta, viewportSize));
        interaction.lastClient = nextPointer;
        return;
      }

      if (layoutLocked) {
        interaction.lastClient = nextPointer;
        return;
      }

      const worldDelta = {
        x: delta.x / viewRef.current.zoom,
        y: delta.y / viewRef.current.zoom,
      };

      if (Math.abs(delta.x) > 2 || Math.abs(delta.y) > 2) {
        interaction.moved = true;
      }

      setPositions((current) => moveWorkflowCanvasNode(current, interaction.nodeId, worldDelta));
      interaction.lastClient = nextPointer;
    };

    const handlePointerUp = () => {
      const interaction = interactionRef.current;
      if (interaction?.kind === "node" && interaction.moved) {
        suppressClickUntilRef.current = Date.now() + 120;
      }
      interactionRef.current = null;
      setDraggingNodeId(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [layoutLocked, viewportSize]);

  const handleSelectNode = (nodeId: WorkflowMapNodeId) => {
    if (Date.now() < suppressClickUntilRef.current) {
      return;
    }
    onSelectNode(nodeId, "node-click");
  };

  const handleNodePointerDown = (
    nodeId: WorkflowMapNodeId,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setCameraMotionEnabled(false);
    onSelectNode(nodeId, "node-pointerdown");
    interactionRef.current = {
      kind: "node",
      nodeId,
      lastClient: pointerPoint(event.nativeEvent),
      moved: false,
    };
    setDraggingNodeId(nodeId);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest('[data-workflow-node], [data-canvas-toolbar="true"]')) {
      return;
    }

    interactionRef.current = {
      kind: "pan",
      lastClient: pointerPoint(event.nativeEvent),
    };
  };

  const handleZoomIn = () => {
    setCameraMotionEnabled(false);
    setView((current) =>
      zoomWorkflowCanvasView(
        current,
        clampWorkflowCanvasZoom(current.zoom * 1.15),
        centerAnchor(viewportSize),
        viewportSize,
      ),
    );
  };

  const handleZoomOut = () => {
    setCameraMotionEnabled(false);
    setView((current) =>
      zoomWorkflowCanvasView(
        current,
        clampWorkflowCanvasZoom(current.zoom / 1.15),
        centerAnchor(viewportSize),
        viewportSize,
      ),
    );
  };

  const handleFitView = () => {
    applyViewChange(fitWorkflowCanvasView(positionsRef.current, viewportSize, safeArea), "smooth");
  };

  const handleResetView = () => {
    applyViewChange(getDefaultWorkflowCanvasView(viewportSize, safeArea), "smooth");
  };

  const handleResetLayout = () => {
    const nextLayout = getDefaultWorkflowCanvasLayout();
    setPositions(nextLayout);
    applyViewChange(getDefaultWorkflowCanvasView(viewportSize, safeArea), "smooth");
  };

  const worldTransform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`;

  return (
    <section
      ref={containerRef}
      className="relative h-full min-h-[32rem] overflow-hidden touch-none"
      data-workflow-canvas="true"
      data-canvas-focus-node={focalPoint.focalNodeId}
      data-canvas-focus-reason={focalPoint.focusReason}
      data-canvas-focus-tone={focalPoint.focalTone}
      aria-label="Architecture canvas"
      style={canvasStyle}
      onPointerDown={handleCanvasPointerDown}
      onWheel={(event) => {
        event.preventDefault();
        if (!containerRef.current) return;

        const anchor = wheelAnchor(event, containerRef.current);
        const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
        setCameraMotionEnabled(false);

        setView((current) =>
          zoomWorkflowCanvasView(
            current,
            clampWorkflowCanvasZoom(current.zoom * zoomFactor),
            anchor,
            viewportSize,
          ),
        );
      }}
    >
      <div className="absolute inset-0 bg-[#02050a]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_34%),linear-gradient(to_bottom_right,rgba(8,15,26,0.78),rgba(3,7,14,0.97))]" />
      <div
        aria-hidden="true"
        data-canvas-texture="true"
        className="absolute inset-0 opacity-80 motion-safe:transition-transform motion-safe:duration-200"
        style={{
          backgroundImage:
            "radial-gradient(circle_at_28%_22%,rgba(255,255,255,0.03),transparent_22%),radial-gradient(circle_at_72%_74%,rgba(148,163,184,0.06),transparent_24%),linear-gradient(to_bottom,rgba(255,255,255,0.02),rgba(255,255,255,0))",
          transform: `translate3d(${Math.round(view.x * 0.04)}px, ${Math.round(view.y * 0.04)}px, 0) scale(${1 + (view.zoom - 1) * 0.02})`,
        }}
      />
      <div
        aria-hidden="true"
        data-canvas-grid="true"
        className="absolute inset-0 opacity-45 motion-safe:transition-[background-position,opacity] motion-safe:duration-200"
        style={{
          backgroundImage:
            "radial-gradient(rgba(148,163,184,0.1) 1px, transparent 1px), radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03), rgba(255,255,255,0))",
          backgroundSize: "24px 24px, 120px 120px, 100% 100%",
          backgroundPosition: `${Math.round(view.x * 0.08)}px ${Math.round(view.y * 0.08)}px, ${Math.round(
            12 + view.x * 0.03,
          )}px ${Math.round(12 + view.y * 0.03)}px, 0 0`,
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_52%,rgba(2,6,23,0.54)_100%)]" />
      <div
        aria-hidden="true"
        data-canvas-focus-glow="true"
        className="absolute inset-0 motion-safe:transition-[background-image,opacity] motion-safe:duration-[220ms]"
        style={{
          backgroundImage:
            "radial-gradient(circle at var(--canvas-focus-x) var(--canvas-focus-y), rgb(var(--canvas-focus-rgb) / 0.22) 0%, rgb(var(--canvas-focus-rgb) / 0.12) 16%, rgb(var(--canvas-focus-rgb) / 0.05) 28%, transparent 46%)",
        }}
      />
      <div
        aria-hidden="true"
        data-canvas-path-glow="true"
        className="absolute inset-0 motion-safe:transition-[background-image,opacity] motion-safe:duration-[220ms]"
        style={{
          opacity: pathScreenPoint ? 0.65 : 0,
          backgroundImage:
            "radial-gradient(circle at var(--canvas-path-x) var(--canvas-path-y), rgb(var(--canvas-focus-rgb) / 0.08) 0%, rgb(var(--canvas-focus-rgb) / 0.04) 18%, transparent 36%)",
        }}
      />

      <div className="absolute left-0 top-24 z-30 max-w-full pl-3 lg:top-28 lg:pl-4">
        <WorkflowCanvasToolbar
          zoomLabel={zoomLabel(view.zoom)}
          layoutLocked={layoutLocked}
          collapsed={toolbarCollapsed}
          onZoomOut={handleZoomOut}
          onZoomIn={handleZoomIn}
          onFitView={handleFitView}
          onResetView={handleResetView}
          onResetLayout={handleResetLayout}
          onToggleLayoutLock={() => setLayoutLocked((current) => !current)}
          onToggleCollapsed={() => setToolbarCollapsed((current) => !current)}
        />
      </div>

      <div
        className="absolute inset-0 z-10"
        style={{
          cursor:
            interactionRef.current?.kind === "pan"
              ? "grabbing"
              : draggingNodeId
                ? "grabbing"
                : "grab",
        }}
      >
        <div
          data-canvas-world="true"
          data-canvas-zoom={view.zoom.toFixed(2)}
          data-canvas-pan-x={Math.round(view.x)}
          data-canvas-pan-y={Math.round(view.y)}
          style={{
            width: `${WORKFLOW_CANVAS_WORLD_SIZE.width}px`,
            height: `${WORKFLOW_CANVAS_WORLD_SIZE.height}px`,
            transform: worldTransform,
            transformOrigin: "0 0",
          }}
          className={`absolute left-0 top-0 will-change-transform ${
            cameraMotionEnabled && !draggingNodeId && interactionRef.current?.kind !== "pan"
              ? "motion-safe:transition-transform motion-safe:duration-[220ms] motion-safe:ease-out"
              : ""
          }`}
        >
          <style>{`@keyframes workflow-edge-pulse { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }`}</style>
          <div
            aria-hidden="true"
            data-canvas-selected-node-glow="true"
            className="pointer-events-none absolute h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl motion-safe:transition-[left,top,opacity,transform,background-image] motion-safe:duration-[220ms]"
            style={{
              left: selectedNodeGlow.left,
              top: selectedNodeGlow.top,
              backgroundImage:
                "radial-gradient(circle, rgb(var(--canvas-focus-rgb) / 0.18), rgb(var(--canvas-focus-rgb) / 0.08) 38%, transparent 68%)",
              opacity: draggingNodeId ? 0.42 : 0.9,
              transform: `translate(-50%, -50%) scale(${draggingNodeId ? 0.96 : 1.02})`,
            }}
          />
          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            width={WORKFLOW_CANVAS_WORLD_SIZE.width}
            height={WORKFLOW_CANVAS_WORLD_SIZE.height}
            viewBox={`0 0 ${WORKFLOW_CANVAS_WORLD_SIZE.width} ${WORKFLOW_CANVAS_WORLD_SIZE.height}`}
          >
            <defs>
              <marker
                id="workflow-edge-arrow"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.72)" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <WorkflowCanvasEdge
                key={edge.id}
                path={buildWorkflowCanvasEdgePath({ layout: positions, edge })}
                tone={edge.tone}
                animated={edge.animated}
                connected={connectedEdgeIds.has(edge.id)}
                dimmed={connectedEdgeIds.size > 0 && !connectedEdgeIds.has(edge.id)}
              />
            ))}
          </svg>

          {nodes.map((node) => (
            <WorkflowCanvasNode
              key={node.id}
              node={node}
              selected={node.id === selectedNodeId}
              connected={connectedNodeIds.has(node.id)}
              dimmed={connectedNodeIds.size > 0 && !connectedNodeIds.has(node.id)}
              dragging={draggingNodeId === node.id}
              style={{
                left: positions[node.id].x,
                top: positions[node.id].y,
                zIndex: draggingNodeId === node.id ? 50 : node.id === selectedNodeId ? 40 : 20,
              }}
              className="select-none touch-none"
              onSelect={handleSelectNode}
              onPointerDown={handleNodePointerDown}
            />
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute right-6 top-28 z-20 hidden rounded-full border border-white/8 bg-black/15 px-3 py-1.5 text-[10px] text-[var(--muted)] md:block">
        Drag nodes or pan empty space
      </div>
      <div className="pointer-events-none absolute bottom-6 left-6 z-20 hidden rounded-full border border-white/8 bg-black/15 px-3 py-1.5 text-[10px] text-[var(--muted)] md:block">
        Local canvas layout only
      </div>
    </section>
  );
}
