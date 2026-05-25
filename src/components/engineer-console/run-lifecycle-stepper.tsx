import React from "react";
import type {
  RunLifecycleStepState,
  RunLifecycleStepStatus,
} from "@/lib/engineer-console/run-ux/run-ux-types";

const STEP_STATUS_STYLES: Record<RunLifecycleStepStatus, string> = {
  not_started: "border-[var(--border)] bg-[var(--background)] text-[var(--muted)]",
  ready: "border-blue-500/40 bg-blue-950/30 text-blue-200",
  blocked: "border-red-500/40 bg-red-950/30 text-red-200",
  warning: "border-amber-500/40 bg-amber-950/30 text-amber-200",
  passed: "border-emerald-500/40 bg-emerald-950/30 text-emerald-200",
  complete: "border-emerald-500/40 bg-emerald-950/30 text-emerald-200",
};

function statusLabel(status: RunLifecycleStepStatus): string {
  return status.replace(/_/g, " ");
}

export function RunLifecycleStepper({
  steps,
  currentStageId,
}: {
  steps: RunLifecycleStepState[];
  currentStageId: string;
}) {
  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      aria-labelledby="run-lifecycle-heading"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="run-lifecycle-heading" className="text-lg font-semibold">
            Lifecycle
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Workflow hierarchy only. Click a step to jump to the relevant panel or task page.
          </p>
        </div>
        <p className="text-xs text-[var(--muted)]">
          Current focus:{" "}
          <span className="font-medium text-white">
            {steps.find((step) => step.id === currentStageId)?.label ?? "Run"}
          </span>
        </p>
      </div>

      <nav aria-label="Run lifecycle">
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {steps.map((step, index) => {
            const isCurrent = step.id === currentStageId;
            return (
              <li key={step.id}>
                <a
                  href={step.href}
                  className={`block rounded-lg border px-3 py-3 transition hover:border-white/30 ${STEP_STATUS_STYLES[step.status]} ${
                    isCurrent ? "ring-1 ring-[var(--accent)]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        Step {index + 1}
                      </p>
                      <p className="mt-1 font-medium text-white">{step.label}</p>
                    </div>
                    <span className="rounded border border-current px-2 py-0.5 text-[11px] font-medium">
                      {statusLabel(step.status)}
                    </span>
                  </div>
                  {isCurrent ? (
                    <p className="mt-2 text-xs text-[var(--muted)]">Current focus</p>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </section>
  );
}
