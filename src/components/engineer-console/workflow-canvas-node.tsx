"use client";

import React from "react";
import type { WorkflowMapNode, WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";

const TONE_CLASSES: Record<WorkflowMapNode["tone"], string> = {
  ready: "border-emerald-400/28 bg-emerald-500/8 shadow-[0_18px_36px_rgba(16,185,129,0.09)]",
  warning: "border-amber-400/32 bg-amber-500/8 shadow-[0_18px_36px_rgba(245,158,11,0.1)]",
  blocked: "border-red-400/32 bg-red-500/8 shadow-[0_18px_36px_rgba(239,68,68,0.1)]",
  active: "border-sky-400/32 bg-sky-500/8 shadow-[0_18px_36px_rgba(59,130,246,0.12)]",
  inactive: "border-white/8 bg-white/[0.025] shadow-[0_18px_36px_rgba(15,23,42,0.16)]",
  completed: "border-emerald-300/26 bg-emerald-500/6 shadow-[0_18px_36px_rgba(52,211,153,0.08)]",
};

const DOT_CLASSES: Record<WorkflowMapNode["tone"], string> = {
  ready: "bg-emerald-300",
  warning: "bg-amber-300",
  blocked: "bg-red-300",
  active: "bg-sky-300",
  inactive: "bg-zinc-500",
  completed: "bg-emerald-200",
};

function glyphForNode(nodeId: WorkflowMapNodeId): string {
  switch (nodeId) {
    case "setup":
      return "ST";
    case "repository":
      return "RP";
    case "task":
      return "TK";
    case "run":
      return "RN";
    case "review":
      return "RV";
    case "pr":
      return "PR";
    case "release":
      return "RL";
    case "audit":
      return "AU";
  }
}

export function WorkflowCanvasNode({
  node,
  selected,
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

  return (
    <button
      type="button"
      data-workflow-node={node.id}
      data-node-x={leftValue}
      data-node-y={topValue}
      data-node-selected={selected ? "true" : "false"}
      data-node-connected={connected ? "true" : "false"}
      data-node-dimmed={dimmed ? "true" : "false"}
      data-node-depth={selected ? "selected" : connected ? "connected" : dimmed ? "subdued" : "default"}
      aria-pressed={selected}
      onPointerDown={(event) => onPointerDown?.(node.id, event)}
      onClick={() => onSelect(node.id)}
      style={style}
      className={`group absolute flex h-32 w-52 flex-col justify-between rounded-2xl border px-4 py-3 text-left backdrop-blur motion-safe:transition-[transform,opacity,box-shadow,border-color,background-color,filter] motion-safe:duration-[220ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d] ${TONE_CLASSES[node.tone]} ${
        selected
          ? "scale-[1.02] border-white/28 bg-white/[0.07] shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_30px_72px_rgba(15,23,42,0.36)]"
          : connected
            ? "border-white/16 shadow-[0_24px_52px_rgba(15,23,42,0.24)]"
            : "hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/[0.04]"
      } ${dimmed && !selected ? "opacity-58 saturate-75" : ""} ${dragging ? "cursor-grabbing shadow-[0_32px_72px_rgba(15,23,42,0.42)]" : "cursor-grab"} ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/8 bg-black/15 text-[11px] font-semibold tracking-[0.08em] text-white">
            {glyphForNode(node.id)}
          </span>
          <div>
            <p className="text-sm font-semibold text-white">{node.label}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{node.state}</p>
          </div>
        </div>
        {node.issueCount > 0 ? (
          <span className="rounded-full border border-white/8 bg-black/15 px-2 py-0.5 text-[11px] text-white/92">
            {node.issueCount}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] text-white">{node.shortState}</p>
        </div>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASSES[node.tone]}`} />
      </div>
    </button>
  );
}
