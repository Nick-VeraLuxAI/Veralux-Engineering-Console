import React from "react";
import type { RunCurrentActionZoneState } from "@/lib/engineer-console/run-ux/run-ux-types";
import { runNavigationLabelForHref } from "@/lib/engineer-console/run-ux/run-navigation";

function GuidanceList({
  title,
  items,
  tone,
}: {
  title: string;
  items: RunCurrentActionZoneState["blockers"] | RunCurrentActionZoneState["warnings"];
  tone: "danger" | "warning";
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className={`mb-2 text-sm font-medium ${tone === "danger" ? "text-red-200" : "text-amber-200"}`}>
        {title}
      </h3>
      <ul className="space-y-2 text-sm">
        {items.map((item, index) => (
          <li
            key={`${item.text}-${index}`}
            className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            {item.href ? (
              <>
                <a href={item.href} className="underline underline-offset-2">
                  {item.text}
                </a>
                {runNavigationLabelForHref(item.href) ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    <a href={item.href} className="underline underline-offset-2">
                      {runNavigationLabelForHref(item.href)}
                    </a>
                  </p>
                ) : null}
              </>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RunCurrentActionZone({ state }: { state: RunCurrentActionZoneState }) {
  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      aria-labelledby="run-current-action-zone-heading"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 id="run-current-action-zone-heading" className="text-lg font-semibold">
            {state.title}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{state.description}</p>
        </div>
        <a
          href={state.primaryAction.href}
          className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-[0_10px_25px_rgba(59,130,246,0.2)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          {state.primaryAction.label}
        </a>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-sm text-[var(--muted)]">What should the operator do next?</p>
          <p className="mt-1 text-base font-medium">{state.currentStateLabel}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{state.currentStateDetail}</p>
        </div>
        <div className="space-y-4">
          <GuidanceList title="Top blockers" items={state.blockers} tone="danger" />
          <GuidanceList title="Top warnings" items={state.warnings} tone="warning" />
        </div>
      </div>
    </section>
  );
}
