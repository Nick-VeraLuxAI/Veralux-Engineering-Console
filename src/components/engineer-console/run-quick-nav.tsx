"use client";

import React from "react";
import type { RunQuickNavItemState } from "@/lib/engineer-console/run-ux/run-navigation";

const TONE_STYLES: Record<RunQuickNavItemState["tone"], string> = {
  neutral: "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]",
  ready: "border-blue-500/40 bg-blue-950/30 text-blue-200",
  warning: "border-amber-500/40 bg-amber-950/30 text-amber-200",
  blocked: "border-red-500/40 bg-red-950/30 text-red-200",
  complete: "border-emerald-500/40 bg-emerald-950/30 text-emerald-200",
};

export function RunQuickNav({
  items,
}: {
  items: RunQuickNavItemState[];
}) {
  return (
    <section
      className="sticky top-4 z-20 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 p-3 backdrop-blur"
      aria-labelledby="run-quick-nav-heading"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="run-quick-nav-heading" className="text-sm font-semibold">
              Quick navigation
            </h2>
            <details className="text-xs text-[var(--muted)] [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none rounded border border-[var(--border)] px-2 py-0.5">
                Keyboard shortcuts
              </summary>
              <div className="mt-2 rounded border border-[var(--border)] bg-[var(--background)] p-3">
                <p>Navigation only. No mutation shortcuts exist.</p>
                <ul className="mt-2 space-y-1">
                  <li>
                    <code>g w</code> Worker plan
                  </li>
                  <li>
                    <code>g a</code> Approval
                  </li>
                  <li>
                    <code>g p</code> PR creation
                  </li>
                  <li>
                    <code>g r</code> Review stages
                  </li>
                  <li>
                    <code>g e</code> Evidence
                  </li>
                  <li>
                    <code>g t</code> Technical audit
                  </li>
                </ul>
                <p className="mt-2">
                  Shortcuts are ignored while typing in inputs, textareas, selects, or editable
                  content.
                </p>
              </div>
            </details>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Jump to the next meaningful panel without changing any run state.
          </p>
        </div>
      </div>

      <nav aria-label="Run quick navigation" className="mt-3 overflow-x-auto">
        <ul className="flex min-w-max gap-2 pb-1">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={item.href}
                data-run-nav-target={item.targetId}
                aria-label={item.label}
                className={`block rounded-lg border px-3 py-2 transition hover:border-white/30 ${TONE_STYLES[item.tone]}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{item.label}</span>
                  <span className="rounded border border-current px-2 py-0.5 text-[11px] font-medium">
                    {item.statusLabel}
                  </span>
                </div>
                {item.shortcutKey ? (
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{item.shortcutKey}</p>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
