"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";

import { useCallback, useEffect, useState } from "react";
import { OperatorHelp } from "./operator-help";
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
    <Surface as="section">
      <SectionHeader
        title="Policy results"
        description="Review the latest governance result and escalation requirements without changing approval authority."
        meta={<OperatorHelp term="governance_policy" label="What is governance policy?" />}
        actions={
          <Button disabled={busy} onClick={() => void evaluate()} size="sm" variant="secondary">
            {busy ? "Evaluating…" : "Evaluate policy"}
          </Button>
        }
      />

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {loading && <p className="mt-4 text-sm text-[var(--muted)]">Loading policy results…</p>}

      {latest && (
        <>
          <Surface className="mt-4 text-sm" padding="sm" variant="inset">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={latest.status} />
              <span className="font-mono text-xs text-[var(--muted)]">
                v{latest.policyVersion} · {latest.policyHashPrefix}
              </span>
              <span className="text-[var(--muted)]">
                {new Date(latest.evaluatedAt).toLocaleString()}
                {latest.source ? ` · ${latest.source}` : ""}
              </span>
            </div>
            <p className="mt-3">{latest.recommendedNextAction}</p>
          </Surface>
          {latest.status === "requires_review" && (
            <Surface className="mt-4 text-sm text-amber-100" padding="sm" variant="warning">
              <p>
                Senior review is required before approval. Complete the required review stages in{" "}
                <a href="#review-stages" className="underline underline-offset-2">
                  Review stages
                </a>
                .
              </p>
            </Surface>
          )}

          {latest.blockers.length > 0 && (
            <Surface className="mt-4" padding="sm" variant="danger">
              <h3 className="text-xs font-medium text-red-100">Blockers</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-100">
                {latest.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Surface>
          )}

          {latest.reviewRequired.length > 0 && (
            <Surface className="mt-4" padding="sm" variant="warning">
              <h3 className="text-xs font-medium text-amber-100">Review required</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-100">
                {latest.reviewRequired.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Surface>
          )}

          {latest.warnings.length > 0 && (
            <Surface className="mt-4" padding="sm" variant="warning">
              <h3 className="text-xs font-medium text-amber-100">Warnings</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-amber-100">
                {latest.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Surface>
          )}
        </>
      )}

      {!loading && !latest && (
        <div className="mt-4">
          <EmptyState
            compact
            title="No policy evaluation yet"
            description="Evaluate policy to see whether approval is ready, requires senior review, or is blocked."
          />
        </div>
      )}

      {history.length > 1 && (
        <details className="mt-4 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">History ({history.length})</summary>
          <ul className="mt-3 space-y-2">
            {history.slice(1, 6).map((item) => (
              <li key={item.id ?? `${item.evaluatedAt}-${item.status}`}>
                <Surface padding="sm" variant="inset">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span>{new Date(item.evaluatedAt).toLocaleString()}</span>
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Surface>
  );
}
