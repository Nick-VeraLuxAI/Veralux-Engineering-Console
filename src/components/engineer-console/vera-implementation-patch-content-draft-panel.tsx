"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraImplementationPatchContentDraft,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraImplementationPatchContentDraft } from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP } from "@/lib/engineer-console/worker/vera-implementation-patch-proposal-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

const DEFAULT_PATCH_ENTRIES_JSON = JSON.stringify(
  [
    {
      filePath: "docs/operations/vera-2q-smoke.md",
      action: "create",
      patchIncluded: true,
      patchContent:
        "# Vera 2Q Smoke\n\nThis is an explicit patch-content draft artifact only. It has not been applied.\n",
      contentEncoding: "utf8",
      expectedBeforeHash: null,
    },
  ],
  null,
  2,
);

export type VeraPatchContentDraftReadinessSnapshot = {
  safeToCreatePatchContentDraft: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  sourceProposalPath: string | null;
  sourceProposalHash: string | null;
  existingDraftPath: string | null;
  existingDraftHash: string | null;
  patchAlreadyApplied: boolean;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  draft: VeraImplementationPatchContentDraft | null;
  readiness: VeraPatchContentDraftReadinessSnapshot;
};

export function canShowVeraImplementationPatchContentDraftPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraImplementationPatchContentDraft(run.governanceNotes)) return true;
  if (run.currentStep === VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP) return true;
  return run.currentStep === VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP;
}

export function isVeraPatchContentDraftCreationEnabled(
  run: EngineeringRun,
  readiness: VeraPatchContentDraftReadinessSnapshot,
): boolean {
  if (hasVeraImplementationPatchContentDraft(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP) return false;
  return readiness.safeToCreatePatchContentDraft;
}

export function resolveVeraPatchContentDraftUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera patch content draft creation failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP) {
    return {
      success: null,
      error: "Patch content draft metadata did not persist on the run.",
    };
  }
  return {
    success:
      "Patch content draft created — review, patch application, commit, PR, merge, deploy, and release remain gated.",
    error: null,
  };
}

export function VeraImplementationPatchContentDraftPanel({
  run,
  taskId,
  draft,
  readiness,
}: Props) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [note, setNote] = useState("");
  const [patchEntriesJson, setPatchEntriesJson] = useState(DEFAULT_PATCH_ENTRIES_JSON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState(run);

  const notes = parseVeraRunGovernanceNotes(latestRun.governanceNotes);
  const draftExists = hasVeraImplementationPatchContentDraft(latestRun.governanceNotes);
  const creationEnabled = isVeraPatchContentDraftCreationEnabled(latestRun, readiness);

  if (!canShowVeraImplementationPatchContentDraftPanel(latestRun)) {
    return null;
  }

  async function submitDraft() {
    setError(null);
    setSuccess(null);
    if (confirmation.trim() !== VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE) {
      setError(`Type exactly: ${VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE}`);
      return;
    }

    let patchEntries: unknown;
    try {
      patchEntries = JSON.parse(patchEntriesJson);
    } catch {
      setError("Patch entries must be valid JSON.");
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/vera-patch-content-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmationText: confirmation.trim(),
            note: note.trim() || undefined,
            patchEntries,
          }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        run?: EngineeringRun;
      };
      const outcome = resolveVeraPatchContentDraftUiOutcome({
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
      setError("Vera patch content draft request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Create Vera patch content draft</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Stores explicit operator-supplied patch entries as a governed artifact. This does not apply
        patches or mutate repository files.
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
          <dt className="text-[var(--muted)]">Source proposal path</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.sourceProposalPath ?? notes.veraImplementationPatchProposalPath ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Source proposal hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.sourceProposalHash ?? notes.veraImplementationPatchProposalHash ?? "—"}
          </dd>
        </div>
        {draftExists ? (
          <>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Draft path</dt>
              <dd className="break-all font-mono text-xs">
                {notes.veraImplementationPatchContentDraftPath ?? "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Draft hash</dt>
              <dd className="break-all font-mono text-xs">
                {notes.veraImplementationPatchContentDraftHash ?? "—"}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {draft?.nextGate ? (
        <p className="mt-4 text-sm text-amber-200">
          Next gate ({draft.nextGate.phase}): {draft.nextGate.note}
        </p>
      ) : null}

      {draftExists ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">
            Draft status: {notes.veraImplementationPatchContentDraftStatus ?? "draft_created"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Created by {notes.veraImplementationPatchContentDraftCreatedBy ?? "operator"} at{" "}
            {notes.veraImplementationPatchContentDraftCreatedAt ?? "—"}
          </p>
          <p className="mt-2 text-sm">
            Entries: {notes.veraImplementationPatchContentDraftEntryCount ?? draft?.validation.entryCount ?? "—"}
          </p>
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
            <li>This does not apply the patch.</li>
            <li>This only stores explicit patch content for review.</li>
            <li>Patch application, commit, PR, merge, deploy, and release remain gated.</li>
          </ul>
        </>
      )}

      {success ? <p className="mt-4 text-sm text-green-300">{success}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      {!draftExists ? (
        <div className="mt-4 space-y-3 rounded border border-[var(--border)] p-3">
          <label className="block text-sm">
            Confirmation phrase
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE}
              disabled={!creationEnabled || busy}
            />
          </label>
          <label className="block text-sm">
            Patch entries (JSON)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
              rows={12}
              value={patchEntriesJson}
              onChange={(event) => setPatchEntriesJson(event.target.value)}
              disabled={!creationEnabled || busy}
            />
          </label>
          <label className="block text-sm">
            Note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!creationEnabled || busy}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={!creationEnabled || busy}
            onClick={() => submitDraft()}
          >
            Create patch content draft
          </button>
        </div>
      ) : null}
    </section>
  );
}
