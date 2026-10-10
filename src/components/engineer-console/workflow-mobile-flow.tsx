"use client";

import React, { useEffect, useRef } from "react";
import type {
  WorkflowMapNode,
  WorkflowMapNodeId,
} from "@/lib/engineer-console/dashboard/workflow-map";

const MOBILE_PHASES: Array<{
  id: "prepare" | "run" | "ship";
  label: string;
  nodeIds: WorkflowMapNodeId[];
}> = [
  { id: "prepare", label: "Prepare", nodeIds: ["setup", "repository", "task"] },
  { id: "run", label: "Run", nodeIds: ["run", "audit"] },
  { id: "ship", label: "Ship", nodeIds: ["review", "pr", "release"] },
];

const TONE_CLASSES: Record<WorkflowMapNode["tone"], string> = {
  ready: "border-emerald-300/25 bg-emerald-400/[0.06]",
  warning: "border-amber-300/30 bg-amber-400/[0.07]",
  blocked: "border-red-300/35 bg-red-400/[0.08]",
  active: "border-sky-300/30 bg-sky-400/[0.07]",
  inactive: "border-white/12 bg-white/[0.035]",
  completed: "border-emerald-300/20 bg-emerald-400/[0.05]",
};

export function WorkflowMobileFlow({
  nodes,
  selectedNodeId,
  featuredIssueNodeId,
  onSelectNode,
}: {
  nodes: WorkflowMapNode[];
  selectedNodeId: WorkflowMapNodeId;
  featuredIssueNodeId: WorkflowMapNodeId | null;
  onSelectNode: (nodeId: WorkflowMapNodeId, intent?: "node-click") => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedNodeId]);

  return (
    <div
      data-workflow-mobile-flow="true"
      className="absolute inset-0 z-20 overflow-y-auto overscroll-contain px-4 py-4 md:hidden"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mx-auto max-w-sm space-y-2 pb-4">
        {MOBILE_PHASES.map((phase) => (
          <section key={phase.id} aria-labelledby={`mobile-workflow-phase-${phase.id}`}>
            <p
              id={`mobile-workflow-phase-${phase.id}`}
              className="px-1 text-[13px] font-medium uppercase tracking-[0.14em] text-white/60"
            >
              {phase.label}
            </p>
            <div className="mt-2 space-y-2">
              {phase.nodeIds.map((nodeId) => {
                const node = nodesById.get(nodeId);
                if (!node) return null;

                const selected = node.id === selectedNodeId;
                const attention = node.id === featuredIssueNodeId;
                const record = node.id === "audit";

                return (
                  <button
                    key={node.id}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    data-mobile-workflow-node={node.id}
                    data-node-selected={selected ? "true" : "false"}
                    data-motion-press="true"
                    aria-pressed={selected}
                    onClick={() => onSelectNode(node.id, "node-click")}
                    className={`flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      TONE_CLASSES[node.tone]
                    } ${selected ? "border-white/35 bg-white/[0.09]" : "hover:border-white/25"} ${
                      attention ? "ring-1 ring-red-300/45" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-white">
                        {node.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-white/65">
                        {node.state}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] uppercase tracking-[0.1em] text-white/60">
                      {record ? "Record" : selected ? "Current" : "Open"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
