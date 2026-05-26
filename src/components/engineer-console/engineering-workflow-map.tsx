"use client";

import React from "react";
import type { WorkflowMapNode, WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";

const NODE_TONE_CLASSES: Record<WorkflowMapNode["tone"], string> = {
  ready: "border-emerald-500/35 bg-emerald-950/20 text-emerald-100",
  warning: "border-amber-500/35 bg-amber-950/20 text-amber-100",
  blocked: "border-red-500/35 bg-red-950/20 text-red-100",
  active: "border-sky-500/35 bg-sky-950/20 text-sky-100",
  inactive: "border-[var(--border)] bg-[var(--card)]/80 text-[var(--muted)]",
  completed: "border-emerald-400/30 bg-emerald-950/15 text-emerald-100",
};

function nodeToneLabel(tone: WorkflowMapNode["tone"]): string {
  switch (tone) {
    case "ready":
      return "Ready";
    case "warning":
      return "Attention";
    case "blocked":
      return "Blocked";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    default:
      return "Inactive";
  }
}

export function EngineeringWorkflowMap({
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: WorkflowMapNode[];
  selectedNodeId: WorkflowMapNodeId;
  onSelectNode: (nodeId: WorkflowMapNodeId) => void;
}) {
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_18px_50px_rgba(15,23,42,0.28)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Workflow map</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Select a node to inspect the current workflow state. The map is navigation and context
            only, so nothing here starts runs or records decisions automatically.
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Workflow flow
        </p>
      </div>

      <div className="mt-5 overflow-x-auto pb-2">
        <div className="flex min-w-[74rem] items-center gap-3 pr-2">
          {nodes.map((node, index) => {
            const selected = node.id === selectedNodeId;
            return (
              <React.Fragment key={node.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectNode(node.id)}
                  className={`relative flex h-40 w-44 shrink-0 flex-col justify-between rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent),0_16px_40px_rgba(217,119,6,0.18)]"
                      : "border-[var(--border)] bg-[var(--background)] hover:border-white/15 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{node.label}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{node.state}</p>
                    </div>
                    {node.issueCount > 0 ? (
                      <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] text-white">
                        {node.issueCount}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${NODE_TONE_CLASSES[node.tone]}`}
                    >
                      {nodeToneLabel(node.tone)}
                    </span>
                    <p className="text-sm text-white">{node.shortState}</p>
                  </div>
                </button>

                {index < nodes.length - 1 ? (
                  <div
                    aria-hidden="true"
                    className="h-px w-10 shrink-0 bg-gradient-to-r from-[var(--accent)]/40 via-[var(--border)] to-[var(--border)]"
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </section>
  );
}
