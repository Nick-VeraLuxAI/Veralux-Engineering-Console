"use client";

import React from "react";
import { StatusBadge } from "./status-badge";
import {
  DEFAULT_RUN_WORKSPACE_VIEW,
  RUN_WORKSPACE_VIEWS,
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
  currentIssue,
  onOpenCurrentIssue,
  children,
}: RunWorkspaceShellProps) {
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
      className="relative rounded-2xl border border-[var(--border)] bg-[var(--background)]"
      aria-labelledby="run-workspace-heading"
    >
      <div className="sticky top-4 z-20 rounded-t-2xl border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h2
                id="run-workspace-heading"
                className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"
              >
                Run workspace
              </h2>
              <p className="mt-1 text-xl font-semibold text-white">
                {taskTitle}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Run {runIdShort} • focused operator workspace
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={runStatus} />
              <span className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                Stage: {currentStageLabel}
              </span>
              {riskLevel ? <StatusBadge status={riskLevel} /> : null}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Run health</p>
                <p className="mt-2 text-sm text-white">
                  {blockerCount} blocker(s), {warningCount} warning(s)
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Primary next action
                </p>
                <p className="mt-2 text-sm text-white">{nextAction}</p>
              </div>
            </div>

            <div className="flex items-start justify-end">
              <button
                type="button"
                onClick={onOpenCurrentIssue}
                className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--card)]/80"
              >
                {currentIssue
                  ? `Open issue: ${currentIssue.title}`
                  : `Open ${RUN_WORKSPACE_VIEWS.find((view) => view.id === activeView)?.label ?? "Overview"}`}
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Run workspace views">
            {RUN_WORKSPACE_VIEWS.map((view) => {
              const selected = activeView === view.id;
              return (
                <button
                  key={view.id}
                  id={`run-workspace-tab-${view.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`run-workspace-panel-${view.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelectView(view.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, view.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                      : "border-[var(--border)] text-[var(--muted)] hover:text-white"
                  }`}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {RUN_WORKSPACE_VIEWS.find((view) => view.id === activeView)?.description ??
              RUN_WORKSPACE_VIEWS.find((view) => view.id === DEFAULT_RUN_WORKSPACE_VIEW)?.description}
          </p>
        </div>
      </div>

      <div className="p-4">{children}</div>
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
      hidden={!active}
      className={active ? "space-y-4" : undefined}
    >
      {children}
    </section>
  );
}
