import React from "react";
import type { PrStateCardState } from "@/lib/engineer-console/release/pr-creation/pr-state-ux";

function StateTile({
  title,
  value,
}: {
  title: string;
  value: { label: string; detail: string };
}) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
      <p className="text-[var(--muted)]">{title}</p>
      <p className="mt-1 font-medium">{value.label}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">{value.detail}</p>
    </div>
  );
}

export function PrStateCard({ state }: { state: PrStateCardState }) {
  return (
    <section className="mb-4 rounded border border-[var(--border)] bg-[var(--background)] p-4">
      <h3 className="font-medium">PR state</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Plain-English retry and recovery guidance. Raw request history remains available below.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StateTile title="Readiness" value={state.readiness} />
        <StateTile title="Commit state" value={state.commit} />
        <StateTile title="Branch state" value={state.branch} />
        <StateTile title="PR state" value={state.pr} />
      </div>

      <div className="mt-4 rounded border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted)]">Next action</p>
        <p className="mt-1 text-base font-medium">{state.nextAction.label}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{state.nextAction.detail}</p>
      </div>

      {state.retryGuidance && (
        <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-4">
          <h4 className="text-sm font-medium text-amber-100">Retry guidance</h4>
          <p className="mt-2 text-sm text-amber-50">
            Last failed step: <strong>{state.retryGuidance.lastFailedStep}</strong>
          </p>
          <p className="mt-1 text-sm text-amber-50">{state.retryGuidance.failureReason}</p>
          {state.retryGuidance.succeeded.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-amber-50">
              {state.retryGuidance.succeeded.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-amber-50">{state.retryGuidance.nextRetryStep}</p>
          <p className="mt-1 text-sm text-amber-100">{state.retryGuidance.duplicateProtection}</p>
        </div>
      )}

      {state.existingPr && (
        <div className="mt-4 rounded border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">Existing PR detected</p>
          <a
            href={state.existingPr.url}
            className="mt-2 block text-[var(--accent)] underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            {state.existingPr.url}
          </a>
          <p className="mt-1 text-xs text-[var(--muted)]">
            PR #{state.existingPr.number ?? "?"} · {state.existingPr.stateLabel}
          </p>
        </div>
      )}

      <details className="mt-4 text-xs text-[var(--muted)]">
        <summary className="cursor-pointer">Technical details</summary>
        <ul className="mt-2 space-y-1">
          <li>raw readiness status: {state.rawStatuses.readinessStatus ?? "not evaluated"}</li>
          <li>raw request status: {state.rawStatuses.requestStatus ?? "none"}</li>
          <li>base branch: {state.rawStatuses.baseBranch ?? "not selected"}</li>
        </ul>
      </details>
    </section>
  );
}
