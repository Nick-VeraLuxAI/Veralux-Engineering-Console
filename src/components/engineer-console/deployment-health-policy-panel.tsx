"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface HealthPolicyResult {
  id: string;
  status: string;
  environmentName: string | null;
  deploymentExecutionId: string | null;
  healthCheckId: string | null;
  healthProfile: string | null;
  healthCheckStatus: string | null;
  responseStatus: number | null;
  responseTimeMs: number | null;
  warnings: string[];
  blockers: string[];
  recommendedAction: string;
  policyVersion: string;
  policyHashPrefix: string | null;
  evaluatedAt: string;
  actorLabel: string | null;
  createdAt: string;
}

export function DeploymentHealthPolicyPanel({ runId }: { runId: string }) {
  const [latest, setLatest] = useState<HealthPolicyResult | null>(null);
  const [history, setHistory] = useState<HealthPolicyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(
      `/api/engineer-console/runs/${runId}/deployment-health-policy`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        latest: HealthPolicyResult | null;
        history: HealthPolicyResult[];
      };
      setLatest(data.latest);
      setHistory(data.history);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function evaluatePolicy() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-health-policy`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Policy evaluation failed");
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
        <p className="text-sm text-[var(--muted)]">Loading deployment health policy…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Deployment health policy</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Governance interpretation of post-deploy health checks. Metadata only — does not deploy,
        rollback, or trigger CI/CD.
      </p>

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {latest ? (
        <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[var(--muted)]">Latest policy status</span>
            <StatusBadge status={latest.status} />
            {latest.environmentName && <span>· {latest.environmentName}</span>}
          </div>
          <p className="text-[var(--muted)]">{latest.recommendedAction}</p>
          {latest.deploymentExecutionId && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              execution: {latest.deploymentExecutionId.slice(0, 8)}…
              {latest.healthCheckId && ` · health check: ${latest.healthCheckId.slice(0, 8)}…`}
            </p>
          )}
          {latest.healthProfile && (
            <p className="mt-1 text-xs">
              profile: {latest.healthProfile}
              {latest.healthCheckStatus && ` · check: ${latest.healthCheckStatus}`}
              {latest.responseStatus !== null && ` · HTTP ${latest.responseStatus}`}
              {latest.responseTimeMs !== null && ` · ${latest.responseTimeMs}ms`}
            </p>
          )}
          {latest.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-300">
              {latest.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {latest.blockers.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[var(--danger)]">
              {latest.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-mono text-xs text-[var(--muted)]">
            policy v{latest.policyVersion} · {latest.policyHashPrefix}… · {latest.evaluatedAt}
          </p>
        </div>
      ) : (
        <p className="mb-4 text-sm text-[var(--muted)]">
          No health policy evaluation recorded yet. Evaluate after deployment execution or health
          checks.
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void evaluatePolicy()}
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Evaluating…" : "Evaluate health policy"}
      </button>

      {history.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Policy history</h3>
          <ul className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="rounded border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={h.status} />
                  <span className="text-[var(--muted)]">{h.createdAt}</span>
                  {h.actorLabel && <span>· {h.actorLabel}</span>}
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{h.recommendedAction}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
