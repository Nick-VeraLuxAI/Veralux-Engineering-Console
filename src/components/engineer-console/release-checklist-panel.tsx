"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { HardReleaseGateBanner } from "./hard-release-gate-banner";
import { StatusBadge } from "./status-badge";

interface ChecklistItem {
  id: string;
  label: string;
  status: string;
  severity: string;
  summary: string;
  referenceId: string | null;
  referenceHash: string | null;
  recommendedAction: string;
}

interface ChecklistPayload {
  id: string | null;
  runId: string;
  status: string;
  evaluatedAt: string;
  items: ChecklistItem[];
  blockers: string[];
  needsAttention: string[];
  recommendedAction: string;
  evidenceBundleHashPrefix: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function ReleaseChecklistPanel({ runId }: { runId: string }) {
  const [display, setDisplay] = useState<ChecklistPayload | null>(null);
  const [history, setHistory] = useState<ChecklistPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(
      `/api/engineer-console/runs/${runId}/release-checklist`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        latest: ChecklistPayload | null;
        computed: ChecklistPayload;
        history: ChecklistPayload[];
      };
      setDisplay(data.latest ?? data.computed);
      setHistory(data.history);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function evaluateChecklist() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/release-checklist`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checklist evaluation failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading release checklist…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Release checklist</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Advisory summary of release lifecycle readiness. Does not deploy, merge, rollback, or
        trigger CI/CD.
      </p>

      <HardReleaseGateBanner runId={runId} action="deployment_execution" />

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {display && (
        <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[var(--muted)]">Overall status</span>
            <StatusBadge status={display.status} />
            {display.evidenceBundleHashPrefix && (
              <span className="font-mono text-xs text-[var(--muted)]">
                evidence {display.evidenceBundleHashPrefix}…
              </span>
            )}
          </div>
          <p className="text-[var(--muted)]">{display.recommendedAction}</p>
          <p className="mt-2 font-mono text-xs text-[var(--muted)]">
            evaluated {display.evaluatedAt}
            {display.updatedAt && ` · saved ${display.updatedAt}`}
          </p>

          {display.blockers.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-[var(--danger)]">
              {display.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {display.needsAttention.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-amber-300">
              {display.needsAttention.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {display && display.items.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {display.items.map((item) => (
            <li key={item.id} className="rounded border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.label}</span>
                <StatusBadge status={item.status} />
                <span className="text-xs text-[var(--muted)]">{item.severity}</span>
              </div>
              <p className="mt-1 text-[var(--muted)]">{item.summary}</p>
              {item.referenceId && (
                <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                  ref {item.referenceId.slice(0, 8)}…
                  {item.referenceHash && ` · ${item.referenceHash}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void evaluateChecklist()}
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Evaluating…" : "Evaluate checklist"}
      </button>

      {history.length > 1 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Checklist history</h3>
          <ul className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id ?? h.evaluatedAt} className="rounded border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={h.status} />
                  <span className="text-[var(--muted)]">{h.createdAt ?? h.evaluatedAt}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
