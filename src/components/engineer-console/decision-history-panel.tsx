"use client";

import { useCallback, useEffect, useState } from "react";

interface DecisionRecordPublic {
  id: string;
  decision: string;
  actorType: string;
  actorLabel: string | null;
  rationale: string | null;
  evidenceBundleHash: string | null;
  riskLevel: string | null;
  qualityGateState: string | null;
  auditChainHashPrefix: string | null;
  createdAt: string;
}

interface DecisionRecordsResponse {
  decisionRecords: DecisionRecordPublic[];
}

export function DecisionHistoryPanel({ runId }: { runId: string }) {
  const [records, setRecords] = useState<DecisionRecordPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/engineer-console/runs/${runId}/decision-records`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as DecisionRecordsResponse;
    setRecords(data.decisionRecords);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-3 font-semibold">Decision history</h2>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading decisions…</p>}
      {!loading && records.length === 0 && !error && (
        <p className="text-sm text-[var(--muted)]">No operator decisions recorded yet.</p>
      )}
      {!loading && records.length > 0 && (
        <ul className="space-y-3">
          {records.map((r) => (
            <li key={r.id} className="rounded border border-[var(--border)] p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium capitalize">{r.decision.replace("_", " ")}</span>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {r.actorType}
                {r.actorLabel ? ` · ${r.actorLabel}` : ""}
              </p>
              {r.rationale && (
                <p className="mt-2 text-sm">
                  <span className="text-[var(--muted)]">Rationale: </span>
                  {r.rationale}
                </p>
              )}
              <dl className="mt-2 grid gap-1 text-xs text-[var(--muted)]">
                {r.evidenceBundleHash && (
                  <div>
                    <span>Evidence hash: </span>
                    <code className="break-all">{r.evidenceBundleHash.slice(0, 16)}…</code>
                  </div>
                )}
                {r.riskLevel && <div>Risk: {r.riskLevel}</div>}
                {r.qualityGateState && <div>Gates: {r.qualityGateState}</div>}
                {r.auditChainHashPrefix && (
                  <div>
                    Audit chain: <code>{r.auditChainHashPrefix}</code>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
