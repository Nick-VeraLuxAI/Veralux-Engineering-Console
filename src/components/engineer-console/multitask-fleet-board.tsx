"use client";

import React, { useState } from "react";
import {
  startAutonomousRunForTask,
  submitCommissionedTask,
} from "@/lib/engineer-console-client/commission-task";
import { publicCommissionTaskError } from "@/lib/engineer-console/dashboard/commission-task-intent";
import {
  defaultStartRunAfterCreate,
  validateDraftTaskJob,
} from "@/lib/engineer-console/dashboard/draft-job-schema";
import { jobAtIndex, planFleetCommence } from "@/lib/engineer-console/dashboard/fleet-commence";
import {
  fleetWorkingRepoConflict,
  jobsFromFleet,
  type FleetJobRef,
  type MultitaskFleetProposal,
} from "@/lib/engineer-console/dashboard/multitask-fleet-intent";
import { FleetJobStatus } from "./fleet-job-status";
import { StartRepoForm } from "./start-repo-form";

export function MultitaskFleetBoard({
  proposal,
  jobs,
  workingRepo,
  onJobUpdate,
  onRepoStarted,
  onStartNewThread,
}: {
  proposal: MultitaskFleetProposal;
  jobs?: FleetJobRef[];
  workingRepo?: { id: string; name: string } | null;
  onJobUpdate?: (job: FleetJobRef) => void;
  onRepoStarted?: (input: { id: string; name: string }) => void;
  onStartNewThread?: () => void;
}) {
  const current = jobs && jobs.length ? jobs : jobsFromFleet(proposal);
  const [startAllRuns, setStartAllRuns] = useState(defaultStartRunAfterCreate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflict = fleetWorkingRepoConflict(proposal, workingRepo?.name);
  const plan = planFleetCommence({
    items: proposal.items,
    jobs: current,
    startAllRuns,
  });

  async function commenceFleet() {
    if (!workingRepo?.id || busy || conflict || !plan.showCommence) return;
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    const createdIds = new Map<number, string>();

    for (const index of plan.createIndexes) {
      const item = proposal.items[index];
      if (!item || item.type !== "commission_task") continue;
      const draft = {
        title: item.title ?? "",
        objective: item.objective ?? "",
        success: item.success ?? "",
        constraints: item.constraints ?? "",
      };
      const valid = validateDraftTaskJob({
        title: draft.title,
        objective: draft.objective,
        repo: workingRepo.name,
        repoId: workingRepo.id,
        startRunAfterCreate: startAllRuns,
      });
      if (!valid.valid) {
        const message = `Job ${index + 1}: ${valid.reasons.join("; ")}`;
        failures.push(message);
        onJobUpdate?.({
          itemIndex: index,
          kind: "task",
          title: draft.title || "Task",
          repoId: workingRepo.id,
          repoName: workingRepo.name,
          error: publicCommissionTaskError(message),
        });
        continue;
      }
      try {
        const commissioned = await submitCommissionedTask({
          title: draft.title,
          objective: draft.objective,
          success: draft.success,
          constraints: draft.constraints,
          registeredRepoId: workingRepo.id,
          startRun: false,
        });
        createdIds.set(index, commissioned.taskId);
        onJobUpdate?.({
          itemIndex: index,
          kind: "task",
          title: draft.title || "Task",
          repoId: workingRepo.id,
          repoName: workingRepo.name,
          taskId: commissioned.taskId,
          runId: null,
          error: null,
        });
      } catch (err) {
        const message = publicCommissionTaskError(err instanceof Error ? err.message : String(err));
        failures.push(`Job ${index + 1}: ${message}`);
        onJobUpdate?.({
          itemIndex: index,
          kind: "task",
          title: draft.title || "Task",
          repoId: workingRepo.id,
          repoName: workingRepo.name,
          error: message,
        });
      }
    }

    if (startAllRuns) {
      for (const index of plan.startIndexes) {
        const item = proposal.items[index];
        if (!item || item.type !== "commission_task") continue;
        const job = jobAtIndex(current, index);
        const taskId = createdIds.get(index) ?? job?.taskId;
        const draft = {
          title: item.title ?? job?.title ?? "",
          objective: item.objective ?? "",
          success: item.success ?? "",
          constraints: item.constraints ?? "",
        };
        if (!taskId) {
          failures.push(`Job ${index + 1}: task was not created, so no run started`);
          continue;
        }
        try {
          const started = await startAutonomousRunForTask({
            taskId,
            title: draft.title || "Task",
            objective: draft.objective,
            success: draft.success,
            constraints: draft.constraints,
          });
          if (started.error || !started.runId) {
            const message = started.error ?? "Could not start the autonomous run";
            failures.push(`Job ${index + 1}: ${message}`);
            onJobUpdate?.({
              itemIndex: index,
              kind: "task",
              title: draft.title || "Task",
              repoId: workingRepo.id,
              repoName: workingRepo.name,
              taskId,
              runId: job?.runId ?? null,
              error: message,
            });
            continue;
          }
          onJobUpdate?.({
            itemIndex: index,
            kind: "task",
            title: draft.title || "Task",
            repoId: workingRepo.id,
            repoName: workingRepo.name,
            taskId,
            runId: started.runId,
            error: null,
          });
        } catch (err) {
          const message = publicCommissionTaskError(err instanceof Error ? err.message : String(err));
          failures.push(`Job ${index + 1}: ${message}`);
          onJobUpdate?.({
            itemIndex: index,
            kind: "task",
            title: draft.title || "Task",
            repoId: workingRepo.id,
            repoName: workingRepo.name,
            taskId,
            error: message,
          });
        }
      }
    }

    if (failures.length) setError(failures.join(" "));
    setBusy(false);
  }

  return (
    <div data-multitask-fleet-board="true" className="space-y-3">
      <p className="text-[13px] text-white/60">
        {conflict
          ? "This split does not belong to the working repo."
          : "Compact split. Chat does not spawn workers. One commencement creates remaining tasks, then starts a run on every job if that box is on."}
      </p>
      {conflict ? (
        <div
          data-multitask-fleet-repo-conflict="true"
          className="space-y-1 rounded-[1rem] border border-amber-200/20 bg-amber-200/[0.06] p-3"
        >
          <p className="text-[12px] text-amber-100">{conflict}</p>
          {onStartNewThread ? (
            <button
              type="button"
              data-multitask-fleet-new-thread="true"
              onClick={onStartNewThread}
              className="inline-flex rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-[12px] text-white"
            >
              Start a new chat
            </button>
          ) : null}
        </div>
      ) : plan.showCommence ? (
        <div
          data-multitask-fleet-commence="true"
          className="space-y-2 rounded-[1rem] border border-white/12 bg-white/[0.04] p-3"
        >
          {error ? <p className="text-[12px] text-rose-300/80">{error}</p> : null}
          <label className="flex items-center gap-2 text-[13px] text-white">
            <input
              type="checkbox"
              data-multitask-fleet-start-all="true"
              checked={startAllRuns}
              onChange={(event) => setStartAllRuns(event.target.checked)}
            />
            Start Autonomous Run on every job
          </label>
          <button
            type="button"
            data-multitask-fleet-create-all="true"
            disabled={busy || !workingRepo?.id}
            onClick={() => void commenceFleet()}
            className="inline-flex rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-[12px] text-white disabled:opacity-40"
          >
            {busy ? (startAllRuns ? "Creating and starting every job…" : "Creating…") : plan.buttonLabel}
          </button>
        </div>
      ) : null}
      <ul className="space-y-1.5">
        {proposal.items.map((item, index) => {
          const job = current.find((entry) => entry.itemIndex === index) ?? current[index];
          const done = Boolean(job && (job.taskId || (job.kind === "repo" && job.repoId) || job.error));
          const title = item.type === "start_repo" ? item.name : item.title;
          const detail = item.type === "start_repo" ? item.description : item.objective;
          return (
            <li
              key={`${item.type}-${index}`}
              data-multitask-fleet-item={index}
              className="rounded-[0.85rem] border border-white/8 bg-black/20 px-3 py-2"
            >
              <p className="text-[12px] text-white">
                {index + 1}. {title ?? "Job"}
              </p>
              {done && job ? (
                <div className="mt-1">
                  <FleetJobStatus job={job} />
                </div>
              ) : conflict ? (
                <p className="mt-0.5 text-[13px] text-white/60">Not created</p>
              ) : item.type === "start_repo" ? (
                <div className="mt-2">
                  <StartRepoForm
                    initialName={item.name ?? ""}
                    initialDescription={item.description ?? ""}
                    onStarted={(started) => {
                      onRepoStarted?.({ id: started.id, name: started.name });
                      onJobUpdate?.({
                        itemIndex: index,
                        kind: "repo",
                        title: started.name,
                        repoId: started.id,
                        repoName: started.name,
                      });
                    }}
                  />
                </div>
              ) : (
                <p className="mt-0.5 line-clamp-2 text-[13px] text-white/60">{detail}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
