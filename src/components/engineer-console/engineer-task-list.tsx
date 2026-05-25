"use client";

import React from "react";
import Link from "next/link";
import { useState } from "react";
import type { StagingTaskPreset } from "@/lib/engineer-console/setup/setup-ux";
import type { EngineeringTask } from "@/lib/engineer-console/types";
import { StatusBadge } from "./status-badge";
import { CreateTaskForm } from "./create-task-form";

export function EngineerTaskList({
  initialTasks,
  registeredRepoCount,
  showStagingPreset,
  stagingTaskPreset,
}: {
  initialTasks: EngineeringTask[];
  registeredRepoCount: number;
  showStagingPreset: boolean;
  stagingTaskPreset: StagingTaskPreset;
}) {
  const [showCreate, setShowCreate] = useState(false);

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
          {initialTasks.map((task) => (
            <li key={task.id}>
              <Link
                href={`/engineer/tasks/${task.id}`}
                className="flex flex-col gap-2 p-4 hover:bg-[var(--background)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{task.title}</p>
                  <p className="font-mono text-xs text-[var(--muted)]">{task.targetRepoPath}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={task.priority} />
                  <StatusBadge status={task.status} />
                </div>
              </Link>
            </li>
          ))}
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
