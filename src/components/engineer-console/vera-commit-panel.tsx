"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraCommit,
  hasVeraCommitProposal,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraCommitProposal } from "@/lib/engineer-console/worker/vera-commit-proposal-types";
import { VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP } from "@/lib/engineer-console/worker/vera-commit-proposal-types";
import type { VeraCommitReport } from "@/lib/engineer-console/worker/vera-commit-report-types";
import {
  VERA_COMMIT_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
  VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
  VERA_PULL_REQUEST_PREPARE_PHASE_2X,
} from "@/lib/engineer-console/worker/vera-commit-report-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraCommitReadinessSnapshot = {
  safeToCreateCommit: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  commitProposalPath: string | null;
  commitProposalHash: string | null;
  targetRepoPath: string | null;
  branchName: string | null;
  parentHeadSha: string | null;
  proposedFiles: Array<{ path: string; sha256: string; status: string }>;
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  commitProposal: VeraCommitProposal | null;
  commitReport: VeraCommitReport | null;
  readiness: VeraCommitReadinessSnapshot;
};

export function canShowVeraCommitPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraCommit(run.governanceNotes)) return true;
  if (!hasVeraCommitProposal(run.governanceNotes)) return false;
  return run.currentStep === VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP;
}

export function isVeraCommitCreateEnabled(
  run: EngineeringRun,
  readiness: VeraCommitReadinessSnapshot,
): boolean {
  if (hasVeraCommit(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP) {
    return false;
  }
  return readiness.safeToCreateCommit;
}

export function buildVeraCommitRequestBody(input: {
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

export function resolveVeraCommitUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera commit creation failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_COMMIT_CREATED_STEP) {
    return {
      success: null,
      error: "Commit metadata did not persist on the run.",
    };
  }
  return {
    success:
      "Vera commit created — local only. No push, PR, merge, deploy, or release.",
    error: null,
  };
}

export function VeraCommitPanel({
  run,
  taskId,
  commitProposal,
  commitReport,
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
  const commitExists = hasVeraCommit(latestRun.governanceNotes);
  const createEnabled = isVeraCommitCreateEnabled(latestRun, readiness);
  const proposedFiles =
    commitReport?.committedFiles ??
    commitProposal?.proposedFiles ??
    readiness.proposedFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
    }));
  const proposalHash =
    commitReport?.sourceCommitProposalHash ??
    notes.veraCommitProposalHash ??
    readiness.commitProposalHash;
  const branchName =
    commitReport?.branchName ??
    commitProposal?.branchName ??
    readiness.branchName ??
    latestRun.branchName;
  const parentHeadSha =
    commitReport?.parentHeadSha ??
    commitProposal?.targetHeadSha ??
    readiness.parentHeadSha;
  const commitSha = commitReport?.commitSha ?? notes.veraCommitSha ?? null;

  if (!canShowVeraCommitPanel(latestRun)) {
    return null;
  }

  async function submitCreate() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/create-vera-commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVeraCommitRequestBody({
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
      const outcome = resolveVeraCommitUiOutcome({
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
      setError("Vera commit request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Create Vera commit</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {
          "This creates a local commit only. It stages only approved proposal files. It does not push. It does not create PRs. It does not merge. It does not deploy. It does not release."
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
          <dt className="text-[var(--muted)]">Proposal hash</dt>
          <dd className="font-mono text-xs break-all">{proposalHash ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Target branch</dt>
          <dd className="font-mono text-xs">{branchName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Target parent HEAD</dt>
          <dd className="font-mono text-xs break-all">{parentHeadSha ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Commit SHA</dt>
          <dd className="font-mono text-xs break-all">{commitSha ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Next gate</dt>
          <dd>
            {VERA_PULL_REQUEST_PREPARE_PHASE_2X}: {VERA_PULL_REQUEST_PREPARE_CONFIRMATION}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <h3 className="text-sm font-medium">
          {commitExists ? "Committed files" : "Proposed files"}
        </h3>
        <ul className="mt-2 space-y-1 text-sm font-mono">
          {proposedFiles.length === 0 ? (
            <li className="text-[var(--muted)]">None</li>
          ) : (
            proposedFiles.map((file) => (
              <li key={file.path}>
                {file.path}
                {"sha256" in file && file.sha256 ? ` (${file.sha256.slice(0, 12)}…)` : ""}
              </li>
            ))
          )}
        </ul>
      </div>

      {!commitExists ? (
        <div className="mt-4 space-y-3">
          {!createEnabled && readiness.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <label className="block text-sm">
            <span className="text-[var(--muted)]">
              Type exactly: {VERA_COMMIT_CONFIRMATION}
            </span>
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || !createEnabled}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Note (optional)</span>
            <textarea
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy || !createEnabled}
              rows={2}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            disabled={busy || !createEnabled || confirmation !== VERA_COMMIT_CONFIRMATION}
            onClick={() => void submitCreate()}
          >
            {busy ? "Creating…" : "Create Vera commit"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-emerald-300">
          Local Vera commit created. Pull request preparation remains separately gated (
          {VERA_PULL_REQUEST_PREPARE_PHASE_2X}).
        </p>
      )}

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      {success ? <p className="mt-3 text-sm text-emerald-300">{success}</p> : null}
    </section>
  );
}
