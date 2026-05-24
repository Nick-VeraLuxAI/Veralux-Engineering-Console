"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { HardReleaseGateBanner } from "./hard-release-gate-banner";
import { StatusBadge } from "./status-badge";

interface MergeReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  signals: {
    prRequestId: string | null;
    prRequestStatus: string | null;
    hasApprovedDecision: boolean;
    policyStatus: string | null;
    replayStatus: string | null;
    reviewStagesPending: number;
    prMerged: boolean;
  };
}

interface MergeRequest {
  id: string;
  status: string;
  readinessStatus: string;
  prUrl: string | null;
  prNumber: string | null;
  mergeShaPrefix: string | null;
  evidenceBundleHashPrefix: string | null;
  actorLabel: string | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface PrRequestOption {
  id: string;
  status: string;
  prUrl: string | null;
  prNumber: string | null;
}

export function MergeControlsPanel({ runId }: { runId: string }) {
  const [readiness, setReadiness] = useState<MergeReadiness | null>(null);
  const [requests, setRequests] = useState<MergeRequest[]>([]);
  const [prOptions, setPrOptions] = useState<PrRequestOption[]>([]);
  const [selectedPrRequestId, setSelectedPrRequestId] = useState("");
  const [mergeMethod, setMergeMethod] = useState<"squash" | "merge">("squash");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const [mergeRes, prRes] = await Promise.all([
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/merge-requests`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/pr-requests`),
    ]);
    if (!mergeRes.ok) {
      const body = (await mergeRes.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${mergeRes.status}`);
    }
    const mergeData = (await mergeRes.json()) as { requests: MergeRequest[] };
    setRequests(mergeData.requests);

    if (prRes.ok) {
      const prData = (await prRes.json()) as { requests: PrRequestOption[] };
      const created = prData.requests.filter((r) => r.status === "pr_created");
      setPrOptions(created);
      setSelectedPrRequestId((prev) => prev || created[0]?.id || "");
    }
  }, [runId]);

  const load = useCallback(async () => {
    await loadHistory();
    setError(null);
  }, [loadHistory]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function evaluateReadiness() {
    if (!selectedPrRequestId) {
      setError("Select a PR request to evaluate merge readiness.");
      return;
    }
    setBusy("evaluate");
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/merge-readiness?prRequestId=${encodeURIComponent(selectedPrRequestId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Merge readiness evaluation failed");
      setReadiness(data.readiness as MergeReadiness);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function mergePr() {
    if (!selectedPrRequestId) {
      setError("Select a PR request to merge.");
      return;
    }
    setBusy("merge");
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/merge-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prRequestId: selectedPrRequestId,
          mergeMethod,
          rationale: rationale.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Merge failed");
      setReadiness(null);
      setRationale("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const mergeBlocked = readiness?.status === "blocked";
  const mergeNeedsRationale = readiness?.status === "requires_review";

  if (loading) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading merge controls…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Merge controls</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Admin-only, readiness-gated PR merge. No deployment or auto-merge.
      </p>

      <HardReleaseGateBanner runId={runId} action="merge" />

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {prOptions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No created pull request for this run. Complete PR creation first.
        </p>
      ) : (
        <>
          <label className="mb-3 block text-sm">
            PR request
            <select
              value={selectedPrRequestId}
              onChange={(e) => {
                setSelectedPrRequestId(e.target.value);
                setReadiness(null);
              }}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {prOptions.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  #{pr.prNumber ?? "?"} · {pr.status}
                  {pr.prUrl ? ` · ${pr.prUrl}` : ""}
                </option>
              ))}
            </select>
          </label>

          {readiness && (
            <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[var(--muted)]">Readiness</span>
                <StatusBadge status={readiness.status} />
              </div>
              <p className="text-[var(--muted)]">{readiness.recommendedAction}</p>
              {readiness.blockers.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[var(--danger)]">
                  {readiness.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {readiness.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-amber-300">
                  {readiness.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void evaluateReadiness()}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              {busy === "evaluate" ? "Evaluating…" : "Evaluate merge readiness"}
            </button>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Merge method
              <select
                value={mergeMethod}
                onChange={(e) => setMergeMethod(e.target.value as "squash" | "merge")}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
              >
                <option value="squash">Squash merge (default)</option>
                <option value="merge">Merge commit</option>
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              Rationale {mergeNeedsRationale ? "(required)" : "(optional)"}
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!!busy || mergeBlocked || !readiness || readiness.status === "blocked"}
            onClick={() => void mergePr()}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "merge" ? "Merging…" : "Merge PR"}
          </button>
          {mergeBlocked && (
            <p className="mt-2 text-xs text-[var(--muted)]">Merge is disabled while readiness is blocked.</p>
          )}
        </>
      )}

      {requests.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Merge history</h3>
          <ul className="space-y-2 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="rounded border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-[var(--muted)]">{r.createdAt}</span>
                  {r.actorLabel && <span>· {r.actorLabel}</span>}
                </div>
                {r.prUrl && (
                  <a href={r.prUrl} className="mt-1 block text-[var(--accent)]" target="_blank" rel="noreferrer">
                    {r.prUrl}
                  </a>
                )}
                {r.mergeShaPrefix && (
                  <p className="mt-1 font-mono text-xs">merge:{r.mergeShaPrefix}…</p>
                )}
                {r.errorMessage && <p className="mt-1 text-[var(--danger)]">{r.errorMessage}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
