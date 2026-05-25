import React from "react";
import type {
  RunCommandCenterState,
  RunWorkflowSummary,
} from "@/lib/engineer-console/run-ux/run-ux-types";
import { StatusBadge } from "./status-badge";

function SecondaryActionList({
  actions,
}: {
  actions: RunCommandCenterState["secondaryActions"];
}) {
  if (actions.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">Secondary safe actions</h3>
      <ul className="space-y-2 text-sm">
        {actions.map((action) => (
          <li
            key={`${action.label}-${action.description}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            <p className="font-medium">{action.label}</p>
            <p className="text-[var(--muted)]">
              {action.href ? (
                <a href={action.href} className="underline underline-offset-2">
                  {action.description}
                </a>
              ) : (
                action.description
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuidanceList({
  title,
  items,
  tone,
}: {
  title: string;
  items: RunCommandCenterState["blockers"] | RunCommandCenterState["warnings"];
  tone: "danger" | "warning";
}) {
  if (items.length === 0) return null;

  const titleClass =
    tone === "danger" ? "text-[var(--danger)]" : "text-amber-300";
  const itemClass =
    tone === "danger" ? "text-red-200" : "text-amber-100";

  return (
    <div>
      <h3 className={`mb-2 text-sm font-medium ${titleClass}`}>{title}</h3>
      <ul className={`space-y-2 text-sm ${itemClass}`}>
        {items.map((item, index) => (
          <li
            key={`${item.text}-${index}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            {item.href ? (
              <a href={item.href} className="underline underline-offset-2">
                {item.text}
              </a>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RunCommandCenter({
  summary,
  guidance,
}: {
  summary: RunWorkflowSummary;
  guidance: RunCommandCenterState;
}) {
  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      aria-labelledby="run-command-center-heading"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 id="run-command-center-heading" className="text-lg font-semibold">
            Run Command Center
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Top-level guidance only. All existing technical details, approval controls, and release
            panels remain below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={summary.run.status} />
          {summary.run.riskLevel ? <StatusBadge status={summary.run.riskLevel} /> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-4">
          <dl className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Current lifecycle stage</dt>
              <dd className="mt-1 font-medium">{guidance.currentStageLabel}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Next recommended action</dt>
              <dd className="mt-1 font-medium">{guidance.nextRecommendedAction}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Explanation</dt>
              <dd className="mt-1 text-[var(--muted)]">{guidance.explanation}</dd>
            </div>
          </dl>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm text-[var(--muted)]">Primary next step</p>
            <a
              href={guidance.primaryAction.href}
              className="mt-2 inline-flex rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
            >
              {guidance.primaryAction.label}
            </a>
          </div>

          <GuidanceList
            title="Blocking reasons"
            items={guidance.blockers}
            tone="danger"
          />
          <GuidanceList title="Warnings" items={guidance.warnings} tone="warning" />
        </div>

        <SecondaryActionList actions={guidance.secondaryActions} />
      </div>
    </section>
  );
}
