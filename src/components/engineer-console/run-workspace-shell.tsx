"use client";

import React from "react";
import { StatusBadge } from "./status-badge";
import {
  DEFAULT_RUN_WORKSPACE_VIEW,
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

function issueSeverityTone(severity: RunIssue["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-950/30 text-red-100";
    case "warning":
      return "border-amber-500/40 bg-amber-950/30 text-amber-100";
    default:
      return "border-blue-500/40 bg-blue-950/30 text-blue-100";
  }
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
  const activeWorkspaceIssueCount = viewIssueCounts[activeView] ?? 0;

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
      className="relative mx-auto max-w-[112rem] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
      aria-labelledby="run-workspace-heading"
    >
      <div className="sticky top-3 z-20 rounded-t-3xl border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
        <div className="flex flex-col gap-5 p-4 sm:p-5">
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="run-workspace-heading"
                  className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]"
                >
                  Run workspace
                </h2>
                <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-medium text-white">
                  {activeWorkspace.label} workspace
                </span>
                {currentIssue ? (
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${issueSeverityTone(currentIssue.severity)}`}
                  >
                    Highest priority: {currentIssue.severity}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
                {taskTitle}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Run {runIdShort} • {activeWorkspace.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={runStatus} />
              <span className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs text-[var(--muted)]">
                Stage: {currentStageLabel}
              </span>
              {riskLevel ? <StatusBadge status={riskLevel} /> : null}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[12rem_minmax(0,1fr)_minmax(18rem,0.95fr)]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Attention</p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium text-white">{blockerCount} blocker(s)</p>
                <p className="text-[var(--muted)]">{warningCount} warning(s)</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Primary next action</p>
              <p className="mt-3 text-sm font-medium text-white">{nextAction}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Navigation stays separate from approvals, PR, merge, and release actions. Those
                controls remain inside the selected workspace.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Current workspace</p>
              <p className="mt-3 text-sm font-semibold text-white">{activeWorkspace.label}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {activeWorkspaceIssueCount > 0
                  ? `${activeWorkspaceIssueCount} issue${activeWorkspaceIssueCount === 1 ? "" : "s"} linked here right now.`
                  : "No derived issues are currently linked to this workspace."}
              </p>
              <button
                type="button"
                onClick={onOpenCurrentIssue}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
              >
                {currentIssue
                  ? `Open issue: ${currentIssue.title}`
                  : `Open ${activeWorkspace.label}`}
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <div
            className="flex gap-2 overflow-x-auto pb-1"
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
                  className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white shadow-[0_0_0_1px_var(--accent),0_14px_30px_rgba(59,130,246,0.18)]"
                      : "border-[var(--border)] bg-[var(--card)]/70 text-[var(--muted)] hover:border-white/15 hover:text-white"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span>{view.label}</span>
                    {issueCount > 0 ? (
                      <span
                        aria-hidden="true"
                        className={`rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${
                          selected
                            ? "border-white/20 bg-white/10 text-white"
                            : "border-[var(--border)] bg-[var(--background)] text-[var(--muted)]"
                        }`}
                      >
                        {issueCount}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Current workspace:{" "}
            <span className="font-medium text-white">{activeWorkspace.label}</span>.{" "}
            {activeWorkspace.description ??
              RUN_WORKSPACE_VIEWS.find((view) => view.id === DEFAULT_RUN_WORKSPACE_VIEW)?.description}
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-5">{children}</div>
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
      className={active ? "mx-auto max-w-[104rem] space-y-5" : undefined}
    >
      {children}
    </section>
  );
}
