"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface PrReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  signals: {
    hasApprovedDecision: boolean;
    hasEvidenceBundle: boolean;
    policyStatus: string | null;
    replayStatus: string | null;
    reviewStagesApproved: number;
    reviewStagesPending: number;
    reviewStagesRejected: number;
    changedFileCount: number;
    branchName: string | null;
  };
}

interface PrRequest {
  id: string;
  status: string;
  readinessStatus: string;
  branchName: string;
  baseBranch: string;
  commitShaPrefix: string | null;
  prUrl: string | null;
  prNumber: string | null;
  evidenceBundleHashPrefix: string | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export function PrCreationPanel({ runId }: { runId: string }) {
  const [readiness, setReadiness] = useState<PrReadiness | null>(null);
  const [requests, setRequests] = useState<PrRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [draft, setDraft] = useState(true);
  const [actorLabel, setActorLabel] = useState("operator");
  const [rationale, setRationale] = useState("");

  const loadHistory = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/pr-requests`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { requests: PrRequest[] };
    setRequests(data.requests);
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
    setBusy("evaluate");
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/pr-readiness`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Readiness evaluation failed");
      setReadiness(data.readiness as PrReadiness);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function createPr() {
    setBusy("create");
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/pr-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorLabel, baseBranch, draft, rationale }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.readiness) setReadiness(data.readiness as PrReadiness);
        throw new Error(data.error ?? "PR creation failed");
      }
      await loadHistory();
      await evaluateReadiness();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const blocked = readiness?.status === "blocked";
  const needsRationale = readiness?.status === "requires_review";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">PR creation</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void evaluateReadiness()}
            className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
          >
            {busy === "evaluate" ? "Evaluating…" : "Evaluate readiness"}
          </button>
          <button
            type="button"
            disabled={busy !== null || blocked || !readiness}
            onClick={() => void createPr()}
            className="rounded border border-green-500/50 px-3 py-1 text-xs text-green-300 disabled:opacity-50"
          >
            {busy === "create" ? "Creating…" : "Create draft PR"}
          </button>
        </div>
      </div>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading PR history…</p>}

      {readiness && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={readiness.status} />
            <span className="text-[var(--muted)]">{readiness.recommendedAction}</span>
          </div>

          {readiness.blockers.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-medium text-red-300">Blockers</h3>
              <ul className="list-inside list-disc text-sm text-red-200">
                {readiness.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {readiness.warnings.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1 text-xs font-medium text-amber-300">Warnings</h3>
              <ul className="list-inside list-disc text-sm text-amber-200">
                {readiness.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          <dl className="mb-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
            <div>
              <dt>Branch</dt>
              <dd className="font-mono">{readiness.signals.branchName ?? "—"}</dd>
            </div>
            <div>
              <dt>Changed files</dt>
              <dd>{readiness.signals.changedFileCount}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{readiness.signals.policyStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>Replay</dt>
              <dd>{readiness.signals.replayStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>Review stages</dt>
              <dd>
                {readiness.signals.reviewStagesApproved} approved ·{" "}
                {readiness.signals.reviewStagesPending} pending ·{" "}
                {readiness.signals.reviewStagesRejected} rejected
              </dd>
            </div>
          </dl>
        </>
      )}

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-[var(--muted)]">
          Base branch
          <input
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-end gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          Open as draft PR
        </label>
        <label className="text-xs text-[var(--muted)]">
          Actor label
          <input
            value={actorLabel}
            onChange={(e) => setActorLabel(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-[var(--muted)] sm:col-span-2">
          Rationale {needsRationale ? "(required)" : "(optional)"}
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
      </div>

      {requests.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">PR history</h3>
          <ul className="space-y-2 text-sm">
            {requests.map((req) => (
              <li key={req.id} className="rounded border border-[var(--border)] p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={req.status} />
                  <span className="font-mono text-xs">{req.commitShaPrefix ?? "—"}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(req.createdAt).toLocaleString()}
                  </span>
                </div>
                {req.prUrl && (
                  <a
                    href={req.prUrl}
                    className="mt-1 block text-xs text-blue-300 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {req.prUrl}
                  </a>
                )}
                {req.errorMessage && (
                  <p className="mt-1 text-xs text-red-300">{req.errorMessage}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
