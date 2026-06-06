"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraImplementationPatchApplication,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraImplementationPatchApplicationReport } from "@/lib/engineer-console/worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "@/lib/engineer-console/worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP } from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
import { VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE } from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraApprovedPatchContentApplicationReadinessSnapshot = {
  safeToApplyApprovedPatchContent: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  draftPath: string | null;
  draftHash: string | null;
  entryCount: number;
  worktreePath: string | null;
  targetFiles: Array<{ filePath: string; action: string }>;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  applicationReport: VeraImplementationPatchApplicationReport | null;
  readiness: VeraApprovedPatchContentApplicationReadinessSnapshot;
};

export function canShowVeraApprovedPatchContentApplicationPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraImplementationPatchApplication(run.governanceNotes)) return true;
  return run.currentStep === VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP;
}

export function isVeraApprovedPatchContentApplicationEnabled(
  run: EngineeringRun,
  readiness: VeraApprovedPatchContentApplicationReadinessSnapshot,
): boolean {
  if (hasVeraImplementationPatchApplication(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP) return false;
  return readiness.safeToApplyApprovedPatchContent;
}

export function buildVeraApprovedPatchContentApplicationRequestBody(input: {
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

export function resolveVeraApprovedPatchContentApplicationUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Approved Vera patch content application failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_PATCH_APPLIED_STEP) {
    return {
      success: null,
      error: "Patch application metadata did not persist on the run.",
    };
  }
  return {
    success:
      "Approved Vera patch content applied to governed worktree — commit, PR, merge, deploy, and release remain gated.",
    error: null,
  };
}

export function VeraApprovedPatchContentApplicationPanel({
  run,
  taskId,
  applicationReport,
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
  const patchApplied = hasVeraImplementationPatchApplication(latestRun.governanceNotes);
  const applicationEnabled = isVeraApprovedPatchContentApplicationEnabled(latestRun, readiness);

  if (!canShowVeraApprovedPatchContentApplicationPanel(latestRun)) {
    return null;
  }

  async function submitApplication() {
    setError(null);
    setSuccess(null);

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/apply-approved-vera-patch-content-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVeraApprovedPatchContentApplicationRequestBody({
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
      const outcome = resolveVeraApprovedPatchContentApplicationUiOutcome({
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
      setError("Approved Vera patch content application request failed.");
    } finally {
      setBusy(false);
    }
  }

  const appliedFiles =
    notes.veraImplementationPatchAppliedFiles ??
    applicationReport?.appliedFiles.map((entry) => entry.filePath) ??
    [];

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Apply approved Vera patch content</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Applies the approved patch content draft to the governed worktree only. This does not
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
        <div>
          <dt className="text-[var(--muted)]">Entry count</dt>
          <dd>{readiness.entryCount}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Draft path</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.draftPath ?? notes.veraImplementationPatchContentDraftPath ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Draft hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.draftHash ?? notes.veraImplementationPatchContentDraftHash ?? "—"}
          </dd>
        </div>
        {readiness.worktreePath ? (
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Worktree path</dt>
            <dd className="break-all font-mono text-xs">{readiness.worktreePath}</dd>
          </div>
        ) : null}
      </dl>

      {readiness.targetFiles.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">Target files</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {readiness.targetFiles.map((entry, index) => (
              <li key={`${entry.filePath}-${index}`}>
                <span className="font-mono text-xs">{entry.filePath}</span> ({entry.action})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {patchApplied ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">
            Patch application status: {notes.veraImplementationPatchApplicationStatus ?? "patch_applied"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Applied by {notes.veraImplementationPatchAppliedBy ?? "operator"} at{" "}
            {notes.veraImplementationPatchAppliedAt ?? "—"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Source: {notes.veraImplementationPatchApplicationSource ?? "patch_content_draft"}
          </p>
          {notes.veraImplementationPatchApplicationPath ? (
            <p className="mt-2 break-all font-mono text-xs">
              Report: {notes.veraImplementationPatchApplicationPath}
            </p>
          ) : null}
          {appliedFiles.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {appliedFiles.map((filePath) => (
                <li key={filePath} className="font-mono text-xs">
                  {filePath}
                </li>
              ))}
            </ul>
          ) : null}
          {applicationReport?.nextGate ? (
            <p className="mt-4 text-sm text-amber-200">
              Next gate ({applicationReport.nextGate.phase}): {applicationReport.nextGate.note}
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
            <li>This will mutate the governed worktree.</li>
            <li>This will not commit, push, create PRs, merge, deploy, or release.</li>
            <li>Quality gates remain required after application.</li>
          </ul>
        </>
      )}

      {success ? <p className="mt-4 text-sm text-green-300">{success}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      {!patchApplied ? (
        <div className="mt-4 space-y-3 rounded border border-[var(--border)] p-3">
          <label className="block text-sm">
            Confirmation phrase
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE}
              disabled={!applicationEnabled || busy}
            />
          </label>
          <label className="block text-sm">
            Note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!applicationEnabled || busy}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={!applicationEnabled || busy}
            onClick={() => submitApplication()}
          >
            Apply approved patch content
          </button>
        </div>
      ) : null}
    </section>
  );
}
