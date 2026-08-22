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

export function CanvasTopBar({
  activeContext,
  issueCount,
  environmentLabel,
  onOpenIssues,
}: {
  activeContext: CanvasTopBarTabId;
  issueCount: number;
  environmentLabel?: string;
  onOpenIssues?: () => void;
  onOpenQueue?: () => void;
}) {
  const contextLabel = labelForContext(activeContext);

  return (
    <div
      data-canvas-top-bar="true"
      data-canvas-command-bar="true"
      className="pointer-events-none absolute left-1/2 top-5 z-40 -translate-x-1/2"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/8 bg-black/40 px-3 py-1.5 backdrop-blur-xl">
        <div data-canvas-top-context="true" className="flex items-baseline gap-2 px-1">
          <h1 className="text-[15px] font-medium tracking-tight text-white">Engineering Console</h1>
          <span className="text-[13px] text-white/40">{contextLabel}</span>
        </div>
        {environmentLabel ? <span className="sr-only">{environmentLabel}</span> : null}
        {issueCount > 0 && onOpenIssues ? (
          <button
            type="button"
            data-canvas-open-issues="true"
            aria-label={`${issueCount} issues`}
            onClick={onOpenIssues}
            className="rounded-full px-2 py-1 text-[12px] text-white/50 transition hover:text-white"
          >
            {issueCount}
          </button>
        ) : null}
      </div>
    </div>
  );
}
