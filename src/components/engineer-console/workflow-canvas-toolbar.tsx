import React from "react";

export function WorkflowCanvasToolbar({
  zoomLabel,
  layoutLocked,
  collapsed,
  onZoomOut,
  onZoomIn,
  onFitView,
  onResetView,
  onResetLayout,
  onToggleLayoutLock,
  onToggleCollapsed,
}: {
  zoomLabel: string;
  layoutLocked: boolean;
  collapsed: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
  onResetView: () => void;
  onResetLayout: () => void;
  onToggleLayoutLock: () => void;
  onToggleCollapsed: () => void;
}) {
  const iconButtonClassName =
    "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-black/15 text-sm text-white transition hover:border-white/15 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]";
  const labelButtonClassName = `${iconButtonClassName} w-16 text-[11px] text-[var(--muted)]`;
  const toggleLabel = collapsed ? "Expand canvas controls" : "Collapse canvas controls";

  return (
    <div
      data-canvas-toolbar="true"
      data-canvas-toolbar-collapsed={collapsed ? "true" : "false"}
      className="relative flex items-start"
    >
      <button
        type="button"
        data-canvas-toolbar-toggle="true"
        data-canvas-toolbar-edge-tab="true"
        aria-expanded={!collapsed}
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggleCollapsed}
        className={`inline-flex items-center justify-center border border-white/8 bg-[#07101c]/82 text-white shadow-[0_14px_28px_rgba(2,6,23,0.26)] backdrop-blur-xl motion-safe:transition-[transform,background-color,border-color,box-shadow] motion-safe:duration-200 hover:border-white/15 hover:bg-[#0c1627]/88 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d] ${
          collapsed
            ? "h-14 w-8 rounded-r-full rounded-l-[1rem]"
            : "absolute left-full top-4 z-10 h-12 w-8 -translate-x-[30%] rounded-r-full rounded-l-[1rem]"
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`h-4 w-4 text-[var(--muted)] motion-safe:transition-transform motion-safe:duration-200 ${
            collapsed ? "" : "rotate-180"
          }`}
        >
          <path d="M7.5 2.25 4 6l3.5 3.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
      </button>

      {!collapsed ? (
        <div
          data-canvas-toolbar-panel="true"
          className="flex flex-col items-center gap-2 rounded-[1.5rem] border border-white/8 bg-[#07101c]/76 p-2 pr-4 shadow-[0_16px_32px_rgba(2,6,23,0.24)] backdrop-blur-xl motion-safe:transition-[opacity,transform] motion-safe:duration-200"
        >
          <button
            type="button"
            data-canvas-zoom-in="true"
            onClick={onZoomIn}
            className={iconButtonClassName}
            aria-label="Zoom in"
          >
            +
          </button>
          <span
            data-canvas-zoom-label="true"
            className="inline-flex min-w-14 items-center justify-center rounded-xl border border-white/8 bg-black/15 px-2 py-2 text-sm text-[var(--muted)]"
          >
            {zoomLabel}
          </span>
          <button
            type="button"
            data-canvas-zoom-out="true"
            onClick={onZoomOut}
            className={iconButtonClassName}
            aria-label="Zoom out"
          >
            -
          </button>
          <button type="button" onClick={onFitView} className={labelButtonClassName} aria-label="Fit view">
            Fit
          </button>
          <button
            type="button"
            onClick={onResetView}
            className={labelButtonClassName}
            aria-label="Reset view"
          >
            View
          </button>
          <button
            type="button"
            onClick={onResetLayout}
            className={labelButtonClassName}
            aria-label="Reset layout"
          >
            Layout
          </button>
          <button
            type="button"
            aria-pressed={layoutLocked}
            onClick={onToggleLayoutLock}
            className={`${labelButtonClassName} ${layoutLocked ? "shadow-[0_0_0_1px_rgba(255,255,255,0.16)] text-white" : ""}`}
            aria-label={layoutLocked ? "Unlock layout" : "Lock layout"}
          >
            {layoutLocked ? "Lock" : "Free"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
