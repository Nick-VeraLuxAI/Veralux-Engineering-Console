"use client";

import React, { useCallback, useEffect, useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import type { HermesWorkerEvidenceSummary } from "@/lib/engineer-console/hermes-worker/hermes-evidence-types";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";

const DECISIONS = ["approved", "needs_changes", "blocked", "rejected"] as const;

interface ReviewSignoffPublic {
  id: string;
  runId: string;
  decision: string;
  reviewer: string;
  reason: string;
  evidenceSnapshotHash: string;
  createdAt: string;
  notMerge: true;
  notDeploy: true;
}

interface HermesEvidenceSummary {
  patchProposal: HermesWorkerEvidenceSummary["patchProposal"];
  patchApplication: HermesWorkerEvidenceSummary["patchApplication"];
  postApplyQualityGates: HermesWorkerEvidenceSummary["postApplyQualityGates"];
}

export function EngineeringReviewSignoffPanel({ runId }: { runId: string }) {
  const [evidence, setEvidence] = useState<HermesEvidenceSummary | null>(null);
  const [latest, setLatest] = useState<ReviewSignoffPublic | null>(null);
  const [history, setHistory] = useState<ReviewSignoffPublic[]>([]);
  const [decision, setDecision] = useState<(typeof DECISIONS)[number]>("needs_changes");
  const [reviewer, setReviewer] = useState("operator");
  const [reason, setReason] = useState("");
  const [qualityGateOverride, setQualityGateOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [evidenceRes, signoffRes] = await Promise.all([
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/hermes-worker/evidence`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/review-signoff`),
    ]);

    if (evidenceRes.ok) {
      const body = (await evidenceRes.json()) as { summary: HermesWorkerEvidenceSummary };
      setEvidence({
        patchProposal: body.summary.patchProposal,
        patchApplication: body.summary.patchApplication,
        postApplyQualityGates: body.summary.postApplyQualityGates,
      });
    }

    if (signoffRes.ok) {
      const body = (await signoffRes.json()) as {
        latest: ReviewSignoffPublic | null;
        history: ReviewSignoffPublic[];
      };
      setLatest(body.latest);
      setHistory(body.history);
    }
  }, [runId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load review context");
    });
  }, [load]);

  async function handleSubmit() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Review reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/review-signoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reviewer: reviewer.trim() || "operator",
            reason: trimmedReason,
            qualityGateOverride,
          }),
        },
      );
      const body = (await res.json()) as { error?: string; evidenceSnapshotHash?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        `Review sign-off recorded (${decision}). Snapshot ${body.evidenceSnapshotHash?.slice(0, 12) ?? "—"}… — not merge or deploy.`,
      );
      setReason("");
      setQualityGateOverride(false);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Review sign-off failed");
    } finally {
      setBusy(false);
    }
  }

  const gates = evidence?.postApplyQualityGates;

  return (
    <Surface as="section" id="engineering-review-signoff" className="scroll-mt-28" tabIndex={-1}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Engineering review sign-off</h2>
        <Badge variant="muted">Console only</Badge>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Record an explicit engineering review decision based on Hermes evidence, patch application,
        rollback state, and post-apply quality gates. Review sign-off is not merge. Review sign-off
        is not deploy. Approved means ready for the next governed phase.
      </p>

      {message ? <p className="mb-2 text-sm text-[var(--success)]">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
        <p className="mb-2 font-medium">Current evidence summary</p>
        <ul className="space-y-1 text-xs text-[var(--muted)]">
          <li>
            Patch proposal:{" "}
            {evidence?.patchProposal?.available
              ? evidence.patchProposal.status ?? "available"
              : "none"}
          </li>
          <li>Patch application: {evidence?.patchApplication?.status ?? "not_applied"}</li>
          <li>
            Rollback:{" "}
            {evidence?.patchApplication?.status === "rolled_back"
              ? `yes (${evidence.patchApplication.rolledBackAt ?? "—"})`
              : "no"}
          </li>
          <li>
            Quality gates: {gates?.status ?? "not_run"}
            {gates?.status === "completed"
              ? ` · overall ${gates.overallStatus ?? "—"} · passed ${gates.passedCount} failed ${gates.failedCount}`
              : ""}
          </li>
        </ul>
      </div>

      {latest ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm">
          <p className="mb-2 font-medium">Latest review decision</p>
          <p className="text-[var(--muted)]">
            {latest.decision} by {latest.reviewer} at {latest.createdAt}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">reason: {latest.reason}</p>
          <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">
            evidence hash: {latest.evidenceSnapshotHash}
          </p>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-[var(--border)] pt-3">
        <label className="block text-xs font-medium" htmlFor="review-decision">
          Decision
        </label>
        <select
          id="review-decision"
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
          value={decision}
          onChange={(e) => setDecision(e.target.value as (typeof DECISIONS)[number])}
          disabled={busy}
        >
          {DECISIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <label className="block text-xs font-medium" htmlFor="review-reviewer">
          Reviewer
        </label>
        <input
          id="review-reviewer"
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          disabled={busy}
        />

        <label className="block text-xs font-medium" htmlFor="review-reason">
          Reason (required)
        </label>
        <textarea
          id="review-reason"
          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Summarize evidence reviewed and why this decision is appropriate."
          disabled={busy}
        />

        {decision === "approved" ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={qualityGateOverride}
              onChange={(e) => setQualityGateOverride(e.target.checked)}
              disabled={busy}
            />
            Override quality gate requirement (document in reason)
          </label>
        ) : null}

        <button
          type="button"
          className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          disabled={busy || !reason.trim()}
          onClick={() => void handleSubmit()}
        >
          {busy ? "Submitting…" : "Submit review sign-off"}
        </button>
      </div>

      {history.length > 1 ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-[var(--muted)]">Prior review history</summary>
          <ul className="mt-2 space-y-2">
            {history.slice(1).map((row) => (
              <li
                key={row.id}
                className="rounded border border-[var(--border)] p-2 font-mono text-xs text-[var(--muted)]"
              >
                {row.createdAt}: {row.decision} — {row.reviewer}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Surface>
  );
}
