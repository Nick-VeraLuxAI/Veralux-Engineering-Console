"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";

import { useCallback, useEffect, useState } from "react";
import { OperatorHelp } from "./operator-help";

interface EvidenceResponse {
  evidence: {
    id: string;
    bundleHash: string;
    redactionVersion: string;
    createdAt: string;
    updatedAt: string;
    bundle: {
      taskTitle: string;
      repoName: string | null;
      repoPathRef: string;
      branchName: string | null;
      runStatus: string;
      modelDraft: { provider: string; model: string; validationStatus: string } | null;
      workerPlan: { summary: string; validationStatus: string; executionStatus: string } | null;
      changedFileCount: number;
      qualityGates: Array<{ command: string; status: string; exitCode: number }>;
      governance: { riskLevel: string; canApprove: boolean; issueCount: number } | null;
      approval: { canApprove: boolean; recommendedNextAction: string } | null;
      audit: { eventCount: number; chainHashPrefixes: string[] };
    };
  };
}

export function EvidenceBundlePanel({ runId }: { runId: string }) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/evidence-bundle`);
    if (res.status === 404) {
      setData(null);
      setMissing(true);
      setError(null);
      return;
    }
    setMissing(false);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    setData((await res.json()) as EvidenceResponse);
    setError(null);
  }, [runId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/evidence-bundle/regenerate`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Regenerate failed");
      setData(body as EvidenceResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const bundle = data?.evidence.bundle;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Evidence bundle</h2>
          <OperatorHelp term="evidence_bundle" label="What is an evidence bundle?" />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void regenerate()}
          className="rounded border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Generate or refresh evidence"}
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {loading && <p className="text-sm text-[var(--muted)]">Loading evidence record…</p>}

      {!loading && missing && !error && (
        <p className="text-sm text-[var(--muted)]">
          Generate evidence so the run has a reviewable record.
        </p>
      )}

      {data && bundle && (
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-[var(--muted)]">Bundle hash</dt>
            <dd className="font-mono text-xs break-all">{data.evidence.bundleHash}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Updated</dt>
            <dd>{new Date(data.evidence.updatedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Task / repo</dt>
            <dd>
              {bundle.taskTitle}
              {bundle.repoName ? ` · ${bundle.repoName}` : ""} ({bundle.repoPathRef})
            </dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Branch / status</dt>
            <dd>
              {bundle.branchName ?? "—"} · {bundle.runStatus}
            </dd>
          </div>
          {bundle.modelDraft && (
            <div>
              <dt className="text-[var(--muted)]">Model draft</dt>
              <dd>
                {bundle.modelDraft.provider}/{bundle.modelDraft.model} —{" "}
                {bundle.modelDraft.validationStatus}
              </dd>
            </div>
          )}
          {bundle.workerPlan && (
            <div>
              <dt className="text-[var(--muted)]">Worker plan</dt>
              <dd>
                {bundle.workerPlan.summary || "(no summary)"} — validation{" "}
                {bundle.workerPlan.validationStatus}, execution {bundle.workerPlan.executionStatus}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--muted)]">Changed files</dt>
            <dd>{bundle.changedFileCount}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Quality gates</dt>
            <dd>
              {bundle.qualityGates.length === 0
                ? "—"
                : bundle.qualityGates.map((g) => `${g.command} (${g.status})`).join(", ")}
            </dd>
          </div>
          {bundle.governance && (
            <div>
              <dt className="text-[var(--muted)]">Governance</dt>
              <dd>
                {bundle.governance.riskLevel} · canApprove={String(bundle.governance.canApprove)} ·{" "}
                {bundle.governance.issueCount} issue(s)
              </dd>
            </div>
          )}
          {bundle.approval && (
            <div>
              <dt className="text-[var(--muted)]">Approval</dt>
              <dd>{bundle.approval.recommendedNextAction}</dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--muted)]">Audit refs</dt>
            <dd className="font-mono text-xs">
              {bundle.audit.eventCount} events
              {bundle.audit.chainHashPrefixes.length > 0
                ? ` · latest prefixes: ${bundle.audit.chainHashPrefixes.slice(-3).join(", ")}`
                : ""}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
