import React from "react";
import type { RunApprovalActionCardState } from "@/lib/engineer-console/run-ux/run-ux-types";
import { ApprovalActions } from "./approval-actions";

const TONE_STYLES: Record<RunApprovalActionCardState["tone"], string> = {
  ready: "border-emerald-500/40 bg-emerald-950/20",
  blocked: "border-red-500/40 bg-red-950/20",
  warning: "border-amber-500/40 bg-amber-950/20",
  complete: "border-emerald-500/40 bg-emerald-950/20",
};

function GuidanceList({
  title,
  items,
  tone,
}: {
  title: string;
  items: RunApprovalActionCardState["blockers"] | RunApprovalActionCardState["warnings"];
  tone: "danger" | "warning";
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3
        className={`mb-2 text-sm font-medium ${
          tone === "danger" ? "text-red-200" : "text-amber-200"
        }`}
      >
        {title}
      </h3>
      <ul className="space-y-2 text-sm">
        {items.map((item, index) => (
          <li
            key={`${item.text}-${index}`}
            className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
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

export function RunApprovalActionCard({
  runId,
  state,
}: {
  runId: string;
  state: RunApprovalActionCardState;
}) {
  if (!state.showCard) return null;

  return (
    <section
      className={`rounded-xl border p-4 ${TONE_STYLES[state.tone]}`}
      aria-labelledby="run-approval-action-card-heading"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 id="run-approval-action-card-heading" className="text-lg font-semibold">
            Approval actions
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Approval, Request Fix, and Stop Run stay manual and auditable. This card reuses the
            existing approval action handlers and does not change governance authority.
          </p>
        </div>
        <div className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
          <p className="text-[var(--muted)]">Approval available</p>
          <p className="font-medium">{state.approvalAvailable ? "Yes" : "Not yet"}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="space-y-4">
          <div className="rounded border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm text-[var(--muted)]">Current approval state</p>
            <p className="mt-1 text-base font-medium">{state.currentStateLabel}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{state.currentStateDetail}</p>
          </div>

          <div className="rounded border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm text-[var(--muted)]">Next required action</p>
            <p className="mt-1 text-base font-medium">{state.nextRequiredAction}</p>
            <a
              href={state.primaryHref}
              className="mt-3 inline-flex rounded border border-[var(--border)] px-3 py-2 text-sm font-medium"
            >
              {state.primaryLabel}
            </a>
          </div>

          <GuidanceList title="Approval blockers" items={state.blockers} tone="danger" />
          <GuidanceList title="Warnings" items={state.warnings} tone="warning" />
        </div>

        <div className="rounded border border-[var(--border)] bg-[var(--background)] p-4">
          {(state.showApprove || state.showRequestFix || state.showStop) && (
            <ApprovalActions
              runId={runId}
              canApprove={state.approvalAvailable}
              approvalRequiresRationale={state.rationale.approve === "required"}
              showApprove={state.showApprove}
              showRequestFix={state.showRequestFix}
              showStop={state.showStop}
              rationaleGuidance={state.rationale.guidance}
            />
          )}

          {!state.showApprove && !state.showRequestFix && !state.showStop && (
            <p className="text-sm text-[var(--muted)]">
              No approval action is available here right now. Use the linked panel above to review
              the current state.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
