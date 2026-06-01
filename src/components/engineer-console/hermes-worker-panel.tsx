"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { useCallback, useEffect, useState } from "react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";

interface HermesDispatchPublic {
  id: string;
  runId: string;
  status: string;
  packetHash: string;
  exportPath: string | null;
  evidencePlaceholderPath: string;
  preparedAt: string;
  dispatchedAt: string | null;
  workerBackend: string;
}

interface HermesPatchProposalSummary {
  available: boolean;
  status: string | null;
  changedFileCount: number;
  proposedPatchPath: string | null;
  summaryPath: string | null;
  proposedFilesPath: string | null;
  proposedPatchPreview: string | null;
  summaryExcerpt: string | null;
}

interface HermesEvidenceSummary {
  available: boolean;
  dispatchId: string | null;
  status: string | null;
  mode: string | null;
  inspectedAt: string | null;
  instructionsSummary: string | null;
  filesInspectedCount: number;
  boundaryValid: boolean | null;
  evidenceOnlyNotSignOff: true;
  proposedChangesMode: string | null;
  changesApplied: boolean;
  patchProposal: HermesPatchProposalSummary;
  patchApplication: {
    status: string;
    appliedAt: string | null;
    appliedBy: string | null;
    changedFiles: string[];
    rollbackArtifactPath: string | null;
    notSignOff: true;
  };
}

