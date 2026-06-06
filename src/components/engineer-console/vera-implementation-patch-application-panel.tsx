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
import {
  VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
  VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE,
} from "@/lib/engineer-console/worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP } from "@/lib/engineer-console/worker/vera-implementation-patch-proposal-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraPatchApplicationReadinessSnapshot = {
  safeToApplyPatch: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  proposalPath: string | null;
  proposalHash: string | null;
  worktreePath: string | null;
  applicablePatchCount: number;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  applicationReport: VeraImplementationPatchApplicationReport | null;
  readiness: VeraPatchApplicationReadinessSnapshot;
};

export function canShowVeraImplementationPatchApplicationPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraImplementationPatchApplication(run.governanceNotes)) return true;
  return run.currentStep === VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP;
}

export function isVeraPatchApplicationEnabled(
  run: EngineeringRun,
  readiness: VeraPatchApplicationReadinessSnapshot,
): boolean {
  if (hasVeraImplementationPatchApplication(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP) return false;
  return readiness.safeToApplyPatch;
}

export function resolveVeraPatchApplicationUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  code?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera patch application failed.",
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
      "Vera patch applied to governed worktree — commit, PR, merge, deploy, and release remain gated.",
    error: null,
  };
}

export function formatVeraPatchApplicationBlockedMessage(
  readiness: VeraPatchApplicationReadinessSnapshot,
): string | null {
  if (readiness.safeToApplyPatch) return null;
  if (readiness.reasonCodes.includes("NO_APPLICABLE_PATCH_CONTENT")) {
    return "No applicable patch content in the approved proposal. Patch application is blocked.";
  }
  return readiness.reasons[0] ?? "Patch application is not ready.";
}

export function VeraImplementationPatchApplicationPanel({
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
  const applicationEnabled = isVeraPatchApplicationEnabled(latestRun, readiness);
  const blockedMessage = formatVeraPatchApplicationBlockedMessage(readiness);

  if (!canShowVeraImplementationPatchApplicationPanel(latestRun)) {
    return null;
  }

  async function submitApplication() {
    setError(null);
    setSuccess(null);
    if (confirmation.trim() !== VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE) {
      setError(`Type exactly: ${VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/apply-vera-patch-proposal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmationText: confirmation.trim(),
            note: note.trim() || undefined,
          }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        run?: EngineeringRun;
      };
      const outcome = resolveVeraPatchApplicationUiOutcome({
        apiOk: res.ok,
        apiMessage: res.ok ? undefined : data.error,
        code: data.code,
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
      setError("Vera patch application request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Apply Vera patch proposal</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        First mutation-capable gate. Applies explicit validated patch content only to the governed
        worktree.
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
          <dt className="text-[var(--muted)]">Applicable patches</dt>
          <dd>{readiness.applicablePatchCount}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Proposal path</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.proposalPath ?? notes.veraImplementationPatchProposalPath ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Proposal hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.proposalHash ?? notes.veraImplementationPatchProposalHash ?? "—"}
          </dd>
        </div>
        {readiness.worktreePath ? (
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Governed worktree</dt>
            <dd className="break-all font-mono text-xs">{readiness.worktreePath}</dd>
          </div>
        ) : null}
      </dl>

      {patchApplied ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">Patch application: applied</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Applied by {notes.veraImplementationPatchAppliedBy ?? "operator"} at{" "}
            {notes.veraImplementationPatchAppliedAt ?? "—"}
          </p>
          {applicationReport?.nextGate ? (
            <p className="mt-2 text-sm text-amber-200">
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
          {blockedMessage ? (
            <p className="mt-4 text-sm text-amber-200">{blockedMessage}</p>
          ) : null}
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-200">
            <li>This is the first mutation-capable gate.</li>
            <li>Patch application only affects the governed worktree.</li>
            <li>Approval does not commit, push, create PRs, merge, deploy, or release.</li>
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
              placeholder={VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE}
              disabled={!applicationEnabled || busy}
            />
          </label>
          <label className="block text-sm">
            Note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={3}
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
            Apply patch proposal
          </button>
        </div>
      ) : null}
    </section>
  );
}
