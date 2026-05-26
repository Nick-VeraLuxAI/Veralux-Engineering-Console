"use client";

import React, { useEffect, useRef } from "react";

export function CanvasDetailDrawer({
  detailPanel,
  title,
  onClose,
  onMinimize,
  zIndex,
  isTopmost,
  onBringToFront,
  children,
}: {
  detailPanel: string;
  title: string;
  onClose: () => void;
  onMinimize: () => void;
  zIndex: number;
  isTopmost: boolean;
  onBringToFront: () => void;
  children: React.ReactNode;
}) {
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  return (
    <div
      data-detail-drawer="true"
      data-detail-panel={detailPanel}
      data-overlay-window="detail-drawer"
      data-overlay-top={isTopmost ? "true" : "false"}
      data-overlay-z-index={String(zIndex)}
      className="pointer-events-none absolute inset-0"
      aria-live="polite"
      style={{ zIndex }}
    >
      <button
        type="button"
        aria-label="Close detail drawer"
        onClick={onClose}
        className="pointer-events-auto absolute inset-0 bg-[rgba(2,6,23,0.14)]"
      />
      <aside
        ref={drawerRef}
        id="canvas-detail-drawer"
        role="dialog"
        aria-modal="false"
        aria-label={title}
        tabIndex={-1}
        onPointerDown={(event) => {
          event.stopPropagation();
          onBringToFront();
        }}
        className="pointer-events-auto absolute right-4 bottom-4 left-4 max-h-[min(76vh,52rem)] overflow-hidden rounded-[2rem] border border-white/10 bg-[#07101c]/94 shadow-[0_32px_80px_rgba(2,6,23,0.44)] backdrop-blur-xl md:left-6 md:right-6 md:bottom-6 xl:left-auto xl:top-6 xl:right-[calc(22rem+2rem)] xl:bottom-6 xl:w-[min(32rem,calc(100vw-28rem))] xl:max-h-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Overlay drawer</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-overlay-minimize="detail-drawer"
              aria-label={`Minimize ${title}`}
              onClick={onMinimize}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm text-[var(--muted)] transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              -
            </button>
            <button
              type="button"
              data-overlay-close="detail-drawer"
              aria-label={`Close ${title}`}
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-sm text-[var(--muted)] transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              x
            </button>
          </div>
        </div>

        <div className="max-h-[calc(min(76vh,52rem)-5.25rem)] overflow-y-auto p-5 xl:max-h-[calc(100dvh-9rem)]">
          {children}
        </div>
      </aside>
    </div>
  );
}
