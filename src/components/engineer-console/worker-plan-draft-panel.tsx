"use client";

import React from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import { useEffect, useState } from "react";
import type { WorkerPlanValidationError } from "@/lib/engineer-console/worker-plan/worker-plan-types";
import { inspectWorkerPlanJsonInput } from "@/lib/engineer-console/worker-plan/worker-plan-ux";

export interface WorkerPlanDraftPayload {
  id: string;
  runId?: string;
  provider: string;
  model: string;
  validationStatus: string;
  parsedPlan: unknown;
  rawResponse: string;
  validationErrors: WorkerPlanValidationError[];
  createdAt: string;
}

interface ProviderInfo {
  provider: string;
  model: string;
  providerStatus: "ready" | "misconfigured";
  statusMessage: string | null;
}

export function WorkerPlanDraftPanel({
  runId,
  taskTitle,
  taskDescription,
  initialDraft,
  onUseDraftPlan,
}: {
  runId: string;
  taskTitle: string;
  taskDescription: string;
  initialDraft?: WorkerPlanDraftPayload | null;
  onUseDraftPlan: (planJson: string) => void;
}) {
  const [allowedFilesText, setAllowedFilesText] = useState("src/generated/worker-plan-draft.ts");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkerPlanDraftPayload | null>(initialDraft ?? null);
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
  const [lastGeneration, setLastGeneration] = useState<{
    providerName?: string;
    modelName?: string;
    providerStatus?: string;
  } | null>(null);

  useEffect(() => {
    void engineerConsoleFetch("/api/engineer-console/model-provider")
      .then((res) => res.json())
      .then((data: ProviderInfo) => setProviderInfo(data))
      .catch(() => {
        setProviderInfo({
          provider: "mock",
          model: "mock-worker-plan-v1",
          providerStatus: "ready",
          statusMessage: null,
        });
      });
  }, []);

  useEffect(() => {
    if (!initialDraft) return;
    setDraft((current) => (current?.id === initialDraft.id ? current : initialDraft));
  }, [initialDraft]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setDraft(null);
    setLastGeneration(null);

    const allowedFiles = allowedFilesText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    try {
      const res = await engineerConsoleFetch(`/api/engineer-console/runs/${runId}/worker-plan-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedFiles,
          maxOperations: 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Draft generation failed");
      }
      setDraft(data.draft);
      setLastGeneration({
        providerName: data.providerName,
        modelName: data.modelName,
        providerStatus: data.providerStatus,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function handleUseDraft() {
    if (!draft?.parsedPlan) return;
    onUseDraftPlan(JSON.stringify(draft.parsedPlan, null, 2));
  }

  function handleDiscard() {
    setDraft(null);
    setError(null);
    setLastGeneration(null);
  }

  const activeProvider = lastGeneration?.providerName ?? providerInfo?.provider ?? "—";
  const activeModel = lastGeneration?.modelName ?? providerInfo?.model ?? "—";
  const misconfigured = providerInfo?.providerStatus === "misconfigured";
  const draftInspection =
    draft?.parsedPlan != null
      ? inspectWorkerPlanJsonInput({
          text: JSON.stringify(draft.parsedPlan),
          currentRunId: runId,
          taskTitle,
          taskDescription,
        })
      : null;

  return (
    <section className="rounded-xl border border-violet-600/40 bg-[var(--card)] p-4">
      <h2 className="font-semibold">Generate worker plan draft</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Model output is only a draft. It is not executed until you manually copy/review and
        click <strong>Validate and execute</strong> in the Worker plan panel below. No
        auto-commit, merge, or deploy.
      </p>

      <dl className="mt-3 grid gap-2 rounded border border-[var(--border)] p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Configured provider</dt>
          <dd className="font-mono text-xs">{providerInfo?.provider ?? "loading…"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Configured model</dt>
          <dd className="font-mono text-xs">{providerInfo?.model ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Provider status</dt>
          <dd className={misconfigured ? "text-amber-300" : "text-emerald-400"}>
            {providerInfo?.providerStatus ?? "—"}
            {providerInfo?.statusMessage ? ` — ${providerInfo.statusMessage}` : ""}
          </dd>
        </div>
      </dl>

      {misconfigured && (
        <p className="mt-2 text-sm text-amber-300">
          Fix server configuration (e.g. set KIMI_API_KEY) before using the Kimi provider.
        </p>
      )}

      <label className="mt-3 block text-sm">
        Allowed files (one per line)
        <textarea
          value={allowedFilesText}
          onChange={(e) => setAllowedFilesText(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2 font-mono text-xs"
        />
      </label>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading || misconfigured}
        className="mt-3 rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Generating draft…" : "Generate worker plan draft"}
      </button>

      {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      {draft && (
        <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
          <dl className="grid gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Generation provider</dt>
              <dd className="font-mono text-xs">
                {activeProvider} / {activeModel}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Validation</dt>
              <dd className="font-medium">{draft.validationStatus}</dd>
            </div>
          </dl>

          {draft.validationErrors.length > 0 && (
            <ul className="list-inside list-disc text-sm text-red-300">
              {draft.validationErrors.map((e, i) => (
                <li key={i}>
                  [{e.code}] {e.message}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-[var(--border)] p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Task</p>
              <p className="mt-2 font-medium">{taskTitle}</p>
              <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">
                {taskDescription || "No task description recorded."}
              </p>
            </div>
            <div className="rounded border border-[var(--border)] p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Draft</p>
              {draftInspection?.plan ? (
                <>
                  <p className="mt-2 font-medium">{draftInspection.plan.summary}</p>
                  <ul className="mt-2 space-y-1">
                    {draftInspection.previewItems.map((item) => (
                      <li key={`${item.type}-${item.path}`}>
                        <span className="font-mono text-xs">{item.path}</span> - {item.description}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-[var(--muted)]">Draft JSON is not available for comparison.</p>
              )}
            </div>
          </div>

          {draftInspection?.intentWarnings.length ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm font-medium text-amber-200">
                This draft may not match the task. Review before execution.
              </p>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-100">
                {draftInspection.intentWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <pre className="max-h-48 overflow-auto rounded bg-[var(--background)] p-3 font-mono text-xs">
            {draft.parsedPlan
              ? JSON.stringify(draft.parsedPlan, null, 2)
              : draft.rawResponse}
          </pre>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleUseDraft}
              disabled={!draft.parsedPlan || draft.validationStatus !== "valid"}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
              title={
                draft.validationStatus !== "valid"
                  ? "Fix validation errors before using this draft"
                  : "Load this draft into the guided worker plan builder"
              }
            >
              Use draft in worker plan builder
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
            >
              Discard draft
            </button>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Using a draft does not execute it. Review the builder or advanced JSON below, then
            validate and execute manually.
          </p>
        </div>
      )}
    </section>
  );
}
