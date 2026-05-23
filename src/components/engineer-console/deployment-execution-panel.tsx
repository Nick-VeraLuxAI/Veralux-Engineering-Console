"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface DeploymentProfile {
  name: string;
  environmentName: string;
  strategy: string;
  enabled: boolean;
}

interface DeploymentApproval {
  id: string;
  environmentName: string | null;
  decision: string;
  rationale: string | null;
  createdAt: string;
}

interface ExecutionReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
}

interface DeploymentExecution {
  id: string;
  deploymentProfile: string;
  environmentName: string | null;
  status: string;
  actorLabel: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  outputSummary: string | null;
  outputHashPrefix: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function DeploymentExecutionPanel({ runId }: { runId: string }) {
  const [profiles, setProfiles] = useState<DeploymentProfile[]>([]);
  const [approvals, setApprovals] = useState<DeploymentApproval[]>([]);
  const [executions, setExecutions] = useState<DeploymentExecution[]>([]);
  const [selectedApprovalId, setSelectedApprovalId] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [readiness, setReadiness] = useState<ExecutionReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const approvedApprovals = approvals.filter((a) => a.decision === "approved");

  const load = useCallback(async () => {
    const [profileRes, approvalRes, execRes] = await Promise.all([
      engineerConsoleFetch("/api/engineer-console/deployment/profiles"),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/deployment-approval`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/deployment-executions`),
    ]);

    if (profileRes.ok) {
      const data = (await profileRes.json()) as { profiles: DeploymentProfile[] };
      setProfiles(data.profiles.filter((p) => p.enabled));
    }

    if (approvalRes.ok) {
      const data = (await approvalRes.json()) as { approvals: DeploymentApproval[] };
      const approved = data.approvals.filter((a) => a.decision === "approved");
      setApprovals(approved);
      setSelectedApprovalId((prev) => prev || approved[0]?.id || "");
    }

    if (execRes.ok) {
      const data = (await execRes.json()) as { executions: DeploymentExecution[] };
      setExecutions(data.executions);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  const selectedApproval = approvedApprovals.find((a) => a.id === selectedApprovalId);
  const profilesForEnv = profiles.filter(
    (p) => p.environmentName === selectedApproval?.environmentName,
  );

  useEffect(() => {
    if (!selectedApprovalId || !selectedProfile) {
      setReadiness(null);
      return;
    }
    void (async () => {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-executions?deploymentApprovalId=${encodeURIComponent(selectedApprovalId)}&deploymentProfile=${encodeURIComponent(selectedProfile)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { readiness: ExecutionReadiness | null };
        setReadiness(data.readiness);
      }
    })();
  }, [runId, selectedApprovalId, selectedProfile]);

  useEffect(() => {
    setSelectedProfile((prev) => {
      if (prev && profilesForEnv.some((p) => p.name === prev)) return prev;
      return profilesForEnv[0]?.name ?? "";
    });
  }, [profilesForEnv]);

  async function executeDeployment() {
    if (!selectedApprovalId || !selectedProfile) {
      setError("Select an approved deployment and profile.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-executions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deploymentApprovalId: selectedApprovalId,
            deploymentProfile: selectedProfile,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deployment execution failed");
      setReadiness(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const executionBlocked = readiness?.status === "blocked";

  if (loading) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading deployment execution…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Deployment execution</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Runs a preconfigured deployment profile after deployment approval. No arbitrary commands.
        No automatic rollback.
      </p>

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {approvedApprovals.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No approved deployment record for this run. Complete deployment gates first.
        </p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No deployment profiles are configured. Set ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON on
          the server.
        </p>
      ) : (
        <>
          <label className="mb-3 block text-sm">
            Deployment approval
            <select
              value={selectedApprovalId}
              onChange={(e) => {
                setSelectedApprovalId(e.target.value);
                setReadiness(null);
              }}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {approvedApprovals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.environmentName} · approved · {a.createdAt}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-3 block text-sm">
            Deployment profile
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
                    {p.name} ({p.strategy})
                  </option>
                ))
              )}
            </select>
          </label>

          {readiness && (
            <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[var(--muted)]">Execution readiness</span>
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

          <button
            type="button"
            disabled={busy || executionBlocked || !selectedProfile || profilesForEnv.length === 0}
            onClick={() => void executeDeployment()}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Executing…" : "Execute deployment"}
          </button>
          {executionBlocked && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Execution is disabled while readiness is blocked.
            </p>
          )}
        </>
      )}

      {executions.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Execution history</h3>
          <ul className="space-y-2 text-sm">
            {executions.map((e) => (
              <li key={e.id} className="rounded border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={e.status} />
                  <span>{e.deploymentProfile}</span>
                  <span className="text-[var(--muted)]">{e.createdAt}</span>
                  {e.actorLabel && <span>· {e.actorLabel}</span>}
                </div>
                {e.exitCode !== null && (
                  <p className="mt-1 text-xs text-[var(--muted)]">exit: {e.exitCode}</p>
                )}
                {e.outputHashPrefix && (
                  <p className="mt-1 font-mono text-xs">out:{e.outputHashPrefix}…</p>
                )}
                {e.outputSummary && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--background)] p-2 text-xs">
                    {e.outputSummary}
                  </pre>
                )}
                {e.errorMessage && <p className="mt-1 text-[var(--danger)]">{e.errorMessage}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
