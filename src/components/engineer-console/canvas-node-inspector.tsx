import Link from "next/link";
import React from "react";
import type { CanvasOverlayState } from "@/lib/engineer-console/dashboard/canvas-overlays";
import type { WorkflowNodeInspectorData } from "@/lib/engineer-console/dashboard/workflow-map";
import { CanvasOverlayWindow } from "./canvas-overlay-window";

export function CanvasNodeInspector({
  inspector,
  overlayState,
  onClose,
  onMinimize,
  onBringToFront,
  onMove,
  isTopmost,
}: {
  inspector: WorkflowNodeInspectorData;
  overlayState: CanvasOverlayState;
  onClose: () => void;
  onMinimize: () => void;
  onBringToFront: () => void;
  onMove: (position: { x: number; y: number }) => void;
  isTopmost: boolean;
}) {
  const guidance = [...inspector.blockers.slice(0, 2), ...inspector.warnings.slice(0, 2)].slice(0, 3);

  if (!overlayState.isOpen || overlayState.isMinimized) {
    return null;
  }

  return (
    <CanvasOverlayWindow
      windowHtmlId="canvas-side-panel"
      overlayId="node-inspector"
      title={inspector.title}
      zIndex={overlayState.zIndex}
      isTopmost={isTopmost}
      onClose={onClose}
      onMinimize={onMinimize}
      onBringToFront={onBringToFront}
      position={overlayState.position}
      onMove={onMove}
      draggable
      placementClassName="left-4 bottom-24 xl:left-auto xl:right-4 xl:top-56 xl:bottom-auto"
      containerClassName="w-[min(22rem,calc(100vw-2rem))]"
      surfaceClassName="border-white/8 bg-[#08111c]/82 shadow-[0_24px_52px_rgba(2,6,23,0.32)]"
      bodyClassName="p-5"
      role="dialog"
    >
      <div data-inspector-supporting="true" data-inspector-node-id={inspector.nodeId}>
        <p className="text-sm text-[var(--muted)]">{inspector.state}</p>

        <div className="mt-5 space-y-4">
          <div>
            <p className="text-[11px] font-medium text-[var(--muted)]">Why it matters</p>
            <p className="mt-2 text-sm text-white">{inspector.whyItMatters}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-[var(--muted)]">Next action</p>
            <p className="mt-2 text-sm text-white">{inspector.nextAction}</p>
          </div>
          {guidance.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium text-[var(--muted)]">Top blockers</p>
              <ul className="mt-2 space-y-2">
                {guidance.map((item) => (
                  <li
                    key={item}
                    className="rounded-2xl border border-white/8 bg-black/15 px-3 py-2 text-sm text-[var(--muted)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={inspector.primaryActionHref}
            className="inline-flex items-center rounded-xl border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.09]"
          >
            {inspector.primaryActionLabel}
          </Link>
          <Link
            href={inspector.secondaryActionHref}
            className="inline-flex items-center rounded-xl border border-white/8 px-4 py-2.5 text-sm text-[var(--muted)] transition hover:border-white/15 hover:text-white"
          >
            {inspector.secondaryActionLabel}
          </Link>
        </div>
      </div>
    </CanvasOverlayWindow>
  );
}
