"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface ReviewStage {
  id: string;
  stage: string;
  status: string;
  required: boolean;
  reason: string | null;
  reviewerActorLabel: string | null;
  reviewerNotes: string | null;
  evidenceBundleHashPrefix: string | null;
  policyResultId: string | null;
  policyVersion: string | null;
  completedAt: string | null;
}

interface ReviewStageSummary {
  requiredCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  skippedCount: number;
}

function formatStageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}

export function ReviewStagesPanel({ runId }: { runId: string }) {
  const [stages, setStages] = useState<ReviewStage[]>([]);
  const [summary, setSummary] = useState<ReviewStageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [actorLabel, setActorLabel] = useState("operator");

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-stages`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { stages: ReviewStage[]; summary: ReviewStageSummary };
    setStages(data.stages);
    setSummary(data.summary);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function generateStages() {
    setBusy("generate");
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-stages/generate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stage generation failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAction(stageId: string, action: "approve" | "reject" | "skip") {
    if ((action === "reject" || action === "skip") && !rationale.trim()) {
      setError("Rationale is required for reject and skip actions.");
      return;
    }

    setBusy(`${action}-${stageId}`);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/review-stages/${stageId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, rationale, actorLabel }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Stage action failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const blocksApproval =
    summary !== null &&
    (summary.pendingCount > 0 || summary.rejectedCount > 0);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Review stages</h2>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void generateStages()}
          className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
        >
          {busy === "generate" ? "Generating…" : "Generate / reconcile"}
        </button>
      </div>

      {blocksApproval && (
        <p className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-200">
          Final approval is blocked until all required review stages are approved.
          {summary!.rejectedCount > 0 && " One or more required stages were rejected."}
        </p>
      )}

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-[var(--muted)]">Loading review stages…</p>}

      {!loading && stages.length === 0 && (
        <p className="text-sm text-[var(--muted)]">
          No review stages yet. Generate stages after policy evaluation.
        </p>
      )}

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-[var(--muted)]">
          Actor label
          <input
            value={actorLabel}
            onChange={(e) => setActorLabel(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-[var(--muted)] sm:col-span-2">
          Rationale (required for reject / skip)
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="space-y-3">
        {stages.map((stage) => (
          <div key={stage.id} className="rounded border border-[var(--border)] p-3 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-medium capitalize">{formatStageLabel(stage.stage)}</span>
              <StatusBadge status={stage.status} />
              <span className="text-xs text-[var(--muted)]">
                {stage.required ? "required" : "optional"}
              </span>
            </div>
            {stage.reason && <p className="mb-2 text-[var(--muted)]">{stage.reason}</p>}
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              {stage.evidenceBundleHashPrefix && (
                <span>evidence {stage.evidenceBundleHashPrefix}</span>
              )}
              {stage.policyVersion && <span>policy v{stage.policyVersion}</span>}
              {stage.reviewerActorLabel && <span>reviewer {stage.reviewerActorLabel}</span>}
            </div>
            {stage.reviewerNotes && (
              <p className="mb-2 text-xs italic text-[var(--muted)]">{stage.reviewerNotes}</p>
            )}
            {stage.status === "pending" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleAction(stage.id, "approve")}
                  disabled={busy !== null}
                  className="rounded border border-green-500/50 px-2 py-1 text-green-300 disabled:opacity-50"
                >
                  Approve stage
                </button>
                <button
                  type="button"
                  onClick={() => void handleAction(stage.id, "reject")}
                  disabled={busy !== null}
                  className="rounded border border-red-500/50 px-2 py-1 text-red-300 disabled:opacity-50"
                >
                  Reject
                </button>
                {!stage.required && (
                  <button
                    type="button"
                    onClick={() => void handleAction(stage.id, "skip")}
                    disabled={busy !== null}
                    className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
                  >
                    Skip
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
