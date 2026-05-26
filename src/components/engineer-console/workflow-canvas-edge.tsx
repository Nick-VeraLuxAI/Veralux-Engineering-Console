import React from "react";
import type { WorkflowMapTone } from "@/lib/engineer-console/dashboard/workflow-map";

const EDGE_STROKE_CLASSES: Record<WorkflowMapTone, string> = {
  ready: "stroke-emerald-300/48",
  warning: "stroke-amber-300/68",
  blocked: "stroke-red-300/68",
  active: "stroke-sky-300/68",
  inactive: "stroke-slate-500/36",
  completed: "stroke-emerald-200/56",
};

export function WorkflowCanvasEdge({
  path,
  tone,
  animated,
  connected = false,
  dimmed = false,
}: {
  path: string;
  tone: WorkflowMapTone;
  animated: boolean;
  connected?: boolean;
  dimmed?: boolean;
}) {
  const emphasisFilter = connected
    ? tone === "blocked"
      ? "drop-shadow(0 0 10px rgba(248,113,113,0.2))"
      : tone === "warning"
        ? "drop-shadow(0 0 10px rgba(251,191,36,0.18))"
        : "drop-shadow(0 0 10px rgba(125,211,252,0.15))"
    : animated
      ? "drop-shadow(0 0 8px rgba(245,158,11,0.06))"
      : undefined;

  return (
    <path
      data-canvas-edge="true"
      data-edge-tone={tone}
      data-edge-connected={connected ? "true" : "false"}
      data-edge-dimmed={dimmed ? "true" : "false"}
      data-edge-emphasis={connected ? "connected" : dimmed ? "subdued" : "ambient"}
      d={path}
      fill="none"
      className={`${EDGE_STROKE_CLASSES[tone]} motion-safe:transition-[opacity,filter,stroke-width] motion-safe:duration-[220ms]`}
      strokeWidth={connected ? 2.6 : tone === "active" || tone === "warning" ? 2 : 1.55}
      strokeLinecap="round"
      strokeDasharray={tone === "inactive" ? "6 10" : undefined}
      opacity={dimmed ? 0.16 : connected ? 0.98 : tone === "inactive" ? 0.38 : 0.72}
      markerEnd="url(#workflow-edge-arrow)"
      style={
        emphasisFilter
          ? {
              filter: emphasisFilter,
              animation: animated && !connected ? "workflow-edge-pulse 2200ms ease-in-out infinite" : undefined,
            }
          : undefined
      }
    />
  );
}
