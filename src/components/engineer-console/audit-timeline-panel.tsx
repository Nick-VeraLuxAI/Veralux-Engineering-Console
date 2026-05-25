"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useEffect, useState } from "react";

interface AuditEventView {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorLabel: string | null;
  chainHashPrefix: string;
  createdAt: string;
}

interface AuditTimelineResponse {
  events: AuditEventView[];
  verification: { ok: boolean; checkedCount: number; failures: string[] };
}

export function AuditTimelinePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<AuditTimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/audit-events`);
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as AuditTimelineResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Audit timeline</h2>
        {data?.verification && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              data.verification.ok
                ? "bg-emerald-950 text-emerald-300"
                : "bg-red-950 text-red-300"
            }`}
          >
            Chain {data.verification.ok ? "verified" : "failed"} (
            {data.verification.checkedCount} events)
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading audit events…</p>}

      {data && data.events.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No audit events recorded for this run yet.</p>
      )}

      {data && data.events.length > 0 && (
        <ol className="max-h-80 space-y-2 overflow-y-auto text-sm">
          {data.events.map((event) => (
            <li
              key={event.id}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium text-white">{event.eventType}</span>
                <time className="text-xs text-[var(--muted)]">
                  {new Date(event.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {event.actorType}
                {event.actorLabel ? ` · ${event.actorLabel}` : ""} · {event.entityType}/
                {event.entityId.slice(0, 8)}… · chain {event.chainHashPrefix}…
              </p>
            </li>
          ))}
        </ol>
      )}

      {data?.verification && !data.verification.ok && data.verification.failures.length > 0 && (
        <ul className="mt-3 list-inside list-disc text-xs text-red-400">
          {data.verification.failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
