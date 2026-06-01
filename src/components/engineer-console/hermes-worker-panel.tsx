"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { useCallback, useEffect, useState } from "react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";

interface HermesDispatchPublic {
  id: string;
  runId: string;
  status: string;
  packetHash: string;
  exportPath: string | null;
  evidencePlaceholderPath: string;
  preparedAt: string;
  dispatchedAt: string | null;
  workerBackend: string;
}

export function HermesWorkerPanel({ runId }: { runId: string }) {
  const [dispatches, setDispatches] = useState<HermesDispatchPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"prepare" | "dispatch" | null>(null);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/hermes-worker`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { dispatches: HermesDispatchPublic[] };
    setDispatches(body.dispatches);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load Hermes dispatches");
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function handlePrepare() {
    setBusy("prepare");
    setMessage(null);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/hermes-worker/prepare`,
        { method: "POST" },
      );
      const body = (await res.json()) as { error?: string; dispatch?: HermesDispatchPublic };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage("Hermes run packet prepared. Review hash and evidence placeholder before export.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Prepare failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDispatch(latestPreparedId?: string) {
    setBusy("dispatch");
    setMessage(null);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/hermes-worker/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            latestPreparedId ? { dispatchId: latestPreparedId } : {},
          ),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        exportPath?: string;
        dispatch?: HermesDispatchPublic;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        body.exportPath
          ? `Exported Hermes run packet to inbox (file handoff only): ${body.exportPath}`
          : "Dispatched to Hermes inbox.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setBusy(null);
    }
  }

  const latestPrepared = dispatches.find((d) => d.status === "prepared");

  return (
    <Surface as="section" id="hermes-worker" className="scroll-mt-28" tabIndex={-1}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Hermes worker (governed handoff)</h2>
        <Badge variant="muted">Console only</Badge>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Prepare a bounded run packet from this Engineering Console run and optionally export it to
        the Hermes inbox. This does not execute Hermes or bypass Console gates. Hermes output is
        evidence input only; sign-off stays in Engineering Console.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void handlePrepare()}
        >
          {busy === "prepare" ? "Preparing…" : "Prepare Hermes run"}
        </button>
        <button
          type="button"
          className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void handleDispatch(latestPrepared?.id)}
        >
          {busy === "dispatch" ? "Exporting…" : "Dispatch to Hermes (export packet)"}
        </button>
      </div>

      {message ? <p className="mb-2 text-sm text-[var(--success)]">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading Hermes handoffs…</p>
      ) : dispatches.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No Hermes dispatches yet. Requires a valid worker plan on this run.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {dispatches.map((d) => (
            <li
              key={d.id}
              className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 font-mono text-xs"
            >
              <div>
                <span className="text-[var(--muted)]">status</span> {d.status}
              </div>
              <div>
                <span className="text-[var(--muted)]">backend</span> {d.workerBackend}
              </div>
              <div className="break-all">
                <span className="text-[var(--muted)]">packet hash</span> {d.packetHash}
              </div>
              {d.exportPath ? (
                <div className="break-all">
                  <span className="text-[var(--muted)]">export</span> {d.exportPath}
                </div>
              ) : null}
              <div className="break-all">
                <span className="text-[var(--muted)]">evidence placeholder</span>{" "}
                {d.evidencePlaceholderPath}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
