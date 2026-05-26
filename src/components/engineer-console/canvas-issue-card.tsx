"use client";

import React from "react";
import type { CanvasOverlayState } from "@/lib/engineer-console/dashboard/canvas-overlays";
import type { DashboardWorkflowIssue } from "@/lib/engineer-console/dashboard/workflow-map";
import { CanvasOverlayWindow } from "./canvas-overlay-window";

const ISSUE_CARD_CLASSES: Record<DashboardWorkflowIssue["severity"], string> = {
  critical: "border-red-400/30 bg-red-500/10 text-red-100",
  warning: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  info: "border-sky-400/30 bg-sky-500/10 text-sky-100",
};

export function CanvasIssueCard({
  issue,
  onOpenIssue,
  overlayState,
  isTopmost,
  subdued = false,
  onClose,
  onBringToFront,
  onMove,
}: {
  issue: DashboardWorkflowIssue | null;
  onOpenIssue: (issue: DashboardWorkflowIssue) => void;
  overlayState: CanvasOverlayState;
  isTopmost: boolean;
  subdued?: boolean;
  onClose: () => void;
  onBringToFront: () => void;
  onMove: (position: { x: number; y: number }) => void;
}) {
  if (!issue || !overlayState.isOpen || overlayState.isMinimized) {
    return null;
  }

  return (
    <CanvasOverlayWindow
      overlayId="priority-issue"
      title="Priority issue"
      zIndex={overlayState.zIndex}
      isTopmost={isTopmost}
      onClose={onClose}
      onBringToFront={onBringToFront}
      position={overlayState.position}
      onMove={onMove}
      draggable
      placementClassName={subdued ? "top-36 right-4" : "top-24 right-4"}
      containerClassName="w-[min(20rem,calc(100vw-2rem))]"
      bodyClassName="p-4"
      surfaceClassName={
        subdued
          ? "border-white/8 bg-[#06101a]/74 shadow-[0_18px_38px_rgba(2,6,23,0.24)]"
          : "border-white/8 bg-[#07101c]/80 shadow-[0_22px_42px_rgba(2,6,23,0.3)]"
      }
    >
      <div data-floating-issue-card="true" data-floating-issue-card-subdued={subdued ? "true" : "false"}>
        <div>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${ISSUE_CARD_CLASSES[issue.severity]}`}
          >
            {issue.severity === "critical" ? "High attention" : issue.severity === "warning" ? "Attention" : "Heads up"}
          </span>
          <h2 className="mt-3 text-sm font-semibold text-white">{issue.title}</h2>
        </div>
        <p className="mt-3 text-sm text-[var(--muted)]">{issue.message}</p>
        <p className="mt-2 text-xs text-white/90">{issue.suggestedAction}</p>
        <button
          type="button"
          onClick={() => onOpenIssue(issue)}
          className="mt-4 inline-flex items-center rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]"
        >
          {issue.nodeId === "repository"
            ? "Register repo"
            : issue.nodeId === "release"
              ? "Open release"
              : issue.nodeId === "review"
                ? "Open review"
                : "Open run"}
        </button>
      </div>
    </CanvasOverlayWindow>
  );
}
