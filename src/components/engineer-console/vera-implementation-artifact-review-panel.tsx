"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  getVeraImplementationArtifactReviewDecision,
  hasVeraImplementationArtifactReviewDecision,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
  VERA_IMPLEMENTATION_ARTIFACT_APPROVE_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_ARTIFACT_REJECT_CONFIRMATION_PHRASE,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraImplementationWorkerArtifact } from "@/lib/engineer-console/worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP,
} from "@/lib/engineer-console/worker/vera-implementation-artifact-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraArtifactReviewReadinessSnapshot = {
  safeToReviewArtifact: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  artifactPath: string | null;
  artifactHash: string | null;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  artifact: VeraImplementationWorkerArtifact | null;
  readiness: VeraArtifactReviewReadinessSnapshot;
};

export function canShowVeraImplementationArtifactReviewPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraImplementationArtifactReviewDecision(run.governanceNotes)) return true;
  return run.currentStep === VERA_IMPLEMENTATION_ARTIFACT_READY_STEP;
}

export function isVeraArtifactReviewEnabled(
  run: EngineeringRun,
  readiness: VeraArtifactReviewReadinessSnapshot,
): boolean {
  if (run.currentStep !== VERA_IMPLEMENTATION_ARTIFACT_READY_STEP) return false;
  if (hasVeraImplementationArtifactReviewDecision(run.governanceNotes)) return false;
  return readiness.safeToReviewArtifact;
}

export function resolveVeraArtifactReviewUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  decision: "approved" | "rejected";
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera artifact review failed.",
    };
  }
  const expectedStep =
    input.decision === "approved"
      ? VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP
      : VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP;
  if (input.run?.currentStep !== expectedStep) {
    return {
      success: null,
      error: "Artifact review decision did not persist on the run.",
    };
  }
  return {
    success:
      input.decision === "approved"
        ? "Artifact approved — patch/commit/PR/merge/deploy remain gated."
        : "Artifact rejected — no patch/commit/PR/merge/deploy performed.",
    error: null,
  };
}

export function VeraImplementationArtifactReviewPanel({
  run,
  taskId,
  artifact,
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
  const reviewDecision = getVeraImplementationArtifactReviewDecision(latestRun.governanceNotes);
  const reviewEnabled = isVeraArtifactReviewEnabled(latestRun, readiness);

  if (!canShowVeraImplementationArtifactReviewPanel(latestRun)) {
    return null;
  }

  async function submitReview(decision: "approved" | "rejected") {
    setError(null);
    setSuccess(null);
    const expectedPhrase =
      decision === "approved"
        ? VERA_IMPLEMENTATION_ARTIFACT_APPROVE_CONFIRMATION_PHRASE
        : VERA_IMPLEMENTATION_ARTIFACT_REJECT_CONFIRMATION_PHRASE;
    if (confirmation.trim() !== expectedPhrase) {
      setError(`Type exactly: ${expectedPhrase}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/vera-implementation-artifact-review`,
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
      const outcome = resolveVeraArtifactReviewUiOutcome({
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
      setError("Vera artifact review request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Review Vera implementation artifact</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Operator review gate for the deterministic implementation artifact. Approval only unlocks
        the next gated phase.
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
          <dd>{notes.veraWorkOrderId ?? artifact?.veraWorkOrderId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Status / step</dt>
          <dd>
            {latestRun.status} / {latestRun.currentStep ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Artifact path</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.artifactPath ?? notes.veraImplementationArtifactPath ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Artifact hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.artifactHash ?? notes.veraImplementationArtifactHash ?? "—"}
          </dd>
        </div>
      </dl>

      {artifact?.implementationSummary ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{artifact.implementationSummary}</p>
      ) : null}

      {reviewDecision ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">
            Review decision: {reviewDecision}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Reviewed by {notes.veraImplementationArtifactReviewedBy ?? "operator"} at{" "}
            {notes.veraImplementationArtifactReviewedAt ?? "—"}
          </p>
          {notes.veraImplementationArtifactReviewNote ? (
            <p className="mt-2 text-sm">{notes.veraImplementationArtifactReviewNote}</p>
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
            <li>Approval does not apply patches.</li>
            <li>Approval does not commit, push, create PRs, merge, deploy, or release.</li>
            <li>Approval only unlocks the next gated phase.</li>
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
            Approve artifact
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
            Reject artifact
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
                  ? VERA_IMPLEMENTATION_ARTIFACT_APPROVE_CONFIRMATION_PHRASE
                  : VERA_IMPLEMENTATION_ARTIFACT_REJECT_CONFIRMATION_PHRASE
              }
            />
          </label>
          <label className="block text-sm">
            Reviewer note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={3}
              value={reviewerNote}
              onChange={(event) => setReviewerNote(event.target.value)}
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
