"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface PolicyResult {
  id?: string;
  status: string;
  policyVersion: string;
  policyHashPrefix: string;
  summary: string;
  evaluatedAt: string;
  blockers: string[];
  warnings: string[];
  reviewRequired: string[];
  recommendedNextAction: string;
  source?: string;
}

export function PolicyResultsPanel({ runId }: { runId: string }) {
  const [latest, setLatest] = useState<PolicyResult | null>(null);
  const [history, setHistory] = useState<PolicyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/policy-results`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { latest: PolicyResult | null; history: PolicyResult[] };
    setLatest(data.latest);
    setHistory(data.history);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function evaluate() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/policy-results`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Policy evaluation failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Policy results</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => void evaluate()}
          className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
        >
          {busy ? "Evaluating…" : "Evaluate policy"}
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading policy results…</p>}

      {latest && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={latest.status} />
            <span className="font-mono text-xs text-[var(--muted)]">
              v{latest.policyVersion} · {latest.policyHashPrefix}
            </span>
            <span className="text-[var(--muted)]">
              {new Date(latest.evaluatedAt).toLocaleString()}
              {latest.source ? ` · ${latest.source}` : ""}
            </span>
          </div>
          <p className="mb-3 text-sm">{latest.recommendedNextAction}</p>
          {latest.status === "requires_review" && (
            <p className="mb-3 text-sm text-amber-200">
              Senior review is required before approval.
            </p>
          )}

          {latest.blockers.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-medium text-red-300">Blockers</h3>
              <ul className="list-inside list-disc text-sm text-red-200">
                {latest.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {latest.reviewRequired.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-medium text-amber-300">Review required</h3>
              <ul className="list-inside list-disc text-sm text-amber-200">
                {latest.reviewRequired.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {latest.warnings.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-medium text-yellow-300">Warnings</h3>
              <ul className="list-inside list-disc text-sm text-yellow-200">
                {latest.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!loading && !latest && (
        <p className="text-sm text-[var(--muted)]">No policy evaluation yet. Run evaluate policy.</p>
      )}

      {history.length > 1 && (
        <details className="mt-3 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">History ({history.length})</summary>
          <ul className="mt-2 space-y-1">
            {history.slice(1, 6).map((item) => (
              <li key={item.id ?? `${item.evaluatedAt}-${item.status}`}>
                <StatusBadge status={item.status} /> · {new Date(item.evaluatedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
