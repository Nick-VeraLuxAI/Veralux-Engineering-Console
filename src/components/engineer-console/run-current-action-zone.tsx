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

export function RunCurrentActionZone({
  state,
  onPrimaryClick,
  hidePrimary = false,
}: {
  state: RunCurrentActionZoneState;
  onPrimaryClick?: () => void;
  hidePrimary?: boolean;
}) {
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
          <p className="mt-3 text-sm text-white">{state.currentStateLabel}</p>
        </div>
        {hidePrimary ? null : (
          <a
            href={state.primaryAction.href}
            onClick={(event) => {
              if (!onPrimaryClick) return;
              event.preventDefault();
              onPrimaryClick();
            }}
            className="inline-flex rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {state.primaryAction.label}
          </a>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <GuidanceList title="What is in the way" items={state.blockers.slice(0, 2)} tone="danger" />
        <GuidanceList title="Worth a look" items={state.warnings.slice(0, 1)} tone="warning" />
      </div>
    </section>
  );
}
