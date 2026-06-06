"use client";

import {
  hasVeraImplementationArtifact,
  isVeraHandoffRunFromGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import type { VeraImplementationWorkerArtifact } from "@/lib/engineer-console/worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
} from "@/lib/engineer-console/worker/vera-implementation-artifact-types";
import type { EngineeringRun } from "@/lib/engineer-console/types";

type Props = {
  run: EngineeringRun;
  taskId: string;
  artifact: VeraImplementationWorkerArtifact | null;
};

export function canShowVeraImplementationArtifactPanel(
  run: EngineeringRun,
  artifact: VeraImplementationWorkerArtifact | null,
): boolean {
  if (!isVeraHandoffRunFromGovernanceNotes(run.governanceNotes)) return false;
  return (
    hasVeraImplementationArtifact(run.governanceNotes) ||
    artifact !== null ||
    run.currentStep === VERA_IMPLEMENTATION_ARTIFACT_READY_STEP ||
    run.currentStep === VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP
  );
}

export function resolveVeraImplementationArtifactHeadline(
  artifact: VeraImplementationWorkerArtifact | null,
): string {
  if (!artifact) return "Implementation artifact pending";
  if (artifact.workerStatus === "blocked") return "Implementation worker blocked";
  return "Implementation artifact ready";
}

export function VeraImplementationArtifactPanel({ run, taskId, artifact }: Props) {
  const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const headline = resolveVeraImplementationArtifactHeadline(artifact);

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">Vera implementation artifact</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Governed worker output for review. PR, merge, deploy, and release remain separately gated.
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Vera work order</dt>
          <dd>{notes.veraWorkOrderId ?? artifact?.veraWorkOrderId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Run ID</dt>
          <dd className="font-mono text-xs">{run.id}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Task ID</dt>
          <dd className="font-mono text-xs">{taskId}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Branch</dt>
          <dd>{run.branchName ?? artifact?.branchName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Worker status</dt>
          <dd>{artifact?.workerStatus ?? notes.veraImplementationWorkerStatus ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Worker mode</dt>
          <dd>{artifact?.workerMode ?? notes.veraImplementationWorkerMode ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Artifact path</dt>
          <dd className="break-all font-mono text-xs">
            {notes.veraImplementationArtifactPath ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Artifact hash</dt>
          <dd className="break-all font-mono text-xs">
            {notes.veraImplementationArtifactHash ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded border border-[var(--border)] bg-[var(--background)] p-3">
        <p className="text-sm font-medium">{headline}</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {artifact?.implementationSummary ??
            "No implementation artifact file was loaded for this run."}
        </p>
        {artifact?.interpretedObjective ? (
          <p className="mt-2 text-sm">
            <span className="text-[var(--muted)]">Objective: </span>
            {artifact.interpretedObjective}
          </p>
        ) : null}
      </div>

      {artifact?.warnings?.length ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-200">
          {artifact.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {artifact?.blockers?.length ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-red-300">
          {artifact.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>No PR created.</li>
        <li>No merge performed.</li>
        <li>No deployment performed.</li>
        <li>No release completion performed.</li>
      </ul>

      <p className="mt-4 text-sm text-[var(--muted)]">
        Next gated step: review the artifact, complete engineering review signoff, then use
        separate commit/PR/merge/deploy controls if authorized.
      </p>
    </section>
  );
}
