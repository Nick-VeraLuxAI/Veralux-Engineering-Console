"use client";

import React from "react";
import type { CanvasOverlayId, CanvasOverlayState } from "@/lib/engineer-console/dashboard/canvas-overlays";

export function CanvasMinimizedBar({
  overlays,
  onRestore,
  onClose,
}: {
  overlays: CanvasOverlayState[];
  onRestore: (id: CanvasOverlayId) => void;
  onClose: (id: CanvasOverlayId) => void;
}) {
  if (overlays.length === 0) {
    return null;
  }

  return (
    <div
      data-canvas-minimized-bar="true"
      className="absolute bottom-24 left-4 right-4 z-40 flex justify-start xl:bottom-6 xl:max-w-[calc(100vw-28rem)]"
    >
      <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-white/8 bg-[#05070d]/76 px-3 py-2 shadow-[0_14px_28px_rgba(2,6,23,0.24)] backdrop-blur-xl">
        {overlays.map((overlay) => (
          <div
            key={overlay.id}
            data-minimized-overlay={overlay.id}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/8 bg-black/15 px-3 py-1.5"
          >
            <button
              type="button"
              onClick={() => onRestore(overlay.id)}
              className="text-sm text-white transition hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {overlay.title}
            </button>
            <button
              type="button"
              aria-label={`Close minimized ${overlay.title}`}
              onClick={() => onClose(overlay.id)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/8 text-[11px] text-[var(--muted)] transition hover:border-white/15 hover:text-white"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
