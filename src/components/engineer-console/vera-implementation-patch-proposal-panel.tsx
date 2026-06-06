"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  getVeraImplementationArtifactReviewDecision,
  hasVeraImplementationPatchProposal,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraImplementationPatchProposal } from "@/lib/engineer-console/worker/vera-implementation-patch-proposal-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP } from "@/lib/engineer-console/worker/vera-implementation-patch-proposal-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "@/lib/engineer-console/worker/vera-implementation-artifact-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraPatchProposalReadinessSnapshot = {
  safeToCreateProposal: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  sourceArtifactPath: string | null;
  sourceArtifactHash: string | null;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  proposal: VeraImplementationPatchProposal | null;
  readiness: VeraPatchProposalReadinessSnapshot;
};

export function canShowVeraImplementationPatchProposalPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraImplementationPatchProposal(run.governanceNotes)) return true;
  if (run.currentStep === VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP) return true;
  if (run.currentStep !== VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP) return false;
  return getVeraImplementationArtifactReviewDecision(run.governanceNotes) === "approved";
}

export function isVeraPatchProposalCreationEnabled(
  run: EngineeringRun,
  readiness: VeraPatchProposalReadinessSnapshot,
): boolean {
  if (hasVeraImplementationPatchProposal(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP) return false;
  if (getVeraImplementationArtifactReviewDecision(run.governanceNotes) !== "approved") {
    return false;
  }
  return readiness.safeToCreateProposal;
}

export function resolveVeraPatchProposalUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera patch proposal creation failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP) {
    return {
      success: null,
      error: "Patch proposal metadata did not persist on the run.",
    };
  }
  return {
    success:
      "Vera patch proposal created — patch application, commit, PR, merge, deploy, and release remain gated.",
    error: null,
  };
}

export function VeraImplementationPatchProposalPanel({
  run,
  taskId,
  proposal,
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
  const proposalExists = hasVeraImplementationPatchProposal(latestRun.governanceNotes);
  const creationEnabled = isVeraPatchProposalCreationEnabled(latestRun, readiness);

  if (!canShowVeraImplementationPatchProposalPanel(latestRun)) {
    return null;
  }

  async function submitProposal() {
    setError(null);
    setSuccess(null);
    if (confirmation.trim() !== VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE) {
      setError(`Type exactly: ${VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE}`);
      return;
    }

    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/vera-implementation-patch-proposal`,
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
        run?: EngineeringRun;
        alreadyExisted?: boolean;
      };
      if (data.alreadyExisted) {
        if (data.run) setLatestRun(data.run);
        setSuccess("Vera patch proposal already exists for this run.");
        setConfirmation("");
        setNote("");
        router.refresh();
        return;
      }
      const outcome = resolveVeraPatchProposalUiOutcome({
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
      setError("Vera patch proposal request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Create Vera patch proposal</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Generates a deterministic patch proposal artifact from the approved implementation
        artifact. This phase does not apply patches or mutate repository files.
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
          <dt className="text-[var(--muted)]">Approved artifact hash</dt>
          <dd className="break-all font-mono text-xs">
            {readiness.sourceArtifactHash ?? notes.veraImplementationArtifactHash ?? "—"}
          </dd>
        </div>
        {proposalExists ? (
          <>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Proposal path</dt>
              <dd className="break-all font-mono text-xs">
                {notes.veraImplementationPatchProposalPath ?? "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Proposal hash</dt>
              <dd className="break-all font-mono text-xs">
                {notes.veraImplementationPatchProposalHash ?? "—"}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {proposal?.summary ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{proposal.summary}</p>
      ) : null}

      {proposalExists ? (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">
            Step: {latestRun.currentStep ?? "—"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Created by {notes.veraImplementationPatchProposalCreatedBy ?? "operator"} at{" "}
            {notes.veraImplementationPatchProposalCreatedAt ?? "—"}
          </p>
          {proposal?.nextGate ? (
            <p className="mt-2 text-sm text-amber-200">
              Next gate ({proposal.nextGate.phase}): {proposal.nextGate.note}
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
            <li>This creates a proposal only.</li>
            <li>No patch is applied.</li>
            <li>No commit, push, PR, merge, deploy, or release happens.</li>
          </ul>
        </>
      )}

      {success ? <p className="mt-4 text-sm text-green-300">{success}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      {!proposalExists ? (
        <div className="mt-4 space-y-3 rounded border border-[var(--border)] p-3">
          <label className="block text-sm">
            Confirmation phrase
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE}
              disabled={!creationEnabled || busy}
            />
          </label>
          <label className="block text-sm">
            Note (optional)
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!creationEnabled || busy}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={!creationEnabled || busy}
            onClick={() => submitProposal()}
          >
            Create patch proposal
          </button>
        </div>
      ) : null}
    </section>
  );
}
