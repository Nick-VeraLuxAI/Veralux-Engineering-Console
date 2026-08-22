"use client";

import React from "react";
import type { CanvasOverlayState } from "@/lib/engineer-console/dashboard/canvas-overlays";
import type { DashboardWorkflowIssue, WorkflowMapNodeId } from "@/lib/engineer-console/dashboard/workflow-map";
import { CanvasOverlayWindow } from "./canvas-overlay-window";

const ISSUE_SEVERITY_CLASSES: Record<DashboardWorkflowIssue["severity"], string> = {
  critical: "border-red-500/28 bg-red-950/18 text-red-100",
  warning: "border-amber-500/28 bg-amber-950/18 text-amber-100",
  info: "border-blue-500/28 bg-blue-950/18 text-blue-100",
};

export function DashboardIssueCenter({
  issues,
  onOpenIssue,
  overlayState,
  isTopmost,
  onExpand,
  onClose,
  onMinimize,
  onBringToFront,
  onMove,
}: {
  issues: DashboardWorkflowIssue[];
  onOpenIssue: (issue: DashboardWorkflowIssue) => void;
  overlayState: CanvasOverlayState;
  isTopmost: boolean;
  onExpand: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onBringToFront: () => void;
  onMove: (position: { x: number; y: number }) => void;
}) {
  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const expanded = overlayState.isOpen && !overlayState.isMinimized;

  return (
    <>
      {expanded ? (
        <CanvasOverlayWindow
          overlayId="issue-center"
          title={`Issues${issues.length > 0 ? `: ${issues.length}` : ""}`}
          zIndex={overlayState.zIndex}
          isTopmost={isTopmost}
          onClose={onClose}
          onMinimize={onMinimize}
          onBringToFront={onBringToFront}
          position={overlayState.position}
          onMove={onMove}
          draggable
          placementClassName="right-4 bottom-24"
          containerClassName="w-[min(22rem,calc(100vw-2rem))]"
          surfaceClassName="flex max-h-[min(70vh,34rem)] flex-col"
          bodyClassName="overflow-y-auto p-4"
          role="dialog"
          headerSuffix={
            criticalCount > 0 ? (
              <span className="rounded-full border border-red-500/28 bg-red-950/20 px-2 py-0.5 text-[11px] text-red-100">
                {criticalCount} critical
              </span>
            ) : null
          }
        >
          <div data-issue-center-expanded="true">
            <p className="text-xs text-[var(--muted)]">
              Click an issue to open the right dashboard node, page, or run view.
            </p>

            {issues.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
                <p className="font-medium text-white">All clear right now</p>
                <p className="mt-1">
                  The current dashboard inputs do not produce any active visual workflow issues.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {issues.map((issue) => (
                  <li key={issue.id}>
                    <button
                      type="button"
                      onClick={() => onOpenIssue(issue)}
                      className="block w-full rounded-xl border border-white/8 bg-black/10 p-3 text-left transition hover:border-white/14 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ISSUE_SEVERITY_CLASSES[issue.severity]}`}
                          >
                            {issue.severity}
                          </span>
                          <span className="rounded-full border border-white/8 px-2 py-0.5 text-[11px] text-[var(--muted)]">
                            {issue.destination}
                          </span>
                        </div>
                        <span className="text-[11px] text-[var(--muted)]">
                          {issue.nodeId.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-white">{issue.title}</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">{issue.message}</p>
                      <p className="mt-2 text-xs text-white">Suggested action: {issue.suggestedAction}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CanvasOverlayWindow>
      ) : null}
    </>
  );
}

export function routeDashboardIssue(
  issue: DashboardWorkflowIssue,
  openNode: (nodeId: WorkflowMapNodeId) => void,
) {
  openNode(issue.nodeId);
  if (typeof window !== "undefined") {
    window.location.assign(issue.href);
  }
}
