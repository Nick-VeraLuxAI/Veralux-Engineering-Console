"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  hasVeraCommit,
  hasVeraPullRequestPreparation,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import { VERA_IMPLEMENTATION_COMMIT_CREATED_STEP } from "@/lib/engineer-console/worker/vera-commit-report-types";
import type { VeraPullRequestPreparation } from "@/lib/engineer-console/worker/vera-pull-request-preparation-types";
import {
  VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
  VERA_PULL_REQUEST_CREATE_CONFIRMATION,
  VERA_PULL_REQUEST_CREATE_PHASE_2Y,
  VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH,
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
} from "@/lib/engineer-console/worker/vera-pull-request-preparation-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

export type VeraPullRequestPreparationReadinessSnapshot = {
  safeToPreparePullRequest: boolean;
  reasons: string[];
  checks: Array<{ id: string; ok: boolean; message: string }>;
  veraWorkOrderId: string | null;
  commitReportPath: string | null;
  commitReportHash: string | null;
  commitSha: string | null;
  parentHeadSha: string | null;
  baseBranch: string;
  headBranch: string | null;
  proposedPrFiles: Array<{ path: string; sha256: string }>;
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
};

type Props = {
  run: EngineeringRun;
  taskId: string;
  preparation: VeraPullRequestPreparation | null;
  readiness: VeraPullRequestPreparationReadinessSnapshot;
};

export function canShowVeraPullRequestPreparationPanel(run: EngineeringRun): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  if (hasVeraPullRequestPreparation(run.governanceNotes)) return true;
  if (!hasVeraCommit(run.governanceNotes)) return false;
  return run.currentStep === VERA_IMPLEMENTATION_COMMIT_CREATED_STEP;
}

export function isVeraPullRequestPreparationEnabled(
  run: EngineeringRun,
  readiness: VeraPullRequestPreparationReadinessSnapshot,
): boolean {
  if (hasVeraPullRequestPreparation(run.governanceNotes)) return false;
  if (run.currentStep !== VERA_IMPLEMENTATION_COMMIT_CREATED_STEP) {
    return false;
  }
  return readiness.safeToPreparePullRequest;
}

export function buildVeraPullRequestPreparationRequestBody(input: {
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

export function resolveVeraPullRequestPreparationUiOutcome(input: {
  apiOk: boolean;
  apiMessage?: string;
  run?: EngineeringRun;
}): { success: string | null; error: string | null } {
  if (!input.apiOk) {
    return {
      success: null,
      error: input.apiMessage ?? "Vera pull request preparation failed.",
    };
  }
  if (input.run?.currentStep !== VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP) {
    return {
      success: null,
      error: "Pull request preparation metadata did not persist on the run.",
    };
  }
  return {
    success:
      "PR preparation ready — metadata only. No push, GitHub, PR creation, merge, deploy, or release.",
    error: null,
  };
}

export function VeraPullRequestPreparationPanel({
  run,
  taskId,
  preparation,
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
  const preparationExists = hasVeraPullRequestPreparation(latestRun.governanceNotes);
  const prepareEnabled = isVeraPullRequestPreparationEnabled(latestRun, readiness);
  const commitReportHash =
    preparation?.sourceCommitReportHash ??
    notes.veraCommitReportHash ??
    readiness.commitReportHash;
  const commitSha =
    preparation?.commitSha ?? notes.veraCommitSha ?? readiness.commitSha;
  const baseBranch =
    preparation?.baseBranch ?? readiness.baseBranch ?? VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH;
  const headBranch =
    preparation?.headBranch ?? readiness.headBranch ?? latestRun.branchName;
  const proposedPrTitle =
    preparation?.proposedPrTitle ?? "Vera gated lifecycle recovery smoke";
  const proposedPrFiles =
    preparation?.proposedPrFiles ?? readiness.proposedPrFiles;
  const excludedDirtyFiles =
    preparation?.excludedDirtyFiles ?? readiness.excludedDirtyFiles;

  if (!canShowVeraPullRequestPreparationPanel(latestRun)) {
    return null;
  }

  async function submitPrepare() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await engineerConsoleFetch(
        `/api/engineer-console/runs/${latestRun.id}/prepare-vera-pull-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildVeraPullRequestPreparationRequestBody({
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
      const outcome = resolveVeraPullRequestPreparationUiOutcome({
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
      setError("Vera pull request preparation request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Prepare Vera pull request</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {
          "This prepares pull request metadata only. It does not push. It does not call GitHub. It does not create PRs. It does not merge. It does not deploy. It does not release."
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
          <dt className="text-[var(--muted)]">Commit report hash</dt>
          <dd className="font-mono text-xs break-all">{commitReportHash ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Commit SHA</dt>
          <dd className="font-mono text-xs break-all">{commitSha ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Base branch</dt>
          <dd className="font-mono text-xs">{baseBranch}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Head branch</dt>
          <dd className="font-mono text-xs">{headBranch ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Proposed PR title</dt>
          <dd>{proposedPrTitle}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Next gate</dt>
          <dd>
            {VERA_PULL_REQUEST_CREATE_PHASE_2Y}: {VERA_PULL_REQUEST_CREATE_CONFIRMATION}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <h3 className="text-sm font-medium">Proposed PR files</h3>
        <ul className="mt-2 space-y-1 text-sm font-mono">
          {proposedPrFiles.length === 0 ? (
            <li className="text-[var(--muted)]">None</li>
          ) : (
            proposedPrFiles.map((file) => (
              <li key={file.path}>
                {file.path}
                {file.sha256 ? ` (${file.sha256.slice(0, 12)}…)` : ""}
              </li>
            ))
          )}
        </ul>
      </div>

      {excludedDirtyFiles.length > 0 ? (
        <p className="mt-3 text-sm text-amber-200">
          Unrelated dirty files remain excluded from PR contents (
          {excludedDirtyFiles.length} nearby). PR files come only from the verified Vera
          commit.
        </p>
      ) : null}

      {!preparationExists ? (
        <div className="mt-4 space-y-3">
          {!prepareEnabled && readiness.reasons.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">
              {readiness.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <label className="block text-sm">
            <span className="text-[var(--muted)]">
              Type exactly: {VERA_PULL_REQUEST_PREPARATION_CONFIRMATION}
            </span>
            <input
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || !prepareEnabled}
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
              disabled={busy || !prepareEnabled}
              rows={2}
            />
          </label>
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            disabled={
              busy ||
              !prepareEnabled ||
              confirmation !== VERA_PULL_REQUEST_PREPARATION_CONFIRMATION
            }
            onClick={() => void submitPrepare()}
          >
            {busy ? "Preparing…" : "Prepare Vera pull request"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-emerald-300">
          Pull request preparation ready. Creation remains separately gated (
          {VERA_PULL_REQUEST_CREATE_PHASE_2Y}).
        </p>
      )}

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      {success ? <p className="mt-3 text-sm text-emerald-300">{success}</p> : null}
    </section>
  );
}
