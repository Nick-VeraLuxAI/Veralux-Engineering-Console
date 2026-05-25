import React from "react";
import type { SetupReadinessSummary, SetupReadinessStatus } from "@/lib/engineer-console/setup/setup-ux";
import { OperatorHelp } from "./operator-help";

const STATUS_STYLES: Record<SetupReadinessStatus, string> = {
  ready: "border-emerald-500/40 bg-emerald-950/20 text-emerald-200",
  warning: "border-amber-500/40 bg-amber-950/20 text-amber-200",
  missing: "border-red-500/40 bg-red-950/20 text-red-200",
  not_checked: "border-[var(--border)] bg-[var(--background)] text-[var(--muted)]",
};

export function SetupReadinessPanel({
  summary,
}: {
  summary: SetupReadinessSummary;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Setup readiness</h2>
          <OperatorHelp term="setup_readiness" label="What is setup readiness?" />
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Read-only checks that show whether setup, onboarding, or staging work can start safely.
          Secrets are never shown here.
        </p>
      </div>

      <ul className="space-y-3">
        {summary.items.map((item) => (
          <li key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="max-w-3xl">
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{item.detail}</p>
                {item.nextAction ? (
                  <p className="mt-2 text-xs">
                    <span className="text-[var(--muted)]">Next action: </span>
                    {item.nextAction}
                  </p>
                ) : null}
              </div>
              <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[item.status]}`}>
                {item.status.replace(/_/g, " ")}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted)]">
        <p className="font-medium text-white">Reference docs</p>
        <p className="mt-2">
          Use <code>docs/operator-runbook.md</code>, <code>docs/env-reference.md</code>,{" "}
          <code>docs/staging-dry-run-checklist.md</code>, <code>docs/production-launch-checklist.md</code>,
          <code>docs/offhost-encrypted-backups.md</code>, and <code>docs/operator-glossary.md</code>.
        </p>
      </div>
    </section>
  );
}
