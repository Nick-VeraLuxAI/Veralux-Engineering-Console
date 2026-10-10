import React from "react";

export type CanvasTopBarTabId =
  | "architecture"
  | "activity"
  | "repositories"
  | "tasks"
  | "runs"
  | "reviews"
  | "release"
  | "settings"
  | "docs";

function labelForContext(context: CanvasTopBarTabId) {
  switch (context) {
    case "architecture":
      return "Map";
    case "activity":
      return "Activity";
    case "repositories":
      return "Repositories";
    case "tasks":
      return "Tasks";
    case "runs":
      return "Runs";
    case "reviews":
      return "Review";
    case "release":
      return "Release";
    case "settings":
      return "Settings";
    case "docs":
      return "Docs";
  }
}

export const CANVAS_WORKING_REPO_KEY = "veralux.map.working-repo.v1";

export function summarizeCanvasIssues(
  issues: Array<{ severity: "critical" | "warning" | "info" }>,
): string {
  if (issues.length === 0) return "No active workflow issues";

  const counts = {
    critical: issues.filter((issue) => issue.severity === "critical").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
  };

  return (["critical", "warning", "info"] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(" · ");
}

export function resolveCanvasWorkingRepo<T extends { id: string; name: string }>(
  repos: T[],
  selectedId: string | null | undefined,
): T | null {
  if (!repos.length) return null;
  if (selectedId) {
    return repos.find((repo) => repo.id === selectedId) ?? null;
  }
  return repos[0] ?? null;
}

export function loadCanvasWorkingRepoId(
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(CANVAS_WORKING_REPO_KEY);
  } catch {
    return null;
  }
}

export function saveCanvasWorkingRepoId(
  id: string,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage) return;
  storage.setItem(CANVAS_WORKING_REPO_KEY, id);
}

export function CanvasTopBar({
  activeContext,
  environmentLabel,
  workingRepoLabel,
  issueCount = 0,
  issueSummary,
  onOpenIssues,
  showBack = false,
  onBack,
  leading,
}: {
  activeContext: CanvasTopBarTabId;
  issueCount?: number;
  issueSummary?: string;
  environmentLabel?: string;
  workingRepoLabel?: string;
  onOpenIssues?: () => void;
  onOpenQueue?: () => void;
  showBack?: boolean;
  onBack?: () => void;
  leading?: React.ReactNode;
}) {
  const repoLabel = workingRepoLabel?.trim() || "";
  const contextLabel =
    repoLabel.toLowerCase() === "engineering console"
      ? labelForContext(activeContext)
      : repoLabel || labelForContext(activeContext);
  const resolvedIssueSummary =
    issueSummary?.trim() ||
    (issueCount > 0
      ? `${issueCount} active workflow issue${issueCount === 1 ? "" : "s"}`
      : "No active workflow issues");

  return (
    <div
      data-canvas-top-bar="true"
      data-canvas-command-bar="true"
      className="relative z-40 grid w-full min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-white/8 bg-[#070a12] px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] sm:px-4"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {leading}
        {showBack && onBack ? (
          <button
            type="button"
            data-engineer-back="true"
            data-motion-press="true"
            aria-label="Back"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/8 px-2 py-1 text-[12px] text-white/60 transition hover:border-white/16 hover:text-white sm:px-2.5"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
              <path
                d="M8 2.5 3.5 6 8 9.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
            <span className="hidden sm:inline">Back</span>
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 items-baseline justify-center gap-2">
        <div data-canvas-top-context="true" className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-[13px] font-medium tracking-tight text-white">
            <span className="sm:hidden">Console</span>
            <span className="hidden sm:inline">Engineering Console</span>
          </h1>
          <span
            data-canvas-working-repo={repoLabel || undefined}
            className="hidden max-w-[16rem] truncate text-[12px] text-white/60 sm:inline"
          >
            {contextLabel}
          </span>
        </div>
        {environmentLabel ? <span className="sr-only">{environmentLabel}</span> : null}
      </div>
      <div className="flex min-w-0 items-center justify-end">
        {onOpenIssues ? (
          <button
            type="button"
            data-canvas-open-issues="true"
            data-motion-press="true"
            data-canvas-issue-summary={resolvedIssueSummary}
            aria-label={`Open workflow issues: ${resolvedIssueSummary}`}
            title={`${resolvedIssueSummary}. Open issue center for details and recommended actions.`}
            onClick={onOpenIssues}
            className="inline-flex items-center rounded-full px-2 py-1 text-[12px] text-white/55 transition hover:text-white"
          >
            Issues
            {issueCount > 0 ? <span className="ml-1.5 tabular-nums text-white/60">{issueCount}</span> : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}
