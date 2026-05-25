"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { RunIssue } from "@/lib/engineer-console/run-ux/run-issues";
import { getRunWorkspaceView } from "@/lib/engineer-console/run-ux/run-workspace";

const SEVERITY_STYLES: Record<RunIssue["severity"], string> = {
  critical: "border-red-500/40 bg-red-950/20 text-red-200",
  warning: "border-amber-500/40 bg-amber-950/20 text-amber-200",
  info: "border-blue-500/40 bg-blue-950/20 text-blue-200",
};

function severityLabel(severity: RunIssue["severity"]): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

export function RunIssueCenter({
  issues,
  onOpenIssue,
  initiallyExpanded,
}: {
  issues: RunIssue[];
  onOpenIssue: (issue: RunIssue) => void;
  initiallyExpanded?: boolean;
}) {
  const criticalCount = useMemo(
    () => issues.filter((issue) => issue.severity === "critical").length,
    [issues],
  );
  const warningCount = useMemo(
    () => issues.filter((issue) => issue.severity === "warning").length,
    [issues],
  );
  const infoCount = useMemo(
    () => issues.filter((issue) => issue.severity === "info").length,
    [issues],
  );
  const [expanded, setExpanded] = useState(() => initiallyExpanded ?? criticalCount > 0);

  const headerTone =
    criticalCount > 0
      ? "border-red-500/40 bg-red-950/35"
      : issues.length > 0
        ? "border-amber-500/40 bg-amber-950/25"
        : "border-[var(--border)] bg-[var(--card)]/95";

  useEffect(() => {
    if (criticalCount > 0) {
      setExpanded(true);
    }
  }, [criticalCount]);

  return (
    <aside
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-30 flex flex-col items-stretch gap-2 sm:left-auto sm:max-w-sm sm:items-end"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-full border px-3 py-2 shadow-lg backdrop-blur ${headerTone}`}
      >
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${
            criticalCount > 0 ? "bg-red-300" : issues.length > 0 ? "bg-amber-300" : "bg-emerald-300"
          }`}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Issue Center</p>
          <p className="text-[11px] text-[var(--muted)]">
            {issues.length === 0
              ? "All clear right now."
              : criticalCount > 0
                ? `${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} need attention.`
                : `${issues.length} problem${issues.length === 1 ? "" : "s"} ready for review.`}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
          {issues.length}
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {expanded ? (
        <div className="pointer-events-auto w-full rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-4 shadow-2xl backdrop-blur sm:w-[min(24rem,calc(100vw-2rem))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Problems needing attention</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Click an issue to open the relevant workspace view and panel.
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {criticalCount > 0 ? (
              <span className="rounded-full border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-red-100">
                {criticalCount} critical
              </span>
            ) : null}
            {warningCount > 0 ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-amber-100">
                {warningCount} warning{warningCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {infoCount > 0 ? (
              <span className="rounded-full border border-blue-500/40 bg-blue-950/30 px-2 py-0.5 text-blue-100">
                {infoCount} info
              </span>
            ) : null}
            {issues.length === 0 ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-950/20 px-2 py-0.5 text-emerald-100">
                No active issues
              </span>
            ) : null}
          </div>

          {issues.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
              <p className="font-medium text-white">All clear right now</p>
              <p className="mt-1">
                No critical, warning, or info issues are currently derived from the recorded run
                state.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    onClick={() => onOpenIssue(issue)}
                    className="block w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-left transition hover:border-white/20 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[issue.severity]}`}
                        >
                          {severityLabel(issue.severity)}
                        </span>
                        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                          {getRunWorkspaceView(issue.view).label}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--muted)]">Open workspace</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="text-sm font-medium text-white"
                      >
                        {issue.title}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">{issue.message}</p>
                    <p className="mt-2 text-xs text-white">
                      Suggested action: {issue.suggestedAction}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </aside>
  );
}
