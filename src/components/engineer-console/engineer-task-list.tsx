"use client";

import Link from "next/link";
import { useState } from "react";
import type { EngineeringTask } from "@/lib/engineer-console/types";
import { StatusBadge } from "./status-badge";
import { CreateTaskForm } from "./create-task-form";

export function EngineerTaskList({ initialTasks }: { initialTasks: EngineeringTask[] }) {
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
        <p className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">
          No tasks yet. Create one to get started.
        </p>
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
      {showCreate && <CreateTaskForm onClose={() => setShowCreate(false)} />}
    </>
  );
}
