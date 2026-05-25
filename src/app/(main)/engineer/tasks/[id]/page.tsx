import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { listRunsForTask } from "@/lib/engineer-console/run-manager/run-manager";
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
        <StartRunButton taskId={task.id} />
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
          {runs.map((run) => (
            <li key={run.id}>
              <Link
                href={`/engineer/runs/${run.id}`}
                className="flex flex-col gap-2 p-4 hover:bg-[var(--background)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-mono text-xs">{run.branchName ?? "branch pending"}</p>
                  <p className="text-xs text-[var(--muted)]">step: {run.currentStep ?? "—"}</p>
                </div>
                <StatusBadge status={run.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
