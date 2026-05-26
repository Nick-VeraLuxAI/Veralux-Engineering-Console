"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { useState } from "react";
import type { StagingTaskPreset } from "@/lib/engineer-console/setup/setup-ux";
import type { OperatorQueueItem } from "@/lib/engineer-console/run-ux/operator-queue";
import type { EngineeringTask } from "@/lib/engineer-console/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Surface } from "@/components/ui/surface";
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
  const [taskListReady, setTaskListReady] = useState(false);
  const primaryLinkClassName =
    "inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";
  const secondaryLinkClassName =
    "inline-flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm font-medium text-[var(--muted)] transition hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";
  const latestItemByTaskId = new Map(
    taskQueueItems
      .filter((item) => item.taskId)
      .map((item) => [item.taskId as string, item]),
  );

  useEffect(() => {
    setTaskListReady(true);
  }, []);

  return (
    <div data-engineer-task-list-ready={taskListReady ? "true" : "false"}>
      <div className="mb-4">
        <Button onClick={() => setShowCreate(true)} variant="primary">
          Create task
        </Button>
      </div>
      {initialTasks.length === 0 ? (
        <EmptyState
          centered
          title={registeredRepoCount === 0 ? "Register a repo first" : "Create your first engineering task"}
          description={
            <>
              What is missing: there are no tasks yet. Why it matters: tasks are the safe entry
              point for runs and release workflows. What to click next:{" "}
              {registeredRepoCount === 0 ? (
                <>use the link below to open registered repositories, verify and index a repo, then create a task.</>
              ) : (
                <>click Create task to define the first run.</>
              )}
              {showStagingPreset ? (
                <span className="mt-3 block text-xs">
                  The staging README smoke task preset is available in the task form for safe smoke
                  verification.
                </span>
              ) : null}
            </>
          }
          action={
            registeredRepoCount === 0 ? (
              <Link href="/engineer/repos" className={primaryLinkClassName}>
                Open Registered repositories
              </Link>
            ) : null
          }
        />
      ) : (
        <Surface as="ul" className="divide-y divide-[var(--border)]" padding="none">
          {initialTasks.map((task) => {
            const latest = latestItemByTaskId.get(task.id) ?? null;
            return (
              <li key={task.id} className="p-4 sm:p-5">
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
                          {latest.ageLabel ? <span>Age: {latest.ageLabel}</span> : null}
                          <span>
                            {latest.lastUpdatedLabel}:{" "}
                            {new Date(latest.lastUpdatedAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-white">
                          Next action: {latest.nextAction}
                        </p>
                        {latest.isStale && latest.staleReason ? (
                          <p className="mt-1 text-sm text-amber-200">{latest.staleReason}</p>
                        ) : null}
                        {latest.handoffNote ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Takeover guidance: {latest.handoffNote}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {latest?.runId ? (
                      <Link
                        href={latest.href}
                        className={primaryLinkClassName}
                      >
                        Open run
                      </Link>
                    ) : null}
                    <Link
                      href={`/engineer/tasks/${task.id}`}
                      className={secondaryLinkClassName}
                    >
                      Open task
                    </Link>
                    {latest?.canStartRun ? <StartRunButton taskId={task.id} compact /> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </Surface>
      )}
      {showCreate && (
        <CreateTaskForm
          onClose={() => setShowCreate(false)}
          showStagingPreset={showStagingPreset}
          stagingTaskPreset={stagingTaskPreset}
          registeredRepoCount={registeredRepoCount}
        />
      )}
    </div>
  );
}
