"use client";

import React, { useId } from "react";
import type { RunSectionGroupState } from "@/lib/engineer-console/run-ux/run-ux-types";

const TONE_STYLES: Record<RunSectionGroupState["tone"], string> = {
  neutral: "border-[var(--border)] bg-[var(--card)]",
  ready: "border-blue-500/40 bg-blue-950/20",
  warning: "border-amber-500/40 bg-amber-950/20",
  blocked: "border-red-500/40 bg-red-950/20",
  complete: "border-emerald-500/40 bg-emerald-950/20",
};

const BADGE_STYLES: Record<RunSectionGroupState["tone"], string> = {
  neutral: "border-[var(--border)] text-[var(--muted)]",
  ready: "border-blue-400/40 text-blue-200",
  warning: "border-amber-400/40 text-amber-200",
  blocked: "border-red-400/40 text-red-200",
  complete: "border-emerald-400/40 text-emerald-200",
};

export function RunSectionGroup({
  state,
  anchorId,
  expanded,
  onToggle,
  children,
}: {
  state: RunSectionGroupState;
  anchorId?: string;
  expanded?: boolean;
  onToggle?: (nextExpanded: boolean) => void;
  children: React.ReactNode;
}) {
  const contentId = useId();
  const resolvedExpanded = expanded ?? state.defaultExpanded;

  return (
    <section
      id={anchorId}
      className={`scroll-mt-24 rounded-xl border p-4 ${TONE_STYLES[state.tone]}`}
      aria-labelledby={`${state.id}-heading`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${state.id}-heading`} className="text-lg font-semibold">
              {state.title}
            </h2>
            <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLES[state.tone]}`}>
              {state.currentStateLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">{state.description}</p>
          <p className="mt-3 text-sm">
            <span className="text-[var(--muted)]">Next step: </span>
            {state.nextActionLabel}
          </p>
        </div>

        <button
          type="button"
          aria-expanded={resolvedExpanded}
          aria-controls={contentId}
          onClick={() => onToggle?.(!resolvedExpanded)}
          className="inline-flex items-center justify-center rounded border border-[var(--border)] px-3 py-2 text-sm font-medium"
        >
          {resolvedExpanded ? "Hide details" : "Show details"}
        </button>
      </div>

      <div id={contentId} hidden={!resolvedExpanded} className="mt-4 space-y-4">
        {children}
      </div>
    </section>
  );
}
