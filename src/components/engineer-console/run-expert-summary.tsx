import React from "react";
import { StatusBadge } from "./status-badge";

export function RunExpertSummary({
  items,
}: {
  items: Array<{ id: string; label: string; status: string }>;
}) {
  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      aria-labelledby="run-expert-summary-heading"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 id="run-expert-summary-heading" className="text-sm font-semibold">
            Expert summary
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Read-only status strip for repeat operators. Full explanations remain in the panels
            below.
          </p>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            <dt className="text-xs text-[var(--muted)]">{item.label}</dt>
            <dd className="mt-1">
              <StatusBadge status={item.status} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
