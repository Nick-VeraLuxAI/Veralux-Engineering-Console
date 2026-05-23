"use client";

import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "./status-badge";

interface DeploymentEnvironment {
  id: string;
  name: string;
  environmentType: string;
  deploymentStrategy: string;
}

interface DeploymentReadiness {
  status: string;
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  environment: { name: string; environmentType: string };
  signals: {
    mergeRequestStatus: string | null;
    mergeSha: string | null;
    hasEvidenceBundle: boolean;
    policyStatus: string | null;
    replayStatus: string | null;
    reviewStagesPending: number;
    reviewStagesRejected: number;
  };
}

interface ReadinessCheck {
  id: string;
  environmentId: string;
  environmentName: string | null;
  environmentType: string | null;
  status: string;
  readiness: DeploymentReadiness | null;
  mergeShaPrefix: string | null;
  evidenceBundleHashPrefix: string | null;
  actorLabel: string | null;
  createdAt: string;
}

interface DeploymentApproval {
  id: string;
  environmentName: string | null;
  decision: string;
  actorLabel: string | null;
  rationale: string | null;
  createdAt: string;
  readinessCheckId: string;
}

export function DeploymentGatesPanel({ runId }: { runId: string }) {
  const [environments, setEnvironments] = useState<DeploymentEnvironment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [preview, setPreview] = useState<DeploymentReadiness | null>(null);
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [approvals, setApprovals] = useState<DeploymentApproval[]>([]);
  const [latestCheckId, setLatestCheckId] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [envRes, readinessRes, approvalRes] = await Promise.all([
      engineerConsoleFetch("/api/engineer-console/deployment/environments"),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/deployment-readiness`),
      engineerConsoleFetch(`/api/engineer-console/runs/${runId}/deployment-approval`),
    ]);

    if (!envRes.ok) {
      const body = (await envRes.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${envRes.status}`);
    }
    const envData = (await envRes.json()) as { environments: DeploymentEnvironment[] };
    setEnvironments(envData.environments);
    setSelectedEnvironmentId((prev) => prev || envData.environments[0]?.id || "");

    if (readinessRes.ok) {
      const readinessData = (await readinessRes.json()) as {
        checks: ReadinessCheck[];
        preview: DeploymentReadiness | null;
      };
      setChecks(readinessData.checks);
      setPreview(readinessData.preview);
      setLatestCheckId(readinessData.checks[0]?.id ?? "");
    }

    if (approvalRes.ok) {
      const approvalData = (await approvalRes.json()) as { approvals: DeploymentApproval[] };
      setApprovals(approvalData.approvals);
    }
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!selectedEnvironmentId) return;
    void (async () => {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-readiness?environmentId=${encodeURIComponent(selectedEnvironmentId)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { preview: DeploymentReadiness | null };
        setPreview(data.preview);
      }
    })();
  }, [runId, selectedEnvironmentId]);

  async function evaluateReadiness() {
    if (!selectedEnvironmentId) {
      setError("Select a deployment environment.");
      return;
    }
    setBusy("evaluate");
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environmentId: selectedEnvironmentId }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deployment readiness evaluation failed");
      setPreview(data.check?.readiness ?? null);
      setLatestCheckId(data.check?.id ?? "");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitApproval(decision: "approved" | "rejected") {
    if (!latestCheckId) {
      setError("Evaluate deployment readiness first.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/deployment-approval`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            readinessCheckId: latestCheckId,
            decision,
            rationale: rationale.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deployment approval failed");
      setRationale("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const displayReadiness = preview ?? checks.find((c) => c.environmentId === selectedEnvironmentId)?.readiness ?? checks[0]?.readiness ?? null;
  const approvalBlocked = displayReadiness?.status === "blocked";
  const approvalNeedsRationale =
    displayReadiness?.status === "requires_review" ||
    displayReadiness?.environment?.environmentType === "production";

  if (loading) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading deployment gates…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="mb-1 font-semibold">Deployment gates</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Deployment approval records readiness only. It does not deploy. No deploy button in this
        phase.
      </p>

      {error && <p className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {environments.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No deployment environments configured.</p>
      ) : (
        <>
          <label className="mb-3 block text-sm">
            Environment
            <select
              value={selectedEnvironmentId}
              onChange={(e) => {
                setSelectedEnvironmentId(e.target.value);
                setPreview(null);
              }}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name} ({env.environmentType}) · {env.deploymentStrategy}
                </option>
              ))}
            </select>
          </label>

          {displayReadiness && (
            <div className="mb-4 rounded border border-[var(--border)] p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[var(--muted)]">Readiness</span>
                <StatusBadge status={displayReadiness.status} />
                <span className="text-[var(--muted)]">
                  · {displayReadiness.environment.name} ({displayReadiness.environment.environmentType})
                </span>
              </div>
              <p className="text-[var(--muted)]">{displayReadiness.recommendedAction}</p>
              <div className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2">
                <span>Merge: {displayReadiness.signals.mergeRequestStatus ?? "—"}</span>
                <span>Merge SHA: {displayReadiness.signals.mergeSha?.slice(0, 12) ?? "—"}</span>
                <span>Evidence: {displayReadiness.signals.hasEvidenceBundle ? "yes" : "no"}</span>
                <span>Policy: {displayReadiness.signals.policyStatus ?? "—"}</span>
                <span>Replay: {displayReadiness.signals.replayStatus ?? "—"}</span>
                <span>
                  Reviews pending/rejected: {displayReadiness.signals.reviewStagesPending}/
                  {displayReadiness.signals.reviewStagesRejected}
                </span>
              </div>
              {displayReadiness.blockers.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[var(--danger)]">
                  {displayReadiness.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {displayReadiness.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-amber-300">
                  {displayReadiness.warnings.map((w) => (
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
              {busy === "evaluate" ? "Evaluating…" : "Evaluate deployment readiness"}
            </button>
          </div>

          <label className="mb-4 block text-sm">
            Rationale {approvalNeedsRationale ? "(required for approval)" : "(optional)"}
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!busy || approvalBlocked || !latestCheckId}
              onClick={() => void submitApproval("approved")}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "approved" ? "Recording…" : "Approve deployment"}
            </button>
            <button
              type="button"
              disabled={!!busy || !latestCheckId}
              onClick={() => void submitApproval("rejected")}
              className="rounded border border-[var(--border)] px-4 py-2 text-sm"
            >
              {busy === "rejected" ? "Recording…" : "Reject deployment"}
            </button>
          </div>
          {approvalBlocked && (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Deployment approval is disabled while readiness is blocked.
            </p>
          )}
        </>
      )}

      {(checks.length > 0 || approvals.length > 0) && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {checks.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Readiness history</h3>
              <ul className="space-y-2 text-sm">
                {checks.map((c) => (
                  <li key={c.id} className="rounded border border-[var(--border)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={c.status} />
                      <span>{c.environmentName}</span>
                      <span className="text-[var(--muted)]">{c.createdAt}</span>
                    </div>
                    {c.mergeShaPrefix && (
                      <p className="mt-1 font-mono text-xs">merge:{c.mergeShaPrefix}…</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {approvals.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Approval history</h3>
              <ul className="space-y-2 text-sm">
                {approvals.map((a) => (
                  <li key={a.id} className="rounded border border-[var(--border)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={a.decision} />
                      <span>{a.environmentName}</span>
                      <span className="text-[var(--muted)]">{a.createdAt}</span>
                    </div>
                    {a.rationale && <p className="mt-1 text-[var(--muted)]">{a.rationale}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
