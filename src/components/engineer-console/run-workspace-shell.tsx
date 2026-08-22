"use client";

import React from "react";
import { StatusBadge } from "./status-badge";
import {
  RUN_WORKSPACE_VIEWS,
  getRunWorkspaceView,
  type RunWorkspaceViewId,
} from "@/lib/engineer-console/run-ux/run-workspace";
import type { RunIssue } from "@/lib/engineer-console/run-ux/run-issues";

interface RunWorkspaceShellProps {
  taskTitle: string;
  runIdShort: string;
  runStatus: string;
  currentStageLabel: string;
  riskLevel: string | null;
  blockerCount: number;
  warningCount: number;
  nextAction: string;
  activeView: RunWorkspaceViewId;
  onSelectView: (viewId: RunWorkspaceViewId) => void;
  viewIssueCounts: Partial<Record<RunWorkspaceViewId, number>>;
  currentIssue: RunIssue | null;
  onOpenCurrentIssue: () => void;
  children: React.ReactNode;
}

export function RunWorkspaceShell({
  taskTitle,
  runIdShort,
  runStatus,
  currentStageLabel,
  riskLevel,
  blockerCount,
  warningCount,
  nextAction,
  activeView,
  onSelectView,
  viewIssueCounts,
  currentIssue,
  onOpenCurrentIssue,
  children,
}: RunWorkspaceShellProps) {
  const activeWorkspace = getRunWorkspaceView(activeView);

  function handleTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    viewId: RunWorkspaceViewId,
  ) {
    const currentIndex = RUN_WORKSPACE_VIEWS.findIndex((view) => view.id === viewId);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % RUN_WORKSPACE_VIEWS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + RUN_WORKSPACE_VIEWS.length) % RUN_WORKSPACE_VIEWS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = RUN_WORKSPACE_VIEWS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextView = RUN_WORKSPACE_VIEWS[nextIndex]!;
    onSelectView(nextView.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`run-workspace-tab-${nextView.id}`)?.focus();
    });
  }

  return (
    <section
      className="relative mx-auto max-w-[72rem]"
      aria-labelledby="run-workspace-heading"
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={runStatus} />
            {riskLevel ? <StatusBadge status={riskLevel} /> : null}
            <span className="text-[12px] text-white/35">
              {currentStageLabel}
              {blockerCount > 0 ? ` · ${blockerCount} blocker${blockerCount === 1 ? "" : "s"}` : ""}
              {warningCount > 0 ? ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <div>
            <h2 className="sr-only">Run workspace</h2>
            <h2
              id="run-workspace-heading"
              className="text-[1.65rem] font-semibold tracking-tight text-white"
            >
              {taskTitle}
            </h2>
            <p className="mt-1 text-sm text-white/45">{nextAction}</p>
            <p className="sr-only">Run {runIdShort}</p>
          </div>
        </div>

        <div
          className="flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Run workspace views"
        >
          {RUN_WORKSPACE_VIEWS.map((view) => {
            const selected = activeView === view.id;
            const issueCount = viewIssueCounts[view.id] ?? 0;
            return (
              <button
                key={view.id}
                id={`run-workspace-tab-${view.id}`}
                type="button"
                role="tab"
                aria-label={view.label}
                aria-selected={selected}
                aria-controls={`run-workspace-panel-${view.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectView(view.id)}
                onKeyDown={(event) => handleTabKeyDown(event, view.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                  selected
                    ? "bg-white/10 text-white"
                    : "text-white/40 hover:text-white"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span>{view.label}</span>
                  {issueCount > 0 ? (
                    <span aria-hidden="true" className="text-[11px] text-white/50">
                      {issueCount}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="sr-only">
          Current workspace:{" "}
          <span>{activeWorkspace.label}</span>
          {currentIssue ? (
            <>
              {" "}
              <button type="button" onClick={onOpenCurrentIssue} className="text-white/55 underline-offset-2 hover:underline">
                Open issue
              </button>
            </>
          ) : null}
        </p>
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
}

export function RunWorkspaceViewPanel({
  viewId,
  activeView,
  children,
}: {
  viewId: RunWorkspaceViewId;
  activeView: RunWorkspaceViewId;
  children: React.ReactNode;
}) {
  const active = activeView === viewId;
  return (
    <section
      id={`run-workspace-panel-${viewId}`}
      role="tabpanel"
      aria-labelledby={`run-workspace-tab-${viewId}`}
      tabIndex={-1}
      hidden={!active}
      className={active ? "space-y-5" : undefined}
    >
      {children}
    </section>
  );
}
