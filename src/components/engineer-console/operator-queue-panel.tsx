"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  type OperatorQueueItem,
} from "@/lib/engineer-console/run-ux/operator-queue";
import {
  buildOperatorQueueSections,
  hasOperatorQueueActionableItems,
} from "@/lib/engineer-console/run-ux/operator-queue-view";
import type { OperatorQueueFilterId } from "@/lib/engineer-console/run-ux/operator-queue";
import { StatusBadge } from "./status-badge";

const FILTERS: Array<{ id: OperatorQueueFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs_action", label: "Needs action" },
  { id: "blocked", label: "Blocked" },
  { id: "approval", label: "Approval" },
  { id: "pr_release", label: "PR / Release" },
  { id: "completed", label: "Completed" },
];

function filterCount(items: OperatorQueueItem[], filter: OperatorQueueFilterId): number {
  return buildOperatorQueueSections(items, filter).reduce((count, section) => count + section.items.length, 0);
}

function EmptyState({
  title,
  detail,
  href,
  action,
}: {
  title: string;
  detail: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2">{detail}</p>
      {href && action ? (
        <Link href={href} className="mt-3 inline-flex text-sm font-medium text-[var(--accent)] underline underline-offset-2">
          {action}
        </Link>
      ) : null}
    </div>
  );
}

export function OperatorQueuePanel({
  items,
  registeredRepoCount,
  taskCount,
  taskCountWithoutRuns,
}: {
  items: OperatorQueueItem[];
  registeredRepoCount: number;
  taskCount: number;
  taskCountWithoutRuns: number;
}) {
  const [filter, setFilter] = useState<OperatorQueueFilterId>("all");
  const sections = useMemo(() => buildOperatorQueueSections(items, filter), [filter, items]);
  const hasActionable = hasOperatorQueueActionableItems(items);

  let emptyState: React.ReactNode = null;
  if (taskCount === 0 && registeredRepoCount === 0) {
    emptyState = (
      <EmptyState
        title="Register a repo first"
        detail="No repositories are available yet, so the operator queue cannot triage work. Register and verify a repo before creating a task."
        href="/engineer/repos"
        action="Open registered repositories"
      />
    );
  } else if (taskCount === 0) {
    emptyState = (
      <EmptyState
        title="Create the first task"
        detail="Repositories are ready, but there are no tasks to queue yet. Create a task to establish the next operator workflow."
      />
    );
  } else if (taskCountWithoutRuns === taskCount && filter === "all") {
    emptyState = (
      <EmptyState
        title="Tasks exist, but no runs have started"
        detail="Open a task and start its first run to populate the operator queue with lifecycle, blocker, and release state."
      />
    );
  } else if (sections.length === 0) {
    emptyState = (
      <EmptyState
        title={filter === "completed" ? "No completed runs yet" : "No queue items in this filter"}
        detail={
          filter === "all"
            ? "No operator action required right now."
            : "Try another filter to review work in a different state."
        }
      />
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Operator Queue</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Review the latest run or task per workflow to see what needs attention next. Filters
            are read-only and never trigger run, approval, PR, merge, deploy, or sign-off actions.
          </p>
        </div>
        {filter === "all" && taskCount > 0 && !hasActionable ? (
          <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            No operator action required right now.
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Operator queue filters">
        {FILTERS.map((tab) => {
          const selected = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setFilter(tab.id)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                selected
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-white"
              }`}
            >
              {tab.label} <span className="text-xs opacity-80">({filterCount(items, tab.id)})</span>
            </button>
          );
        })}
      </div>

      {emptyState ? (
        <div className="mt-4">{emptyState}</div>
      ) : (
        <div className="mt-5 space-y-5">
          {sections.map((section) => (
            <div key={section.id}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {section.title}
                </h3>
                <span className="text-xs text-[var(--muted)]">{section.items.length} item(s)</span>
              </div>
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <li key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-white">{item.title}</p>
                          <StatusBadge status={item.status} />
                          {item.runIdShort ? (
                            <span className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]">
                              run {item.runIdShort}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted)]">{item.repoLabel}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                          <span>Stage: {item.currentStageLabel}</span>
                          <span>
                            {item.blockerCount} blocker(s), {item.warningCount} warning(s)
                          </span>
                          <span>
                            {item.lastUpdatedLabel}:{" "}
                            {item.lastUpdatedAt === new Date(0).toISOString()
                              ? "manual tracking"
                              : new Date(item.lastUpdatedAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-white">Next action: {item.nextAction}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">{item.reason}</p>
                        {item.pathHint ? (
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            Record path: <code>{item.pathHint}</code>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Link
                          href={item.href}
                          className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-white hover:bg-[var(--card)]"
                        >
                          {item.runId ? "Open run" : item.kind === "task" ? "Open task" : "Open dashboard"}
                        </Link>
                        {item.secondaryHref && item.secondaryLabel ? (
                          <Link
                            href={item.secondaryHref}
                            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-white"
                          >
                            {item.secondaryLabel}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
