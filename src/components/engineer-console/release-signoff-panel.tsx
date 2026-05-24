"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { HardReleaseGateBanner } from "./hard-release-gate-banner";
import { StatusBadge } from "./status-badge";

interface ChecklistSummary {
  status: string;
  evidenceBundleHashPrefix: string | null;
  evaluatedAt?: string;
}

interface SignoffRecord {
  id: string;
  decision: string;
  releaseChecklistStatus: string | null;
  rationale: string | null;
  actorLabel: string | null;
  evidenceBundleHashPrefix: string | null;
  createdAt: string;
  snapshot?: {
    latestDeploymentExecutionStatus: string | null;
    latestHealthPolicyStatus: string | null;
    latestReplayVerificationStatus: string | null;
    latestPolicyResultStatus: string | null;
  };
}

export function ReleaseSignoffPanel({ runId }: { runId: string }) {
  const [checklist, setChecklist] = useState<ChecklistSummary | null>(null);
  const [history, setHistory] = useState<SignoffRecord[]>([]);
  const [decision, setDecision] = useState<
    "completed" | "completed_with_exceptions" | "rejected"
  >("completed");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [checklistRes, signoffRes] = await Promise.all([
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/release-checklist`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/release-signoffs`),
    ]);
    if (checklistRes.ok) {
      const data = (await checklistRes.json()) as {
        latest: ChecklistSummary | null;
        computed: ChecklistSummary & { evaluatedAt: string };
      };
      const src = data.latest ?? data.computed;
      setChecklist({
        status: src.status,
        evidenceBundleHashPrefix: src.evidenceBundleHashPrefix,
        evaluatedAt: "evaluatedAt" in src ? src.evaluatedAt : undefined,
      });
    }
    if (signoffRes.ok) {
      const data = (await signoffRes.json()) as { history: SignoffRecord[] };
      setHistory(data.history);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  const checklistStatus = checklist?.status ?? "unknown";
  const canComplete = checklistStatus === "complete";
  const canExceptions = checklistStatus === "needs_attention";
  const canReject =
    checklistStatus === "blocked" ||
    checklistStatus === "needs_attention" ||
    checklistStatus === "not_started";

  async function submitSignoff() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/release-signoffs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, rationale: rationale.trim() || undefined }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sign-off failed");
      setRationale("");
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
        <p className="text-sm text-[var(--muted)]">Loading release sign-off…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Release sign-off</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Admin-only governance record. Sign-off records completion only — it does not deploy,
        rollback, or trigger CI/CD.
      </p>

      <HardReleaseGateBanner runId={runId} action="release_signoff_completed" />

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[var(--muted)]">Latest checklist</span>
          <StatusBadge status={checklistStatus} />
          {checklist?.evidenceBundleHashPrefix && (
            <span className="font-mono text-xs text-[var(--muted)]">
              evidence {checklist.evidenceBundleHashPrefix}…
            </span>
          )}
        </div>
        {!checklist?.evaluatedAt && checklistStatus === "unknown" && (
          <p className="text-amber-300">
            Evaluate the release checklist before signing off (persisted evaluation required).
          </p>
        )}
      </div>

      <div className="mb-4 space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`signoff-${runId}`}
            checked={decision === "completed"}
            disabled={!canComplete}
            onChange={() => setDecision("completed")}
          />
          Completed (checklist must be complete)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`signoff-${runId}`}
            checked={decision === "completed_with_exceptions"}
            disabled={!canExceptions}
            onChange={() => setDecision("completed_with_exceptions")}
          />
          Completed with exceptions (needs_attention + rationale)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`signoff-${runId}`}
            checked={decision === "rejected"}
            disabled={!canReject}
            onChange={() => setDecision("rejected")}
          />
          Rejected (rationale required)
        </label>
        <textarea
          className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
          rows={3}
          placeholder="Rationale (required for exceptions and rejection)"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void submitSignoff()}
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Recording…" : "Record sign-off"}
      </button>

      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Sign-off history</h3>
          <ul className="space-y-2 text-sm">
            {history.map((s) => (
              <li key={s.id} className="rounded border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={s.decision} />
                  <span className="text-[var(--muted)]">{s.createdAt}</span>
                  {s.actorLabel && <span>· {s.actorLabel}</span>}
                </div>
                {s.rationale && <p className="mt-1 text-[var(--muted)]">{s.rationale}</p>}
                {s.snapshot && (
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                    deploy {s.snapshot.latestDeploymentExecutionStatus ?? "—"} · health policy{" "}
                    {s.snapshot.latestHealthPolicyStatus ?? "—"} · replay{" "}
                    {s.snapshot.latestReplayVerificationStatus ?? "—"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
