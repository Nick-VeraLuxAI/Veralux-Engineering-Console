"use client";

import React, { useEffect, useRef } from "react";
import type { CanvasOverlayId, CanvasOverlayPosition } from "@/lib/engineer-console/dashboard/canvas-overlays";

interface DragState {
  pointerOffsetX: number;
  pointerOffsetY: number;
  width: number;
  height: number;
}

export function CanvasOverlayWindow({
  windowHtmlId,
  overlayId,
  title,
  zIndex,
  isTopmost,
  children,
  onClose,
  onMinimize,
  onBringToFront,
  position,
  onMove,
  draggable = false,
  placementClassName = "",
  containerClassName = "",
  surfaceClassName = "",
  bodyClassName = "",
  headerSuffix,
  role = "region",
}: {
  windowHtmlId?: string;
  overlayId: CanvasOverlayId;
  title: string;
  zIndex: number;
  isTopmost: boolean;
  children: React.ReactNode;
  onClose?: () => void;
  onMinimize?: () => void;
  onBringToFront: () => void;
  position?: CanvasOverlayPosition;
  onMove?: (position: CanvasOverlayPosition) => void;
  draggable?: boolean;
  placementClassName?: string;
  containerClassName?: string;
  surfaceClassName?: string;
  bodyClassName?: string;
  headerSuffix?: React.ReactNode;
  role?: "region" | "dialog";
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!draggable || !onMove) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      event.preventDefault();

      const padding = 8;
      const nextX = Math.min(
        Math.max(padding, event.clientX - dragStateRef.current.pointerOffsetX),
        Math.max(padding, window.innerWidth - dragStateRef.current.width - padding),
      );
      const nextY = Math.min(
        Math.max(padding, event.clientY - dragStateRef.current.pointerOffsetY),
        Math.max(padding, window.innerHeight - dragStateRef.current.height - padding),
      );

      onMove({ x: nextX, y: nextY });
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [draggable, onMove]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || !onMove || event.button !== 0 || !windowRef.current) return;

    const rect = windowRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerOffsetX: event.clientX - rect.left,
      pointerOffsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    onBringToFront();
    event.stopPropagation();
  };

  return (
    <section
      id={windowHtmlId}
      ref={windowRef}
      role={role}
      aria-label={title}
      data-overlay-window={overlayId}
      data-overlay-top={isTopmost ? "true" : "false"}
      data-overlay-z-index={String(zIndex)}
      onPointerDown={(event) => {
        event.stopPropagation();
        onBringToFront();
      }}
      className={`absolute ${position ? "" : placementClassName} ${containerClassName}`}
      style={
        position
          ? {
              left: position.x,
              top: position.y,
              zIndex,
            }
          : { zIndex }
      }
    >
      <div
        className={`overflow-hidden rounded-[1.6rem] border border-white/8 bg-[#07101c]/84 shadow-[0_24px_48px_rgba(2,6,23,0.34)] backdrop-blur-xl motion-safe:transition-[transform,opacity,box-shadow,border-color,background-color] motion-safe:duration-200 ${surfaceClassName}`}
      >
        <div
          data-overlay-drag-handle={draggable ? "true" : undefined}
          onPointerDown={startDrag}
          className={`flex items-center gap-3 border-b border-white/8 px-4 py-3 ${
            draggable ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{title}</p>
            <p className="text-[11px] text-[var(--muted)]">Overlay window</p>
          </div>
          {headerSuffix || onMinimize || onClose ? (
            <div className="ml-auto flex items-center gap-2">
              {headerSuffix}
              {onMinimize ? (
                <button
                  type="button"
                  data-overlay-minimize={overlayId}
                  aria-label={`Minimize ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMinimize();
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/8 text-sm text-[var(--muted)] transition hover:border-white/15 hover:bg-white/[0.03] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  -
                </button>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  data-overlay-close={overlayId}
                  aria-label={`Close ${title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/8 text-sm text-[var(--muted)] transition hover:border-white/15 hover:bg-white/[0.03] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  x
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className={bodyClassName}>{children}</div>
      </div>
    </section>
  );
}
