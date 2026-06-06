"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE,
  type VeraHandoffTaskAnalysis,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { EngineeringRun, EngineeringTask } from "@/lib/engineer-console/types";

type Props = {
  task: EngineeringTask;
  analysis: VeraHandoffTaskAnalysis;
  preparedRun: EngineeringRun | null;
};

export function canShowVeraHandoffPreparePanel(analysis: VeraHandoffTaskAnalysis): boolean {
  return analysis.isVeraLuxOsHandoffTask;
}

export function isVeraHandoffPrepareEnabled(
  analysis: VeraHandoffTaskAnalysis,
  preparedRun: EngineeringRun | null,
): boolean {
  if (!analysis.isVeraLuxOsHandoffTask) return false;
  if (preparedRun) return false;
  return analysis.safeToPrepareRun;
}

export function resolveVeraHandoffPrepareUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  runId?: string;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera implementation run preparation failed.",
    };
  }
  if (!input.runId?.trim()) {
    return {
      success: null,
      error: "Preparation response did not confirm a persisted run.",
    };
  }
  return {
    success: `Run prepared — execution still gated (run ${input.runId}).`,
    error: null,
  };
}

export function VeraHandoffTaskPanel({ task, analysis, preparedRun }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<EngineeringRun | null>(preparedRun);

  const prepareEnabled = isVeraHandoffPrepareEnabled(analysis, latestRun);

  if (!canShowVeraHandoffPreparePanel(analysis)) {
    return null;
  }

  async function handlePrepare() {
    setError(null);
    setSuccess(null);
    if (confirmation.trim() !== VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE) {
      setError(`Type exactly: ${VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/tasks/${task.id}/prepare-vera-implementation-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmationText: confirmation.trim() }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        run?: EngineeringRun;
      };
      const outcome = resolveVeraHandoffPrepareUiOutcome({
        apiOk: res.ok,
        apiMessage: res.ok ? undefined : data.error,
        runId: data.run?.id,
      });
      if (outcome.error) {
        setError(outcome.error);
        return;
      }
      if (data.run) {
        setLatestRun(data.run);
      }
      setSuccess(outcome.success);
      setMode(false);
      setConfirmation("");
      router.refresh();
    } catch {
      setError("Vera implementation run preparation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">VeraLux OS handoff</h2>
        <span className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
          Brain → hands
        </span>
      </div>

      <div className="space-y-2 text-sm text-[var(--muted)]">
        <p>
          Vera work order ID:{" "}
          <span className="font-mono text-white">
            {analysis.veraWorkOrderId ?? "not detected"}
          </span>
        </p>
        <p>
          Source: <span className="text-white">VeraLux OS</span>
        </p>
        <p>
          Task status: <span className="text-white">{task.status}</span>
        </p>
        <p>
          Repo binding:{" "}
          <span className="font-mono text-xs text-white">
            {analysis.repoPath ?? task.targetRepoPath ?? "missing"}
          </span>
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p className="font-medium">Preparing this run does not execute code.</p>
        <p className="mt-1">Worker dispatch remains separately gated.</p>
        <p className="mt-1">
          No worktree, patch, commit, PR, merge, or deploy is created by this action.
        </p>
        <p className="mt-2 font-mono text-xs">{analysis.source}</p>
      </div>

      {!analysis.nonExecutionNotePresent ? (
        <p className="mt-3 text-sm text-[var(--danger)]">
          Handoff non-execution note is missing from task description.
        </p>
      ) : null}

      {analysis.blockers.length > 0 && !latestRun ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--danger)]">
          {analysis.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {latestRun ? (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <p className="font-medium">Run prepared — execution still gated</p>
          <p className="mt-1">
            Run ID: <span className="font-mono">{latestRun.id}</span>
          </p>
          <p className="mt-1">
            Status: <span className="font-mono">{latestRun.status}</span>
          </p>
          <Link
            href={`/engineer/runs/${latestRun.id}`}
            className="mt-2 inline-block text-emerald-200 underline-offset-2 hover:underline"
          >
            Open prepared run
          </Link>
        </div>
      ) : null}

      {success ? (
        <p className="mt-3 text-sm text-emerald-300">{success}</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}

      {!latestRun && !mode ? (
        <button
          type="button"
          disabled={!prepareEnabled || busy}
          onClick={() => {
            setMode(true);
            setError(null);
            setSuccess(null);
          }}
          className="mt-4 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Prepare Vera implementation run
        </button>
      ) : null}

      {!latestRun && mode ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-[var(--muted)]">
            Confirmation phrase
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm text-white"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            Type exactly:{" "}
            <span className="font-mono">{VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !prepareEnabled}
              onClick={() => void handlePrepare()}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Preparing…" : "Confirm preparation"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode(false)}
              className="rounded border border-[var(--border)] px-4 py-2 text-sm text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
