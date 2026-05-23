"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface HealthProfile {
  name: string;
  environmentName: string;
  type: string;
  enabled: boolean;
  hostname: string | null;
}

interface DeploymentExecution {
  id: string;
  deploymentProfile: string;
  environmentName: string | null;
  status: string;
  completedAt: string | null;
  createdAt: string;
}

interface HealthReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
}

interface HealthCheck {
  id: string;
  healthProfile: string;
  status: string;
  hostname: string | null;
  responseStatus: number | null;
  responseTimeMs: number | null;
  outputSummary: string | null;
  outputHashPrefix: string | null;
  errorMessage: string | null;
  actorLabel: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function DeploymentHealthChecksPanel({ runId }: { runId: string }) {
  const [profiles, setProfiles] = useState<HealthProfile[]>([]);
  const [executions, setExecutions] = useState<DeploymentExecution[]>([]);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [readiness, setReadiness] = useState<HealthReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const succeededExecutions = executions.filter((e) => e.status === "succeeded");

  const load = useCallback(async () => {
    const [profileRes, execRes, checkRes] = await Promise.all([
      engineerConsoleFetch("/api/engineer-console/deployment/health-profiles"),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/deployment-executions`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/deployment-health-checks`),
    ]);

    if (profileRes.ok) {
      const data = (await profileRes.json()) as { profiles: HealthProfile[] };
      setProfiles(data.profiles.filter((p) => p.enabled));
    }

    if (execRes.ok) {
      const data = (await execRes.json()) as { executions: DeploymentExecution[] };
      const succeeded = data.executions.filter((e) => e.status === "succeeded");
      setExecutions(succeeded);
      setSelectedExecutionId((prev) => prev || succeeded[0]?.id || "");
    }

    if (checkRes.ok) {
      const data = (await checkRes.json()) as { checks: HealthCheck[] };
      setChecks(data.checks);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  const selectedExecution = succeededExecutions.find((e) => e.id === selectedExecutionId);
  const profilesForEnv = profiles.filter(
    (p) => p.environmentName === selectedExecution?.environmentName,
  );

  useEffect(() => {
    setSelectedProfile((prev) => {
      if (prev && profilesForEnv.some((p) => p.name === prev)) return prev;
      return profilesForEnv[0]?.name ?? "";
    });
  }, [profilesForEnv]);

  useEffect(() => {
    if (!selectedExecutionId || !selectedProfile) {
      setReadiness(null);
      return;
    }
    void (async () => {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-health-checks?deploymentExecutionId=${encodeURIComponent(selectedExecutionId)}&healthProfile=${encodeURIComponent(selectedProfile)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { readiness: HealthReadiness | null };
        setReadiness(data.readiness);
      }
    })();
  }, [runId, selectedExecutionId, selectedProfile]);

  async function runHealthCheck() {
    if (!selectedExecutionId || !selectedProfile) {
      setError("Select a successful deployment execution and health profile.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-health-checks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deploymentExecutionId: selectedExecutionId,
            healthProfile: selectedProfile,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Health check failed");
      setReadiness(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const checkBlocked = readiness?.status === "blocked";

  if (loading) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading deployment health checks…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Deployment health checks</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Read-only HTTP verification after a successful deployment. Uses configured health profiles
        only. Does not rollback or retry deployment automatically.
      </p>

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {succeededExecutions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No successful deployment execution for this run. Complete controlled deployment first.
        </p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No health check profiles configured. Set ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON on
          the server.
        </p>
      ) : (
        <>
          <label className="mb-3 block text-sm">
            Successful deployment execution
            <select
              value={selectedExecutionId}
              onChange={(e) => {
                setSelectedExecutionId(e.target.value);
                setReadiness(null);
              }}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {succeededExecutions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.deploymentProfile} · {e.environmentName} · {e.completedAt ?? e.createdAt}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-3 block text-sm">
            Health profile
            <select
              value={selectedProfile}
              onChange={(e) => {
                setSelectedProfile(e.target.value);
                setReadiness(null);
              }}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {profilesForEnv.length === 0 ? (
                <option value="">No profiles for this environment</option>
              ) : (
                profilesForEnv.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.type}
                    {p.hostname ? ` · ${p.hostname}` : ""})
                  </option>
                ))
              )}
            </select>
          </label>

          {readiness && (
            <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[var(--muted)]">Health check readiness</span>
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
            </div>
          )}

          <button
            type="button"
            disabled={busy || checkBlocked || !selectedProfile || profilesForEnv.length === 0}
            onClick={() => void runHealthCheck()}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Checking…" : "Run health check"}
          </button>
          {checkBlocked && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Health check is disabled while readiness is blocked.
            </p>
          )}
        </>
      )}

      {checks.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Health check history</h3>
          <ul className="space-y-2 text-sm">
            {checks.map((c) => (
              <li key={c.id} className="rounded border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={c.status} />
                  <span>{c.healthProfile}</span>
                  <span className="text-[var(--muted)]">{c.createdAt}</span>
                  {c.actorLabel && <span>· {c.actorLabel}</span>}
                </div>
                {c.hostname && (
                  <p className="mt-1 text-xs text-[var(--muted)]">host: {c.hostname}</p>
                )}
                {c.responseStatus !== null && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    HTTP {c.responseStatus}
                    {c.responseTimeMs !== null ? ` · ${c.responseTimeMs}ms` : ""}
                  </p>
                )}
                {c.outputHashPrefix && (
                  <p className="mt-1 font-mono text-xs">body:{c.outputHashPrefix}…</p>
                )}
                {c.outputSummary && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--background)] p-2 text-xs">
                    {c.outputSummary}
                  </pre>
                )}
                {c.errorMessage && <p className="mt-1 text-[var(--danger)]">{c.errorMessage}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
