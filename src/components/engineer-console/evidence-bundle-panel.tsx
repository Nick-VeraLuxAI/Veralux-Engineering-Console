"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { Surface } from "@/components/ui/surface";

import { useCallback, useEffect, useState } from "react";
import { RUN_NAV_TARGET_IDS } from "@/lib/engineer-console/run-ux/run-navigation";
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
    <Surface as="section">
      <SectionHeader
        title="Evidence bundle"
        description="Keep the reviewable run record, governance context, and audit references visible without changing workflow authority."
        meta={
          <>
            <OperatorHelp term="evidence_bundle" label="What is an evidence bundle?" />
            <a
              href={`#${RUN_NAV_TARGET_IDS.evidenceDetails}`}
              className="text-xs text-[var(--accent)] underline underline-offset-2"
            >
              View hash and details
            </a>
          </>
        }
        actions={
          <Button disabled={busy} onClick={() => void regenerate()} size="sm" variant="secondary">
            {busy ? "Refreshing…" : "Generate or refresh evidence"}
          </Button>
        }
      />

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {loading && <p className="mt-4 text-sm text-[var(--muted)]">Loading evidence record…</p>}

      {!loading && missing && !error && (
        <div className="mt-4">
          <EmptyState
            compact
            title="No evidence bundle yet"
            description="Generate evidence so the run has a reviewable record."
          />
        </div>
      )}

      {data && bundle && (
        <dl
          id={RUN_NAV_TARGET_IDS.evidenceDetails}
          className="mt-4 grid gap-3 text-sm lg:grid-cols-2"
        >
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Bundle hash</dt>
            <dd className="mt-1 break-all font-mono text-xs">{data.evidence.bundleHash}</dd>
          </Surface>
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Updated</dt>
            <dd className="mt-1">{new Date(data.evidence.updatedAt).toLocaleString()}</dd>
          </Surface>
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Task / repo</dt>
            <dd className="mt-1">
              {bundle.taskTitle}
              {bundle.repoName ? ` · ${bundle.repoName}` : ""} ({bundle.repoPathRef})
            </dd>
          </Surface>
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Branch / status</dt>
            <dd className="mt-1">
              {bundle.branchName ?? "—"} · {bundle.runStatus}
            </dd>
          </Surface>
          {bundle.modelDraft && (
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Model draft</dt>
              <dd className="mt-1">
                {bundle.modelDraft.provider}/{bundle.modelDraft.model} —{" "}
                {bundle.modelDraft.validationStatus}
              </dd>
            </Surface>
          )}
          {bundle.workerPlan && (
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Worker plan</dt>
              <dd className="mt-1">
                {bundle.workerPlan.summary || "(no summary)"} — validation{" "}
                {bundle.workerPlan.validationStatus}, execution {bundle.workerPlan.executionStatus}
              </dd>
            </Surface>
          )}
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Changed files</dt>
            <dd className="mt-1">{bundle.changedFileCount}</dd>
          </Surface>
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Quality gates</dt>
            <dd className="mt-1">
              {bundle.qualityGates.length === 0
                ? "—"
                : bundle.qualityGates.map((g) => `${g.command} (${g.status})`).join(", ")}
            </dd>
          </Surface>
          {bundle.governance && (
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Governance</dt>
              <dd className="mt-1">
                {bundle.governance.riskLevel} · canApprove={String(bundle.governance.canApprove)} ·{" "}
                {bundle.governance.issueCount} issue(s)
              </dd>
            </Surface>
          )}
          {bundle.approval && (
            <Surface padding="sm" variant="inset">
              <dt className="text-[var(--muted)]">Approval</dt>
              <dd className="mt-1">{bundle.approval.recommendedNextAction}</dd>
            </Surface>
          )}
          <Surface padding="sm" variant="inset">
            <dt className="text-[var(--muted)]">Audit refs</dt>
            <dd className="mt-1 font-mono text-xs">
              {bundle.audit.eventCount} events
              {bundle.audit.chainHashPrefixes.length > 0
                ? ` · latest prefixes: ${bundle.audit.chainHashPrefixes.slice(-3).join(", ")}`
                : ""}
            </dd>
          </Surface>
        </dl>
      )}
    </Surface>
  );
}