export function HermesWorkerPanel({ runId }: { runId: string }) {
  const [dispatches, setDispatches] = useState<HermesDispatchPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"prepare" | "dispatch" | "apply" | "rollback" | null>(null);
  const [evidence, setEvidence] = useState<HermesEvidenceSummary | null>(null);
  const [applyReason, setApplyReason] = useState("");

  const loadEvidence = useCallback(async () => {
    const res = await engineerConsoleFetch(
      `/api/engineer-console/runs/${runId}/hermes-worker/evidence`,
    );
    if (!res.ok) return;
    const body = (await res.json()) as {
      summary: HermesEvidenceSummary;
      patchProposal?: HermesPatchProposalSummary;
    };
    setEvidence({
      ...body.summary,
      patchProposal: body.patchProposal ?? body.summary.patchProposal,
    });
  }, [runId]);

  const load = useCallback(async () => {
    const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/hermes-worker`);
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const body = (await res.json()) as { dispatches: HermesDispatchPublic[] };
    setDispatches(body.dispatches);
    setError(null);
    await loadEvidence();
  }, [runId, loadEvidence]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load Hermes dispatches");
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function handlePrepare() {
    setBusy("prepare");
    setMessage(null);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/hermes-worker/prepare`,
        { method: "POST" },
      );
      const body = (await res.json()) as { error?: string; dispatch?: HermesDispatchPublic };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage("Hermes run packet prepared. Review hash and evidence placeholder before export.");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Prepare failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDispatch(latestPreparedId?: string) {
    setBusy("dispatch");
    setMessage(null);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/hermes-worker/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            latestPreparedId ? { dispatchId: latestPreparedId } : {},
          ),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        exportPath?: string;
        dispatch?: HermesDispatchPublic;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        body.exportPath
          ? `Exported Hermes run packet to inbox (file handoff only): ${body.exportPath}`
          : "Dispatched to Hermes inbox.",
      );
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setBusy(null);
    }
  }

  const latestPrepared = dispatches.find((d) => d.status === "prepared");
  const applyDispatchId = evidence?.dispatchId ?? dispatches[0]?.id;
  const canApplyPatch =
    evidence?.patchProposal?.available &&
    evidence.patchApplication?.status === "not_applied" &&
    !evidence.changesApplied &&
    Boolean(applyDispatchId);

  async function handleApplyPatch() {
    if (!applyDispatchId) return;
    const reason = applyReason.trim();
    if (!reason) {
      setError("Approval reason is required before applying the patch.");
      return;
    }
    setBusy("apply");
    setMessage(null);
    setError(null);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${runId}/hermes-worker/apply-patch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dispatchId: applyDispatchId,
            operatorApproval: { approved: true, approvedBy: "operator", reason },
          }),
        },
      );
      const body = (await res.json()) as { error?: string; changedFiles?: string[] };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        `Patch applied to repository (${body.changedFiles?.length ?? 0} file(s)). This is not sign-off.`,
      );
      setApplyReason("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Apply patch failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Surface as="section" id="hermes-worker" className="scroll-mt-28" tabIndex={-1}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Hermes worker (governed handoff)</h2>
        <Badge variant="muted">Console only</Badge>
      </div>
      <p className="mb-3 text-sm text-[var(--muted)]">
        Prepare a bounded run packet from this Engineering Console run and optionally export it to
        the Hermes inbox. This does not execute Hermes or bypass Console gates. Hermes output is
        evidence input only; sign-off stays in Engineering Console.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void handlePrepare()}
        >
          {busy === "prepare" ? "Preparing…" : "Prepare Hermes run"}
        </button>
        <button
          type="button"
          className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void handleDispatch(latestPrepared?.id)}
        >
          {busy === "dispatch" ? "Exporting…" : "Dispatch to Hermes (export packet)"}
        </button>
      </div>

      {message ? <p className="mb-2 text-sm text-[var(--success)]">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}

      {evidence?.available ? (
        <div className="mb-4 space-y-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
            <p className="mb-2 font-medium">Returned Hermes evidence (review only)</p>
            <p className="mb-2 text-[var(--muted)]">
              Status: {evidence.status ?? "—"} · Mode: {evidence.mode ?? "—"} · Changes applied:{" "}
              {evidence.changesApplied ? "yes" : "no"} · Not sign-off
            </p>
            {evidence.instructionsSummary ? (
              <p className="mb-2 text-[var(--muted)]">{evidence.instructionsSummary}</p>
            ) : null}
            <p className="font-mono text-xs text-[var(--muted)]">
              files inspected: {evidence.filesInspectedCount} · boundary valid:{" "}
              {evidence.boundaryValid === null ? "—" : String(evidence.boundaryValid)}
            </p>
          </div>

          {evidence.patchProposal?.available ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-sm">
              <p className="mb-2 font-medium">Patch proposed (not applied)</p>
              <p className="mb-2 text-[var(--muted)]">
                {evidence.patchProposal.changedFileCount} file(s) in proposal · Status:{" "}
                {evidence.patchProposal.status ?? "patch_proposed"}
              </p>
              {evidence.patchProposal.summaryExcerpt ? (
                <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-inset)] p-2 font-mono text-xs">
                  {evidence.patchProposal.summaryExcerpt}
                </pre>
              ) : null}
              {evidence.patchProposal.proposedPatchPreview ? (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[var(--muted)]">
                    Proposed patch (preview)
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--surface-inset)] p-2 font-mono text-xs">
                    {evidence.patchProposal.proposedPatchPreview}
                  </pre>
                </details>
              ) : null}
              <ul className="space-y-1 font-mono text-xs text-[var(--muted)]">
                {evidence.patchProposal.proposedPatchPath ? (
                  <li className="break-all">diff: {evidence.patchProposal.proposedPatchPath}</li>
                ) : null}
                {evidence.patchProposal.summaryPath ? (
                  <li className="break-all">summary: {evidence.patchProposal.summaryPath}</li>
                ) : null}
                {evidence.patchProposal.proposedFilesPath ? (
                  <li className="break-all">files: {evidence.patchProposal.proposedFilesPath}</li>
                ) : null}
              </ul>
              <p className="mb-3 rounded bg-[var(--surface-inset)] p-2 text-xs text-[var(--danger)]">
                Patch will modify repo files. Explicit operator approval is required. Engineering
                Console applies the patch — not Hermes. This does not approve, merge, deploy, or
                sign off the run.
              </p>

              {canApplyPatch ? (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  <label className="block text-xs font-medium" htmlFor="hermes-apply-reason">
                    Approval reason (required)
                  </label>
                  <textarea
                    id="hermes-apply-reason"
                    className="w-full rounded border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-xs"
                    rows={3}
                    value={applyReason}
                    onChange={(e) => setApplyReason(e.target.value)}
                    placeholder="Why is it safe to apply this proposed patch now?"
                  />
                  <button
                    type="button"
                    className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] disabled:opacity-50"
                    disabled={busy !== null || !applyReason.trim()}
                    onClick={() => void handleApplyPatch()}
                  >
                    {busy === "apply" ? "Applying…" : "Apply patch (Console only)"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {evidence.patchApplication?.status === "patch_applied" ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-inset)] p-3 text-sm">
              <p className="mb-2 font-medium">Patch applied (not sign-off)</p>
              <p className="mb-2 text-[var(--muted)]">
                Applied by {evidence.patchApplication.appliedBy ?? "—"} at{" "}
                {evidence.patchApplication.appliedAt ?? "—"}
              </p>
              <p className="font-mono text-xs text-[var(--muted)]">
                changed: {evidence.patchApplication.changedFiles.join(", ") || "—"}
              </p>
              {evidence.patchApplication.rollbackArtifactPath ? (
                <p className="mt-2 break-all font-mono text-xs text-[var(--muted)]">
                  rollback artifact: {evidence.patchApplication.rollbackArtifactPath}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mb-4 text-sm text-[var(--muted)]">
          No Hermes evidence report on disk yet. After export, run{" "}
          <code className="font-mono text-xs">hermes-consume-engineering-packet --file …</code> on
          the worker host, then refresh this page.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading Hermes handoffs…</p>
      ) : dispatches.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No Hermes dispatches yet. Requires a valid worker plan on this run.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {dispatches.map((d) => (
            <li
              key={d.id}
              className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 font-mono text-xs"
            >
              <div>
                <span className="text-[var(--muted)]">status</span> {d.status}
              </div>
              <div>
                <span className="text-[var(--muted)]">backend</span> {d.workerBackend}
              </div>
              <div className="break-all">
                <span className="text-[var(--muted)]">packet hash</span> {d.packetHash}
              </div>
              {d.exportPath ? (
                <div className="break-all">
                  <span className="text-[var(--muted)]">export</span> {d.exportPath}
                </div>
              ) : null}
              <div className="break-all">
                <span className="text-[var(--muted)]">evidence placeholder</span>{" "}
                {d.evidencePlaceholderPath}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
