"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface ReplayCheck {
  code: string;
  status: string;
  message: string;
}

interface ReplayVerification {
  ok: boolean;
  runId: string;
  checkedAt: string;
  status: string;
  checks: ReplayCheck[];
  summary: { passed: number; warnings: number; failed: number };
}

export function ReplayVerificationPanel({ runId }: { runId: string }) {
  const [verification, setVerification] = useState<ReplayVerification | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [packageJson, setPackageJson] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/replay-verification`);
    if (res.status === 404) {
      setVerification(null);
      return;
    }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { verification: ReplayVerification; source?: string };
    setVerification(data.verification);
    setSource(data.source ?? null);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/replay-verification`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setVerification(data.verification as ReplayVerification);
      setSource(data.source ?? "stored");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadPackage() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/replay-package`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load replay package");
      setPackageJson(JSON.stringify(data.replayPackage, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Replay verification</h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void verify()}
            className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify replay"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void loadPackage()}
            className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
          >
            View package
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading verification…</p>}

      {verification && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={verification.status} />
            <span className="text-[var(--muted)]">
              {new Date(verification.checkedAt).toLocaleString()}
              {source ? ` · ${source}` : ""}
            </span>
            <span>
              passed {verification.summary.passed} · warnings {verification.summary.warnings} · failed{" "}
              {verification.summary.failed}
            </span>
          </div>
          <ul className="max-h-48 space-y-2 overflow-auto text-xs">
            {verification.checks.map((check, index) => (
              <li
                key={`${check.code}-${index}`}
                className="rounded border border-[var(--border)] p-2"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <code>{check.code}</code>
                  <StatusBadge status={check.status} />
                </div>
                <p>{check.message}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {packageJson && (
        <pre className="mt-3 max-h-64 overflow-auto rounded bg-[var(--background)] p-3 text-xs">
          {packageJson}
        </pre>
      )}
    </section>
  );
}
