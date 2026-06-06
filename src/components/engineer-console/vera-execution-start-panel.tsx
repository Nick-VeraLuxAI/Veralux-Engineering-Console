"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraExecutionStartBeenRequested,
  isVeraHandoffRunFromGovernanceNotes,
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_EXECUTION_START_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraExecutionStartReadinessSnapshot = {
  safeToStartVeraExecution: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  repoPath: string | null;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  readiness: VeraExecutionStartReadinessSnapshot;
};

export function canShowVeraExecutionStartPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraExecutionStartBeenRequested(run.governanceNotes) || run.startedAt) {
    return false;
  }
  return (
    run.currentStep === VERA_EXECUTION_APPROVAL_REQUESTED_STEP ||
    run.currentStep === VERA_IMPLEMENTATION_RUN_PREPARED_STEP
  );
}

export function isVeraExecutionStartEnabled(
  run: EngineeringRun,
  readiness: VeraExecutionStartReadinessSnapshot,
): boolean {
  if (run.currentStep !== VERA_EXECUTION_APPROVAL_REQUESTED_STEP) return false;
  return readiness.safeToStartVeraExecution;
}

export function resolveVeraExecutionStartUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera execution start failed.",
    };
  }
  if (
    !hasVeraExecutionStartBeenRequested(input.run?.governanceNotes) &&
    !input.run?.startedAt
  ) {
    return {
      success: null,
      error: "Execution start did not persist on the run.",
    };
  }
  return {
    success: "Execution accepted — review/merge/deploy remain gated.",
    error: null,
  };
}

export function VeraExecutionStartPanel({ run, taskId, readiness }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState(run);

  const startEnabled = isVeraExecutionStartEnabled(latestRun, readiness);
  const blockedBeforeApproval =
    latestRun.currentStep === VERA_IMPLEMENTATION_RUN_PREPARED_STEP;

  if (!canShowVeraExecutionStartPanel(latestRun)) {
    return null;
  }

  async function handleStartExecution() {
    setError(null);
    setSuccess(null);
    if (confirmation.trim() !== VERA_EXECUTION_START_CONFIRMATION_PHRASE) {
      setError(`Type exactly: ${VERA_EXECUTION_START_CONFIRMATION_PHRASE}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/start-vera-execution`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmationText: confirmation.trim() }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        run?: EngineeringRun;
        warning?: string;
      };
      const outcome = resolveVeraExecutionStartUiOutcome({
        apiOk: res.ok,
        apiMessage: res.ok ? undefined : data.error,
        run: data.run,
      });
      if (outcome.error) {
        setError(outcome.error);
        return;
      }
      if (data.run) {
        setLatestRun(data.run);
      }
      setSuccess(
        `${outcome.success}${data.warning ? ` ${data.warning}` : ""}`,
      );
      setMode(false);
      setConfirmation("");
      router.refresh();
    } catch {
      setError("Vera execution start failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Start Vera execution</h2>
        <span className="rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
          Phase 2K
        </span>
      </div>

      <div className="space-y-2 text-sm text-[var(--muted)]">
        <p>
          Vera work order ID:{" "}
          <span className="font-mono text-white">
            {readiness.veraWorkOrderId ?? "not detected"}
          </span>
        </p>
        <p>
          Task ID: <span className="font-mono text-xs text-white">{taskId}</span>
        </p>
        <p>
          Run ID: <span className="font-mono text-xs text-white">{latestRun.id}</span>
        </p>
        <p>
          Status: <span className="font-mono text-white">{latestRun.status}</span>
        </p>
        <p>
          Current step: <span className="font-mono text-white">{latestRun.currentStep ?? "—"}</span>
        </p>
        <p>
          Repo binding:{" "}
          <span className="font-mono text-xs text-white">{readiness.repoPath ?? "missing"}</span>
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        <p className="font-medium">This action may start the Engineering Console worker.</p>
        <p className="mt-1">
          This may create a worktree/branch if the existing execution engine requires it.
        </p>
        <p className="mt-1">
          This does not merge, deploy, create a PR, or mark the work complete.
        </p>
        <p className="mt-1">Review and release gates remain separate.</p>
      </div>

      {blockedBeforeApproval ? (
        <p className="mt-3 text-sm text-[var(--danger)]">
          Execution start is blocked until Vera execution approval is requested (Phase 2J).
        </p>
      ) : null}

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-medium text-white">Readiness checklist</h3>
        <ul className="space-y-1 text-sm">
          {readiness.checks.map((check) => (
            <li
              key={check.id}
              className={check.ok ? "text-emerald-300" : "text-[var(--danger)]"}
            >
              {check.ok ? "✓" : "✗"} {check.message}
            </li>
          ))}
        </ul>
      </div>

      {success ? (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <p className="font-medium">{success}</p>
          <p className="mt-1">
            Status: <span className="font-mono">{latestRun.status}</span> · Step:{" "}
            <span className="font-mono">{latestRun.currentStep ?? "—"}</span>
          </p>
          {latestRun.startedAt ? (
            <p className="mt-1">
              startedAt: <span className="font-mono">{latestRun.startedAt}</span>
            </p>
          ) : null}
          {latestRun.branchName ? (
            <p className="mt-1">
              branchName: <span className="font-mono">{latestRun.branchName}</span>
            </p>
          ) : null}
          <a href="#active-work" className="mt-2 inline-block text-emerald-200 underline-offset-2 hover:underline">
            Open live run workspace
          </a>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}

      {!success && !mode ? (
        <button
          type="button"
          disabled={!startEnabled || busy}
          onClick={() => {
            setMode(true);
            setError(null);
            setSuccess(null);
          }}
          className="mt-4 rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Start Vera execution
        </button>
      ) : null}

      {!success && mode ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-[var(--muted)]">
            Confirmation phrase
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={VERA_EXECUTION_START_CONFIRMATION_PHRASE}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm text-white"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            Type exactly:{" "}
            <span className="font-mono">{VERA_EXECUTION_START_CONFIRMATION_PHRASE}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !startEnabled}
              onClick={() => void handleStartExecution()}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Starting…" : "Confirm start"}
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
