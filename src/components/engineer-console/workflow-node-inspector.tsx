import Link from "next/link";
import React from "react";
import type { WorkflowNodeInspectorData } from "@/lib/engineer-console/dashboard/workflow-map";

function GuidanceList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "danger" | "warning";
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className={`text-xs uppercase tracking-[0.18em] ${tone === "danger" ? "text-red-200" : "text-amber-200"}`}>
        {title}
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--muted)]"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WorkflowNodeInspector({
  inspector,
}: {
  inspector: WorkflowNodeInspectorData;
}) {
  return (
    <aside className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_18px_50px_rgba(15,23,42,0.24)]">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Node inspector</p>
        <h2 className="mt-2 text-xl font-semibold text-white">{inspector.title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{inspector.state}</p>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Why it matters</p>
          <p className="mt-2 text-sm text-white">{inspector.whyItMatters}</p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Next action</p>
          <p className="mt-2 text-sm text-white">{inspector.nextAction}</p>
        </div>

        <GuidanceList title="Blockers" items={inspector.blockers} tone="danger" />
        <GuidanceList title="Warnings" items={inspector.warnings} tone="warning" />
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href={inspector.primaryActionHref}
          className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_14px_30px_rgba(217,119,6,0.22)] transition hover:brightness-110"
        >
          {inspector.primaryActionLabel}
        </Link>
        <Link
          href={inspector.secondaryActionHref}
          className="inline-flex items-center justify-center rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition hover:border-white/15 hover:text-white"
        >
          {inspector.secondaryActionLabel}
        </Link>
      </div>
    </aside>
  );
}
