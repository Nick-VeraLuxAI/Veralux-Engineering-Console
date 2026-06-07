"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraPostPatchQualityReport,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "@/lib/engineer-console/worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "@/lib/engineer-console/worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP } from "@/lib/engineer-console/worker/vera-post-patch-quality-report-types";
import type { VeraPostPatchQualityReport } from "@/lib/engineer-console/worker/vera-post-patch-quality-report-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraPostPatchQualityGatesReadinessSnapshot = {
  safeToRunPostPatchQualityGates: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  applicationReportPath: string | null;
  applicationReportHash: string | null;
  appliedFiles: string[];
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  qualityReport: VeraPostPatchQualityReport | null;
  readiness: VeraPostPatchQualityGatesReadinessSnapshot;
};

export function canShowVeraPostPatchQualityGatesPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraPostPatchQualityReport(run.governanceNotes)) return true;
  return run.currentStep === VERA_IMPLEMENTATION_PATCH_APPLIED_STEP;
}

export function isVeraPostPatchQualityGatesEnabled(
  run: EngineeringRun,
  readiness: VeraPostPatchQualityGatesReadinessSnapshot,
): boolean {
  if (hasVeraPostPatchQualityReport(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_PATCH_APPLIED_STEP) return false;
  return readiness.safeToRunPostPatchQualityGates;
}

export function buildVeraPostPatchQualityGatesRequestBody(input: {
  confirmationText: string;
  note?: string;
}): { confirmationText: string; note?: string } {
  const body: { confirmationText: string; note?: string } = {
    confirmationText: input.confirmationText,
  };
  const trimmedNote = input.note?.trim();
  if (trimmedNote) {
    body.note = trimmedNote;
  }
  return body;
}

export function resolveVeraPostPatchQualityGatesUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera post-patch quality gates failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP) {
    return {
      success: null,
      error: "Post-patch quality gate metadata did not persist on the run.",
    };
  }
  return {
    success:
      "Vera post-patch quality gates completed — review, commit, PR, merge, deploy, and release remain gated.",
    error: null,
  };
}

export function VeraPostPatchQualityGatesPanel({
  run,
  taskId,
  qualityReport,
  readiness,
}: Props) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState(run);

  const notes = parseVeraRunGovernanceNotes(latestRun.governanceNotes);
  const qualityCompleted = hasVeraPostPatchQualityReport(latestRun.governanceNotes);
  const gatesEnabled = isVeraPostPatchQualityGatesEnabled(latestRun, readiness);

  if (!canShowVeraPostPatchQualityGatesPanel(latestRun)) {
    return null;
  }

  async function submitQualityGates() {
    setError(null);
    setSuccess(null);

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/run-vera-post-patch-quality-gates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVeraPostPatchQualityGatesRequestBody({
              confirmationText: confirmation,
              note,
            }),
          ),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        run?: EngineeringRun;
      };
      const outcome = resolveVeraPostPatchQualityGatesUiOutcome({
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
      setSuccess(outcome.success);
      setConfirmation("");
      setNote("");
      router.refresh();
    } catch {
      setError("Vera post-patch quality gates request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Run Vera post-patch quality gates</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Runs deterministic post-patch validation against the governed worktree. This does not
        commit, push, create PRs, merge, deploy, or release.
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Run ID</dt>
          <dd className="font-mono text-xs">{latestRun.id}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Task ID</dt>
          <dd className="font-mono text-xs">{taskId}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Vera work order</dt>
          <dd>{notes.veraWorkOrderId ?? readiness.veraWorkOrderId ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Application report path</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.applicationReportPath ??
              notes.veraImplementationPatchApplicationPath ??
              "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Application report hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.applicationReportHash ??
              notes.veraImplementationPatchApplicationHash ??
              "—"}
          </dd>
        </div>
      </dl>

      {readiness.appliedFiles.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">Applied files</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {readiness.appliedFiles.map((filePath) => (
              <li key={filePath} className="font-mono text-xs">
                {filePath}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {qualityCompleted ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">
            Quality gate status: {notes.veraPostPatchQualityStatus ?? "completed"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Ran by {notes.veraPostPatchQualityRanBy ?? "operator"} at{" "}
            {notes.veraPostPatchQualityRanAt ?? "—"}
          </p>
          {notes.veraPostPatchQualityGateSummary ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              Gate summary: {notes.veraPostPatchQualityGateSummary}
            </p>
          ) : null}
          {notes.veraPostPatchQualityReportPath ? (
            <p className="mt-2 break-all font-mono text-xs">
              Report: {notes.veraPostPatchQualityReportPath}
            </p>
          ) : null}
          {qualityReport?.nextGate ? (
            <p className="mt-4 text-sm text-amber-200">
              Next gate ({qualityReport.nextGate.phase}): {qualityReport.nextGate.note}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {readiness.checks.map((check) => (
              <li key={check.id} className={check.ok ? "" : "text-amber-200"}>
                {check.message}
              </li>
            ))}
          </ul>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-200">
            <li>This does not commit, push, create PRs, merge, deploy, or release.</li>
            <li>This only validates the already-applied governed patch.</li>
          </ul>
        </>
      )}

      {success ? <p className="mt-4 text-sm text-green-300">{success}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      {!qualityCompleted ? (
        <div className="mt-4 space-y-3 rounded border border-[var(--border)] p-3">
          <label className="block text-sm">
            Confirmation phrase
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={VERA_POST_PATCH_GATE_CONFIRMATION}
              disabled={!gatesEnabled || busy}
            />
          </label>
          <label className="block text-sm">
            Note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!gatesEnabled || busy}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={!gatesEnabled || busy}
            onClick={() => submitQualityGates()}
          >
            Run post-patch quality gates
          </button>
        </div>
      ) : null}
    </section>
  );
}
