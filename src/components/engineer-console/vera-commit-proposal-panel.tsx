"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraCommitProposal,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraCommitProposal } from "@/lib/engineer-console/worker/vera-commit-proposal-types";
import {
  VERA_COMMIT_CREATE_CONFIRMATION,
  VERA_COMMIT_CREATE_PHASE_2W,
  VERA_COMMIT_PROPOSAL_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
} from "@/lib/engineer-console/worker/vera-commit-proposal-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP } from "@/lib/engineer-console/worker/vera-post-patch-quality-report-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraCommitProposalReadinessSnapshot = {
  safeToPrepareCommitProposal: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  applicationReportPath: string | null;
  applicationReportHash: string | null;
  qualityReportPath: string | null;
  qualityReportHash: string | null;
  approvedQualityReportHash: string | null;
  proposedFiles: Array<{ path: string; status: string; sha256: string }>;
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  commitProposal: VeraCommitProposal | null;
  readiness: VeraCommitProposalReadinessSnapshot;
};

export function canShowVeraCommitProposalPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraCommitProposal(run.governanceNotes)) return true;
  return run.currentStep === VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP;
}

export function isVeraCommitProposalPrepareEnabled(
  run: EngineeringRun,
  readiness: VeraCommitProposalReadinessSnapshot,
): boolean {
  if (hasVeraCommitProposal(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP) {
    return false;
  }
  return readiness.safeToPrepareCommitProposal;
}

export function buildVeraCommitProposalRequestBody(input: {
  confirmationText: string;
  note?: string;
}): { confirmationText: string; note?: string } {
  const body: { confirmationText: string; note?: string } = {
    // Exact operator input — no trim.
    confirmationText: input.confirmationText,
  };
  const trimmedNote = input.note?.trim();
  if (trimmedNote) {
    body.note = trimmedNote;
  }
  return body;
}

export function resolveVeraCommitProposalUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera commit proposal preparation failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP) {
    return {
      success: null,
      error: "Commit proposal metadata did not persist on the run.",
    };
  }
  return {
    success:
      "Commit proposal ready — proposal only. No staging, commit, push, PR, merge, deploy, or release.",
    error: null,
  };
}

export function VeraCommitProposalPanel({
  run,
  taskId,
  commitProposal,
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
  const proposalExists = hasVeraCommitProposal(latestRun.governanceNotes);
  const prepareEnabled = isVeraCommitProposalPrepareEnabled(latestRun, readiness);
  const proposedFiles =
    commitProposal?.proposedFiles ??
    readiness.proposedFiles.map((file) => ({
      path: file.path,
      status: file.status,
      sha256: file.sha256,
    }));
  const excludedDirtyFiles =
    commitProposal?.excludedDirtyFiles ?? readiness.excludedDirtyFiles;
  const dirtySummary =
    commitProposal?.dirtyWorkingTreeSummary ?? readiness.dirtyWorkingTreeSummary;

  if (!canShowVeraCommitProposalPanel(latestRun)) {
    return null;
  }

  async function submitPrepare() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/prepare-vera-commit-proposal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVeraCommitProposalRequestBody({
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
      const outcome = resolveVeraCommitProposalUiOutcome({
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
      setError("Vera commit proposal request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Prepare Vera commit proposal</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {
          "This prepares a commit proposal only. It does not stage. It does not commit. It does not push. It does not create PRs. It does not merge. It does not deploy. It does not release."
        }
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
          <dt className="text-[var(--muted)]">Approved quality report hash</dt>
          <dd className="break-all font-mono text-xs">
            {notes.veraPostPatchQualityReportApprovedHash ??
              readiness.approvedQualityReportHash ??
              "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Application report hash</dt>
          <dd className="break-all font-mono text-xs">
            {notes.veraImplementationPatchApplicationHash ??
              readiness.applicationReportHash ??
              "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Quality report hash</dt>
          <dd className="break-all font-mono text-xs">
            {notes.veraPostPatchQualityReportHash ?? readiness.qualityReportHash ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Proposed files</dt>
          <dd className="mt-1">
            {proposedFiles.length === 0 ? (
              <span>—</span>
            ) : (
              <ul className="space-y-1 font-mono text-xs">
                {proposedFiles.map((file) => (
                  <li key={file.path}>
                    {file.path} ({file.status}) · {file.sha256.slice(0, 12)}…
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Excluded dirty files / warning</dt>
          <dd className="mt-1 text-xs text-[var(--muted)]">{dirtySummary}</dd>
          {excludedDirtyFiles.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto font-mono text-xs">
              {excludedDirtyFiles.map((filePath) => (
                <li key={filePath}>{filePath}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Unrelated dirty files are intentionally excluded from this proposal.
            </p>
          )}
        </div>
        <div>
          <dt className="text-[var(--muted)]">Next gate</dt>
          <dd>
            Phase {VERA_COMMIT_CREATE_PHASE_2W}: {VERA_COMMIT_CREATE_CONFIRMATION}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Proposal status</dt>
          <dd>{notes.veraCommitProposalStatus ?? (proposalExists ? "proposal_created" : "—")}</dd>
        </div>
      </dl>

      {proposalExists ? (
        <p className="mt-4 text-sm text-emerald-400">
          Commit proposal already created. Commit creation remains separately gated.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {!prepareEnabled && readiness.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-300">
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <label className="block text-sm">
            <span className="text-[var(--muted)]">
              Confirmation (exact): {VERA_COMMIT_PROPOSAL_CONFIRMATION}
            </span>
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-black/20 px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || !prepareEnabled}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Note (optional)</span>
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-black/20 px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy || !prepareEnabled}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            onClick={() => void submitPrepare()}
            disabled={busy || !prepareEnabled}
          >
            {busy ? "Preparing…" : "Prepare commit proposal"}
          </button>
        </div>
      )}

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      {success ? <p className="mt-3 text-sm text-emerald-400">{success}</p> : null}
    </section>
  );
}
