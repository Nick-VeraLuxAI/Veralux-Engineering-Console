"use client";

import React from "react";
import Link from "next/link";
import { useState } from "react";
import type { StagingTaskPreset } from "@/lib/engineer-console/setup/setup-ux";
import type { OperatorQueueItem } from "@/lib/engineer-console/run-ux/operator-queue";
import type { EngineeringTask } from "@/lib/engineer-console/types";
import { StatusBadge } from "./status-badge";
import { CreateTaskForm } from "./create-task-form";
import { StartRunButton } from "./start-run-button";

export function EngineerTaskList({
  initialTasks,
  taskQueueItems = [],
  registeredRepoCount,
  showStagingPreset,
  stagingTaskPreset,
}: {
  initialTasks: EngineeringTask[];
  taskQueueItems?: OperatorQueueItem[];
  registeredRepoCount: number;
  showStagingPreset: boolean;
  stagingTaskPreset: StagingTaskPreset;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const latestItemByTaskId = new Map(
    taskQueueItems
      .filter((item) => item.taskId)
      .map((item) => [item.taskId as string, item]),
  );

  return (
    <>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Create task
        </button>
      </div>
      {initialTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
          <p className="font-medium text-white">
            {registeredRepoCount === 0 ? "Register a repo first" : "Create your first engineering task"}
          </p>
          <p className="mt-2">
            What is missing: there are no tasks yet. Why it matters: tasks are the safe entry point
            for runs and release workflows. What to click next:{" "}
            {registeredRepoCount === 0 ? (
              <>
                open{" "}
                <Link href="/engineer/repos" className="underline underline-offset-2">
                  Registered repositories
                </Link>
                , verify and index a repo, then create a task.
              </>
            ) : (
              <>click <strong>Create task</strong> to define the first run.</>
            )}
          </p>
          {showStagingPreset ? (
            <p className="mt-3 text-xs">
              The staging README smoke task preset is available in the task form for safe smoke
              verification.
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {initialTasks.map((task) => {
            const latest = latestItemByTaskId.get(task.id) ?? null;
            return (
              <li key={task.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/engineer/tasks/${task.id}`}
                        className="font-medium text-white underline-offset-2 hover:underline"
                      >
                        {task.title}
                      </Link>
                      <StatusBadge status={task.priority} />
                      <StatusBadge status={task.status} />
                      {latest?.runId ? <StatusBadge status={latest.status} /> : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-[var(--muted)]">{task.targetRepoPath}</p>
                    {latest ? (
                      <>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                          <span>Latest stage: {latest.currentStageLabel}</span>
                          <span>
                            {latest.blockerCount} blocker(s), {latest.warningCount} warning(s)
                          </span>
                          <span>
                            {latest.lastUpdatedLabel}:{" "}
                            {new Date(latest.lastUpdatedAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-white">
                          Next action: {latest.nextAction}
                        </p>
                      </>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {latest?.runId ? (
                      <Link
                        href={latest.href}
                        className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-white hover:bg-[var(--background)]"
                      >
                        Open run
                      </Link>
                    ) : null}
                    <Link
                      href={`/engineer/tasks/${task.id}`}
                      className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-white"
                    >
                      Open task
                    </Link>
                    {latest?.canStartRun ? <StartRunButton taskId={task.id} compact /> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {showCreate && (
        <CreateTaskForm
          onClose={() => setShowCreate(false)}
          showStagingPreset={showStagingPreset}
          stagingTaskPreset={stagingTaskPreset}
          registeredRepoCount={registeredRepoCount}
        />
      )}
    </>
  );
}
