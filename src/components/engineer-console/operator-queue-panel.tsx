"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type OperatorQueueItem } from "@/lib/engineer-console/run-ux/operator-queue";
import {
  DEFAULT_OPERATOR_QUEUE_PRESET,
  type OperatorQueueDensityMode,
  type OperatorQueuePresetId,
  OPERATOR_QUEUE_PRESETS,
  buildOperatorQueueSections,
  getOperatorQueuePreset,
  hasOperatorQueueActionableItems,
  queuePresetToQueryValue,
  resolveOperatorQueuePresetId,
} from "@/lib/engineer-console/run-ux/operator-queue-view";
import { StatusBadge } from "./status-badge";

const QUEUE_PRESET_STORAGE_KEY = "engineer-console.queue-preset.v1";

function presetCount(items: OperatorQueueItem[], preset: OperatorQueuePresetId): number {
  return buildOperatorQueueSections(items, preset).reduce(
    (count, section) => count + section.items.length,
    0,
  );
}

function setQueueQueryParam(preset: OperatorQueuePresetId) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (preset === DEFAULT_OPERATOR_QUEUE_PRESET) {
    url.searchParams.delete("queue");
  } else {
    url.searchParams.set("queue", queuePresetToQueryValue(preset));
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function emptyStateCopy(preset: OperatorQueuePresetId): {
  title: string;
  detail: string;
} {
  switch (preset) {
    case "blocked_failed":
      return {
        title: "No blocked runs right now.",
        detail: "Blocked and failed work is clear. Review other presets for routine operator follow-up.",
      };
    case "approval_queue":
      return {
        title: "No runs waiting for approval.",
        detail: "The approval queue is clear right now.",
      };
    case "stale_runs":
      return {
        title: "No stale runs detected.",
        detail: "No queued run currently meets the advisory stale thresholds.",
      };
    case "pr_release_queue":
      return {
        title: "No PR or release follow-up right now.",
        detail: "No runs are currently queued for PR, merge, deployment, checklist, or sign-off review.",
      };
    case "recently_completed":
      return {
        title: "No recently completed runs yet.",
        detail: "Completed work will appear here after runs finish.",
      };
    case "staging_setup":
      return {
        title: "No staging setup attention items right now.",
        detail: "Setup and staging guidance items are currently clear.",
      };
    case "my_next_actions":
      return {
        title: "No immediate next actions right now.",
        detail: "Your actionable run and task queue is clear at the moment.",
      };
    default:
      return {
        title: "No operator action required right now.",
        detail:
          "The queue is clear right now, but that does not imply staging, launch, or release readiness is complete.",
      };
  }
}

function staleLabel(item: Pick<OperatorQueueItem, "staleKind">): string {
  switch (item.staleKind) {
    case "stale_approval":
      return "Stale approval";
    case "stale_release_followup":
      return "Stale release";
    case "stale_failed_run":
      return "Stale failed run";
    case "stale_planning":
      return "Stale planning";
    case "inactive_run":
      return "Inactive run";
    default:
      return "Stale";
  }
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
  initialPreset = DEFAULT_OPERATOR_QUEUE_PRESET,
  hasQueueQueryParam = false,
  initialDensity = "detailed",
}: {
  items: OperatorQueueItem[];
  registeredRepoCount: number;
  taskCount: number;
  taskCountWithoutRuns: number;
  initialPreset?: OperatorQueuePresetId;
  hasQueueQueryParam?: boolean;
  initialDensity?: OperatorQueueDensityMode;
}) {
  const [preset, setPreset] = useState<OperatorQueuePresetId>(initialPreset);
  const [density, setDensity] = useState<OperatorQueueDensityMode>(initialDensity);
  const sections = useMemo(() => buildOperatorQueueSections(items, preset), [items, preset]);
  const hasActionable = hasOperatorQueueActionableItems(items);

  useEffect(() => {
    setPreset(initialPreset);
  }, [initialPreset]);

  useEffect(() => {
    if (typeof window === "undefined" || hasQueueQueryParam) return;
    const stored = window.localStorage.getItem(QUEUE_PRESET_STORAGE_KEY);
    const resolved = resolveOperatorQueuePresetId(stored);
    if (resolved !== DEFAULT_OPERATOR_QUEUE_PRESET) {
      setPreset(resolved);
    }
  }, [hasQueueQueryParam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUEUE_PRESET_STORAGE_KEY, queuePresetToQueryValue(preset));
  }, [preset]);

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
  } else if (taskCountWithoutRuns === taskCount && preset === DEFAULT_OPERATOR_QUEUE_PRESET) {
    emptyState = (
      <EmptyState
        title="Tasks exist, but no runs have started"
        detail="Open a task and start its first run to populate the operator queue with lifecycle, blocker, and release state."
      />
    );
  } else if (sections.length === 0) {
    const copy = emptyStateCopy(preset);
    emptyState = (
      <EmptyState title={copy.title} detail={copy.detail} />
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Operator Queue</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Review the latest run or task per workflow to see what needs attention next. Queue
            presets and density modes are read-only and never trigger run, approval, PR, merge,
            deploy, or sign-off actions.
          </p>
        </div>
        {preset === DEFAULT_OPERATOR_QUEUE_PRESET && taskCount > 0 && !hasActionable ? (
          <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
            No operator action required right now.
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Operator queue presets">
          {OPERATOR_QUEUE_PRESETS.map((tab) => {
            const selected = preset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setPreset(tab.id);
                  setQueueQueryParam(tab.id);
                }}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                    : "border-[var(--border)] text-[var(--muted)] hover:text-white"
                }`}
              >
                {tab.label}{" "}
                <span className="text-xs opacity-80">({presetCount(items, tab.id)})</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 self-start">
          <span className="text-xs uppercase tracking-wide text-[var(--muted)]">View</span>
          <button
            type="button"
            aria-pressed={density === "detailed"}
            onClick={() => setDensity("detailed")}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              density === "detailed"
                ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                : "border-[var(--border)] text-[var(--muted)] hover:text-white"
            }`}
          >
            Detailed
          </button>
          <button
            type="button"
            aria-pressed={density === "compact"}
            onClick={() => setDensity("compact")}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              density === "compact"
                ? "border-[var(--accent)] bg-[var(--accent)]/15 text-white"
                : "border-[var(--border)] text-[var(--muted)] hover:text-white"
            }`}
          >
            Compact
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        Preset: {getOperatorQueuePreset(preset).description}
      </p>

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
                          {item.isStale ? (
                            <span className="rounded border border-amber-700/70 bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                              {staleLabel(item)}
                            </span>
                          ) : null}
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
                          {item.ageLabel ? <span>Age: {item.ageLabel}</span> : null}
                          <span>
                            {item.lastUpdatedLabel}:{" "}
                            {item.lastUpdatedAt === new Date(0).toISOString()
                              ? "manual tracking"
                              : new Date(item.lastUpdatedAt).toLocaleString()}
                          </span>
                        </div>
                        {density === "compact" ? (
                          <p className="mt-3 text-sm text-white">Next action: {item.nextAction}</p>
                        ) : (
                          <>
                            <p className="mt-3 text-sm text-[var(--muted)]">
                              What happened: <span className="text-white">{item.reason}</span>
                            </p>
                            <p className="mt-1 text-sm text-[var(--muted)]">
                              Why it matters: <span className="text-white">{item.whyItMatters}</span>
                            </p>
                            <p className="mt-1 text-sm text-[var(--muted)]">
                              Next action: <span className="text-white">{item.nextAction}</span>
                            </p>
                            {item.staleReason ? (
                              <p className="mt-1 text-sm text-amber-200">
                                {staleLabel(item)}: {item.staleReason}
                              </p>
                            ) : null}
                            {item.handoffNote ? (
                              <p className="mt-1 text-sm text-[var(--muted)]">
                                Takeover guidance: <span className="text-white">{item.handoffNote}</span>
                              </p>
                            ) : null}
                            {item.pathHint ? (
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                Record path: <code>{item.pathHint}</code>
                              </p>
                            ) : null}
                          </>
                        )}
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
