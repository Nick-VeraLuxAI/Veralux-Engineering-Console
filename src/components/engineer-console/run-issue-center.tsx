"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { RunIssue } from "@/lib/engineer-console/run-ux/run-issues";

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
  const [expanded, setExpanded] = useState(() => initiallyExpanded ?? criticalCount > 0);

  useEffect(() => {
    if (criticalCount > 0) {
      setExpanded(true);
    }
  }, [criticalCount]);

  return (
    <aside className="pointer-events-none fixed right-4 bottom-4 z-30 flex max-w-sm flex-col items-end gap-2">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-sm font-medium text-white">Issue Center</span>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
          {issues.length}
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)] hover:text-white"
        >
          {expanded ? "Hide" : "Show"}
        </button>
      </div>

      {expanded ? (
        <div className="pointer-events-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Active issues</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Click an issue to open the relevant workspace view and panel.
              </p>
            </div>
            {criticalCount > 0 ? (
              <span className="rounded-full border border-red-500/40 px-2 py-0.5 text-[11px] text-red-200">
                {criticalCount} critical
              </span>
            ) : null}
          </div>

          {issues.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
              <p className="font-medium text-white">No active issues</p>
              <p className="mt-1">
                The run does not currently have any derived critical, warning, or info issues.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {issues.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    onClick={() => onOpenIssue(issue)}
                    className="block w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-left hover:border-white/20"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[issue.severity]}`}
                      >
                        {severityLabel(issue.severity)}
                      </span>
                      <span className="text-sm font-medium text-white">{issue.title}</span>
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
