"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  getVeraPostPatchQualityReportReviewDecision,
  hasVeraPostPatchQualityReport,
  hasVeraPostPatchQualityReportReviewDecision,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraPostPatchQualityReport } from "@/lib/engineer-console/worker/vera-post-patch-quality-report-types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
} from "@/lib/engineer-console/worker/vera-post-patch-quality-report-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraPostPatchQualityReportReviewReadinessSnapshot = {
  safeToReviewPostPatchQualityReport: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  qualityReportPath: string | null;
  qualityReportHash: string | null;
  reportSummary: {
    overallStatus: string;
    validationMode: string;
    gateCount: number;
    nextGatePhase: string | null;
    nextGateConfirmationRequired: string | null;
  } | null;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  qualityReport: VeraPostPatchQualityReport | null;
  readiness: VeraPostPatchQualityReportReviewReadinessSnapshot;
};

export function canShowVeraPostPatchQualityReportReviewPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraPostPatchQualityReportReviewDecision(run.governanceNotes)) return true;
  return (
    hasVeraPostPatchQualityReport(run.governanceNotes) &&
    run.currentStep === VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP
  );
}

export function isVeraPostPatchQualityReportReviewEnabled(
  run: EngineeringRun,
  readiness: VeraPostPatchQualityReportReviewReadinessSnapshot,
): boolean {
  if (run.currentStep !== VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP) {
    return false;
  }
  if (hasVeraPostPatchQualityReportReviewDecision(run.governanceNotes)) return false;
  return readiness.safeToReviewPostPatchQualityReport;
}

export function buildVeraPostPatchQualityReportReviewRequestBody(input: {
  decision: "approved" | "rejected";
  confirmationText: string;
  note?: string;
}): { decision: "approved" | "rejected"; confirmationText: string; note?: string } {
  const body: {
    decision: "approved" | "rejected";
    confirmationText: string;
    note?: string;
  } = {
    decision: input.decision,
    // Exact operator input — no trim.
    confirmationText: input.confirmationText,
  };
  const trimmedNote = input.note?.trim();
  if (trimmedNote) {
    body.note = trimmedNote;
  }
  return body;
}

export function resolveVeraPostPatchQualityReportReviewUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  decision: "approved" | "rejected";
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera post-patch quality report review failed.",
    };
  }
  const expectedStep =
    input.decision === "approved"
      ? VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP
      : VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP;
  if (input.run?.currentStep !== expectedStep) {
    return {
      success: null,
      error: "Post-patch quality report review decision did not persist on the run.",
    };
  }
  return {
    success:
      input.decision === "approved"
        ? "Quality report approved — review only. No commit, PR, merge, deploy, or release."
        : "Quality report rejected — no commit, PR, merge, deploy, or release.",
    error: null,
  };
}

export function VeraPostPatchQualityReportReviewPanel({
  run,
  taskId,
  qualityReport,
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
  const reviewDecision = getVeraPostPatchQualityReportReviewDecision(latestRun.governanceNotes);
  const reviewEnabled = isVeraPostPatchQualityReportReviewEnabled(latestRun, readiness);

  const overallStatus =
    readiness.reportSummary?.overallStatus ?? qualityReport?.overallStatus ?? "—";
  const validationMode =
    readiness.reportSummary?.validationMode ?? qualityReport?.validationMode ?? "—";
  const gateCount =
    readiness.reportSummary?.gateCount ?? qualityReport?.gateResults?.length ?? 0;
  const nextGatePhase =
    readiness.reportSummary?.nextGatePhase ?? qualityReport?.nextGate?.phase ?? "—";
  const nextGateConfirmation =
    readiness.reportSummary?.nextGateConfirmationRequired ??
    qualityReport?.nextGate?.confirmationRequired ??
    "—";

  if (!canShowVeraPostPatchQualityReportReviewPanel(latestRun)) {
    return null;
  }

  async function submitReview(decision: "approved" | "rejected") {
    setError(null);
    setSuccess(null);
    const expectedPhrase =
      decision === "approved"
        ? VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION
        : VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION;
    // Exact match — no client trim.
    if (confirmation !== expectedPhrase) {
      setError(`Type exactly: ${expectedPhrase}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/vera-post-patch-quality-report-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVeraPostPatchQualityReportReviewRequestBody({
              decision,
              confirmationText: confirmation,
              note: reviewerNote,
            }),
          ),
        },
      );
      const data = (await res.json()) as {
        error?: string;
        run?: EngineeringRun;
      };
      const outcome = resolveVeraPostPatchQualityReportReviewUiOutcome({
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
      setError("Vera post-patch quality report review request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Review Vera post-patch quality report</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Human review of the post-patch quality report only. This does not create a commit
        proposal, commit, PR, merge, deploy, or release.
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
          <dt className="text-[var(--muted)]">Overall status</dt>
          <dd>{overallStatus}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Validation mode</dt>
          <dd className="font-mono text-xs">{validationMode}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Gate count</dt>
          <dd>{gateCount}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Next gate</dt>
          <dd>
            {nextGatePhase} — {nextGateConfirmation}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Report path</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.qualityReportPath ?? notes.veraPostPatchQualityReportPath ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Report hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.qualityReportHash ?? notes.veraPostPatchQualityReportHash ?? "—"}
          </dd>
        </div>
      </dl>

      {reviewDecision ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">Review decision: {reviewDecision}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Reviewed by {notes.veraPostPatchQualityReportReviewedBy ?? "operator"} at{" "}
            {notes.veraPostPatchQualityReportReviewedAt ?? "—"}
          </p>
          {notes.veraPostPatchQualityReportReviewNote ? (
            <p className="mt-2 text-sm">{notes.veraPostPatchQualityReportReviewNote}</p>
          ) : null}
          {reviewDecision === "approved" ? (
            <p className="mt-2 text-sm text-amber-200">
              Commit proposal remains a separately gated phase. No commit, PR, merge, deploy,
              or release was performed.
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-200">
              Rejection is fail-closed. Re-approval requires a new governed path.
            </p>
          )}
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
            <li>Review only.</li>
            <li>No commit.</li>
            <li>No PR.</li>
            <li>No merge.</li>
            <li>No deploy.</li>
            <li>No release.</li>
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
            Approve quality report
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
            Reject quality report
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
                  ? VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION
                  : VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION
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
