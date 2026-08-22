"use client";

import React from "react";
import type { WorkflowMapNode, WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";
import { WORKFLOW_CANVAS_NODE_SIZE } from "@/lib/engineer-console/dashboard/workflow-canvas-layout";

function attentionTone(
  node: WorkflowMapNode,
  selected: boolean,
  attention: boolean,
): WorkflowMapNode["tone"] | "neutral" {
  if (selected || attention) return node.tone;
  return "neutral";
}

const TONE_CLASSES: Record<WorkflowMapNode["tone"] | "neutral", string> = {
  ready: "border-white/14 bg-white/[0.05]",
  warning: "border-amber-200/35 bg-amber-500/8",
  blocked: "border-red-300/40 bg-red-500/8",
  active: "border-white/16 bg-white/[0.06]",
  inactive: "border-white/8 bg-white/[0.03]",
  completed: "border-white/10 bg-white/[0.04]",
  neutral: "border-white/8 bg-white/[0.03]",
};

const DOT_CLASSES: Record<WorkflowMapNode["tone"] | "neutral", string> = {
  ready: "bg-white/45",
  warning: "bg-amber-300",
  blocked: "bg-red-300",
  active: "bg-white/70",
  inactive: "bg-white/25",
  completed: "bg-white/40",
  neutral: "bg-white/25",
};

export function WorkflowCanvasNode({
  node,
  selected,
  attention = false,
  connected,
  dimmed,
  dragging,
  style,
  className,
  onSelect,
  onPointerDown,
}: {
  node: WorkflowMapNode;
  selected: boolean;
  attention?: boolean;
  connected?: boolean;
  dimmed?: boolean;
  dragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onSelect: (nodeId: WorkflowMapNodeId) => void;
  onPointerDown?: (nodeId: WorkflowMapNodeId, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const leftValue = typeof style?.left === "number" ? Math.round(style.left) : undefined;
  const topValue = typeof style?.top === "number" ? Math.round(style.top) : undefined;
  const visualTone = attentionTone(node, selected, attention);
  const isHub = node.id === "run";

  return (
    <button
      type="button"
      data-workflow-node={node.id}
      data-node-x={leftValue}
      data-node-y={topValue}
      data-node-selected={selected ? "true" : "false"}
      data-node-connected={connected ? "true" : "false"}
      data-node-dimmed={dimmed ? "true" : "false"}
      data-node-hub={isHub ? "true" : "false"}
      data-node-depth={selected ? "selected" : connected ? "connected" : dimmed ? "subdued" : "default"}
      aria-pressed={selected}
      onPointerDown={(event) => onPointerDown?.(node.id, event)}
      onClick={() => onSelect(node.id)}
      style={{
        ...style,
        width: WORKFLOW_CANVAS_NODE_SIZE.width,
        height: WORKFLOW_CANVAS_NODE_SIZE.height,
      }}
      className={`group absolute flex flex-col justify-center rounded-[1.35rem] border px-4 text-left backdrop-blur-xl motion-safe:transition-[transform,opacity,border-color,background-color] motion-safe:duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${TONE_CLASSES[visualTone]} ${
        selected
          ? "scale-[1.04] border-white/28 bg-white/[0.08]"
          : isHub
            ? "border-white/14 bg-white/[0.05]"
            : "hover:border-white/16 hover:bg-white/[0.05]"
      } ${dimmed && !selected ? "opacity-40" : ""} ${dragging ? "cursor-grabbing" : "cursor-grab"} ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-[15px] tracking-tight text-white ${isHub ? "font-semibold" : "font-medium"}`}>
            {node.label}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-white/45">{node.state}</p>
        </div>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[visualTone]}`} />
      </div>
    </button>
  );
}
