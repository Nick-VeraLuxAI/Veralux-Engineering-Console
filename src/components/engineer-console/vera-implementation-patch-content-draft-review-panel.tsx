"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  getVeraImplementationPatchContentDraftReviewDecision,
  hasVeraImplementationPatchContentDraftReviewDecision,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraImplementationPatchContentDraft } from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION,
} from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraPatchContentDraftReviewReadinessSnapshot = {
  safeToReviewPatchContentDraft: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  draftPath: string | null;
  draftHash: string | null;
  draftSummary: {
    entryCount: number;
    filePaths: string[];
    actions: string[];
  } | null;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  draft: VeraImplementationPatchContentDraft | null;
  readiness: VeraPatchContentDraftReviewReadinessSnapshot;
};

export function canShowVeraImplementationPatchContentDraftReviewPanel(
  run: EngineeringRun,
): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraImplementationPatchContentDraftReviewDecision(run.governanceNotes)) return true;
  return run.currentStep === VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP;
}

export function isVeraPatchContentDraftReviewEnabled(
  run: EngineeringRun,
  readiness: VeraPatchContentDraftReviewReadinessSnapshot,
): boolean {
  if (run.currentStep !== VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP) return false;
  if (hasVeraImplementationPatchContentDraftReviewDecision(run.governanceNotes)) return false;
  return readiness.safeToReviewPatchContentDraft;
}

export function resolveVeraPatchContentDraftReviewUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  decision: "approved" | "rejected";
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera patch content draft review failed.",
    };
  }
  const expectedStep =
    input.decision === "approved"
      ? VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP
      : VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP;
  if (input.run?.currentStep !== expectedStep) {
    return {
      success: null,
      error: "Patch content draft review decision did not persist on the run.",
    };
  }
  return {
    success:
      input.decision === "approved"
        ? "Patch content draft approved — patch application, commit, PR, merge, deploy, and release remain gated."
        : "Patch content draft rejected — no patch was applied.",
    error: null,
  };
}

export function VeraImplementationPatchContentDraftReviewPanel({
  run,
  taskId,
  draft,
  readiness,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reviewerNote, setReviewerNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState(run);

  const notes = parseVeraRunGovernanceNotes(latestRun.governanceNotes);
  const reviewDecision = getVeraImplementationPatchContentDraftReviewDecision(
    latestRun.governanceNotes,
  );
  const reviewEnabled = isVeraPatchContentDraftReviewEnabled(latestRun, readiness);
  const entryCount =
    readiness.draftSummary?.entryCount ??
    notes.veraImplementationPatchContentDraftEntryCount ??
    draft?.validation.entryCount ??
    0;

  if (!canShowVeraImplementationPatchContentDraftReviewPanel(latestRun)) {
    return null;
  }

  async function submitReview(decision: "approved" | "rejected") {
    setError(null);
    setSuccess(null);
    const expectedPhrase =
      decision === "approved"
        ? VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION
        : VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION;
    if (confirmation.trim() !== expectedPhrase) {
      setError(`Type exactly: ${expectedPhrase}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/vera-patch-content-draft-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            confirmationText: confirmation.trim(),
            reviewerNote: reviewerNote.trim() || undefined,
          }),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        run?: EngineeringRun;
      };
      const outcome = resolveVeraPatchContentDraftReviewUiOutcome({
        apiOk: res.ok,
        apiMessage: res.ok ? undefined : data.error,
        decision,
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
      setMode(null);
      setConfirmation("");
      setReviewerNote("");
      router.refresh();
    } catch {
      setError("Vera patch content draft review request failed.");
    } finally {
      setBusy(false);
    }
  }

  const filePaths =
    readiness.draftSummary?.filePaths ?? draft?.patchEntries.map((entry) => entry.filePath) ?? [];
  const actions =
    readiness.draftSummary?.actions ?? draft?.patchEntries.map((entry) => entry.action) ?? [];

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Review Vera patch content draft</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Final human review of stored patch content before any future patch application phase.
        Approval does not apply patches or mutate repository files.
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
          <dd>{entryCount}</dd>
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
      </dl>

      {filePaths.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">Patch entries</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {filePaths.map((filePath, index) => (
              <li key={`${filePath}-${index}`}>
                <span className="font-mono text-xs">{filePath}</span>
                {actions[index] ? ` (${actions[index]})` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft?.nextGate ? (
        <p className="mt-4 text-sm text-amber-200">
          Next gate ({draft.nextGate.phase}): {draft.nextGate.note}
        </p>
      ) : null}

      {reviewDecision ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">Review decision: {reviewDecision}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Reviewed by {notes.veraImplementationPatchContentDraftReviewedBy ?? "operator"} at{" "}
            {notes.veraImplementationPatchContentDraftReviewedAt ?? "—"}
          </p>
          {notes.veraImplementationPatchContentDraftReviewNote ? (
            <p className="mt-2 text-sm">{notes.veraImplementationPatchContentDraftReviewNote}</p>
          ) : null}
          {reviewDecision === "approved" ? (
            <p className="mt-2 text-sm text-amber-200">
              Controlled patch application remains a separately gated phase.
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
            <li>Approval does not apply the patch.</li>
            <li>Approval does not commit, push, create PRs, merge, deploy, or release.</li>
            <li>
              Approval only unlocks the next separately gated patch application phase.
            </li>
          </ul>
        </>
      )}

      {success ? <p className="mt-4 text-sm text-green-300">{success}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      {!reviewDecision ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-2 text-sm disabled:opacity-50"
            disabled={!reviewEnabled || busy}
            onClick={() => {
              setMode("approve");
              setConfirmation("");
              setError(null);
              setSuccess(null);
            }}
          >
            Approve draft
          </button>
          <button
            type="button"
            className="rounded bg-red-800 px-3 py-2 text-sm disabled:opacity-50"
            disabled={!reviewEnabled || busy}
            onClick={() => {
              setMode("reject");
              setConfirmation("");
              setError(null);
              setSuccess(null);
            }}
          >
            Reject draft
          </button>
        </div>
      ) : null}

      {mode ? (
        <div className="mt-4 space-y-3 rounded border border-[var(--border)] p-3">
          <label className="block text-sm">
            Confirmation phrase
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={
                mode === "approve"
                  ? VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION
                  : VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION
              }
              disabled={busy}
            />
          </label>
          <label className="block text-sm">
            Reviewer note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={3}
              value={reviewerNote}
              onChange={(event) => setReviewerNote(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => submitReview(mode === "approve" ? "approved" : "rejected")}
            >
              {mode === "approve" ? "Confirm approve" : "Confirm reject"}
            </button>
            <button
              type="button"
              className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
