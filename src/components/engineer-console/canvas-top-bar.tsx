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
      return "Architecture";
    case "activity":
      return "Activity";
    case "repositories":
      return "Repositories";
    case "tasks":
      return "Tasks";
    case "runs":
      return "Runs";
    case "reviews":
      return "Reviews";
    case "release":
      return "Release";
    case "settings":
      return "Settings";
    case "docs":
      return "Docs";
  }
}

export function CanvasTopBar({
  activeContext,
  issueCount,
  environmentLabel,
  onOpenQueue,
}: {
  activeContext: CanvasTopBarTabId;
  issueCount: number;
  environmentLabel: string;
  onOpenQueue: () => void;
}) {
  const chipClassName =
    "inline-flex shrink-0 items-center rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1.5 text-xs text-[var(--muted)]";
  const contextLabel = labelForContext(activeContext);

  return (
    <div
      data-canvas-top-bar="true"
      data-canvas-command-bar="true"
      className="pointer-events-none absolute left-1/2 top-4 z-40 w-[min(calc(100vw-10rem),48rem)] -translate-x-1/2 max-sm:w-[calc(100vw-8rem)]"
    >
      <div className="pointer-events-auto flex items-center justify-between gap-2 rounded-[1.7rem] border border-white/8 bg-[#04070d]/68 px-3 py-2.5 shadow-[0_18px_36px_rgba(2,6,23,0.22)] backdrop-blur-xl max-sm:flex-col max-sm:items-stretch">
        <div
          data-canvas-top-context="true"
          className="flex min-w-0 items-center justify-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-2"
        >
          <h1 className="truncate text-sm font-semibold text-white">Engineering Console</h1>
          <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-white/30" />
          <span className="truncate text-sm text-[var(--muted)]">{contextLabel}</span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 max-sm:justify-center">
          <span className="sr-only" aria-live="polite">
            {contextLabel}
          </span>
          <span className={`${chipClassName} max-sm:hidden`}>{environmentLabel}</span>
          <span className={chipClassName}>{issueCount} issue{issueCount === 1 ? "" : "s"}</span>
          <button
            type="button"
            onClick={onOpenQueue}
            className="rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1.5 text-xs text-[var(--muted)] transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]"
          >
            View queue
          </button>
          <span className={`${chipClassName} sm:hidden`}>{environmentLabel}</span>
        </div>
      </div>
    </div>
  );
}
