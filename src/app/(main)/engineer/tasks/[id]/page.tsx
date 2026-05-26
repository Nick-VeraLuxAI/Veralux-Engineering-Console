import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { listRunsForTask } from "@/lib/engineer-console/run-manager/run-manager";
import {
  buildOperatorQueueItemFromSnapshot,
  buildOperatorQueueSnapshot,
} from "@/lib/engineer-console/run-ux/operator-queue";
import { getTaskById } from "@/lib/engineer-console/task-manager/task-manager";
import { StatusBadge } from "@/components/engineer-console/status-badge";
import { StartRunButton } from "@/components/engineer-console/start-run-button";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  ensureEngineerConsoleReady();
  const { id } = await params;
  const task = getTaskById(id);
  if (!task) notFound();

  const runs = listRunsForTask(id);
  const latestRun = runs[0] ?? null;
  const canStartRun = !latestRun || latestRun.status === "failed" || latestRun.status === "completed";
  const runSnapshots = await Promise.all(
    runs.map(async (run) => {
      const snapshot = await buildOperatorQueueSnapshot(task, run);
      const queueItem = buildOperatorQueueItemFromSnapshot(snapshot);
      return { run, snapshot, queueItem };
    }),
  );

  return (
    <div>
      <Link href="/engineer" className="text-sm text-[var(--muted)] hover:text-white">
        ← Tasks
      </Link>
      <div className="mt-4 mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{task.title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{task.description || "No description"}</p>
          <p className="mt-2 font-mono text-xs">{task.targetRepoPath}</p>
          <div className="mt-3 flex gap-2">
            <StatusBadge status={task.status} />
            <StatusBadge status={task.priority} />
          </div>
        </div>
        {canStartRun ? (
          <StartRunButton taskId={task.id} />
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted)]">
            Review the latest run before starting another one.
          </div>
        )}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Runs</h2>
      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          <p className="font-medium text-white">Start run</p>
          <p className="mt-2">
            What is missing: this task has no runs yet. Why it matters: runs create the branch and
            open the guided workflow for worker plans, approval, PR creation, and release controls.
            What to click next: use <strong>Start run</strong> above.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {runSnapshots.map(({ run, snapshot, queueItem }) => (
            <li key={run.id} className="p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs text-white">{run.id.slice(0, 8)}</p>
                    <StatusBadge status={run.status} />
                    <span className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                      {snapshot.guidance?.currentStageLabel ?? "Task"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                    {run.branchName ?? "branch pending"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                    <span>
                      {queueItem.blockerCount} blocker(s), {queueItem.warningCount} warning(s)
                    </span>
                    {queueItem.ageLabel ? <span>Age: {queueItem.ageLabel}</span> : null}
                    <span>
                      {queueItem.lastUpdatedLabel}:{" "}
                      {new Date(queueItem.lastUpdatedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-white">
                    Next action: {queueItem.nextAction}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{queueItem.reason}</p>
                  {queueItem.staleReason ? (
                    <p className="mt-1 text-sm text-amber-200">{queueItem.staleReason}</p>
                  ) : null}
                  {queueItem.handoffNote ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Takeover guidance: {queueItem.handoffNote}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/engineer/runs/${run.id}`}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-white hover:bg-[var(--background)]"
                  >
                    Open run
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
