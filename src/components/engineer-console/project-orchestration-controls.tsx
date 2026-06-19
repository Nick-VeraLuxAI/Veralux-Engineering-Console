"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import type {
  EngineerProject,
  OrchestrationDecision,
  ProjectRequirement,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-types";
import type { RequirementExecutionAttempt } from "@/lib/engineer-console/project-orchestration/requirement-execution-types";

export function resolveProjectControlAvailability(project: EngineerProject) {
  return {
    canStart: project.status !== "running",
    canPause: project.status !== "paused",
    canResume: project.status === "paused",
    canAdvance: project.status === "running",
  };
}

export function ProjectOrchestrationControls({
  project,
  currentRequirement,
  latestDecision,
  activeAttempt,
}: {
  project: EngineerProject;
  currentRequirement: ProjectRequirement | null;
  latestDecision: OrchestrationDecision | null;
  activeAttempt?: RequirementExecutionAttempt | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const availability = resolveProjectControlAvailability(project);

  async function post(path: string, action: string, body: Record<string, unknown> = {}) {
    setBusyAction(action);
    setError(null);
    try {
      const res = await engineerConsoleFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${action} failed`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  const buttonClass = "rounded border border-[var(--border)] px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50";

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Vera orchestration controls</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Execute one deterministic orchestration step at a time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            disabled={busyAction !== null || !availability.canStart}
            onClick={() => post(`/api/engineer-console/projects/${project.id}/start`, "Start")}
          >
            Start
          </button>
          <button
            className={buttonClass}
            disabled={busyAction !== null || !availability.canPause}
            onClick={() => post(`/api/engineer-console/projects/${project.id}/pause`, "Pause")}
          >
            Pause
          </button>
          <button
            className={buttonClass}
            disabled={busyAction !== null || !availability.canResume}
            onClick={() => post(`/api/engineer-console/projects/${project.id}/resume`, "Resume")}
          >
            Resume
          </button>
          <button
            className={buttonClass}
            disabled={busyAction !== null || !availability.canAdvance}
            onClick={() =>
              post(`/api/engineer-console/projects/${project.id}/advance`, "Advance", {
                maxSteps: 1,
              })
            }
          >
            Advance one step
          </button>
          <button
            className={buttonClass}
            disabled={busyAction !== null || project.status !== "running"}
            onClick={() =>
              post(`/api/engineer-console/projects/${project.id}/run`, "Run bounded loop", {
                maxSteps: 6,
                executeInline: false,
              })
            }
          >
            Run bounded loop
          </button>
        </div>
      </div>
      {busyAction ? <p className="mt-3 text-sm text-[var(--muted)]">{busyAction} in progress...</p> : null}
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Current requirement</p>
          <p className="mt-2 text-sm text-white">
            {currentRequirement
              ? `${currentRequirement.stableKey}: ${currentRequirement.title}`
              : "No requirement selected."}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Latest Vera decision</p>
          <p className="mt-2 text-sm text-white">
            {latestDecision ? `${latestDecision.decisionType}: ${latestDecision.reason}` : "No decision recorded."}
          </p>
        </div>
      </div>
      {activeAttempt ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Active attempt</p>
          <p className="mt-2 text-sm text-white">
            Attempt {activeAttempt.attemptNumber} · {activeAttempt.status} · {activeAttempt.strategy} ·{" "}
            {activeAttempt.modelName}
          </p>
          {activeAttempt.failureSummary ? (
            <p className="mt-2 text-sm text-amber-200">{activeAttempt.failureSummary}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={buttonClass}
              disabled={busyAction !== null}
              onClick={() =>
                post(
                  `/api/engineer-console/requirements/${activeAttempt.requirementId}/retry`,
                  "Retry",
                  { maxAttempts: 3 },
                )
              }
            >
              Retry
            </button>
            <button
              className={buttonClass}
              disabled={busyAction !== null}
              onClick={() =>
                post(
                  `/api/engineer-console/requirements/${activeAttempt.requirementId}/verify`,
                  "Verify",
                )
              }
            >
              Request verification
            </button>
            <button
              className={buttonClass}
              disabled={busyAction !== null}
              onClick={() =>
                post(`/api/engineer-console/attempts/${activeAttempt.id}/cancel`, "Cancel", {
                  reason: "Cancelled from project control UI.",
                })
              }
            >
              Cancel active attempt
            </button>
          </div>
        </div>
      ) : null}
      {currentRequirement ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <label className="block text-sm">
            Reopen current requirement with audit reason
            <input
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2"
            />
          </label>
          <button
            className="mt-3 rounded border border-amber-400/50 px-3 py-2 text-sm text-amber-100 disabled:opacity-50"
            disabled={busyAction !== null || !reopenReason.trim()}
            onClick={() =>
              post(
                `/api/engineer-console/requirements/${currentRequirement.id}/reopen`,
                "Reopen requirement",
                { reason: reopenReason },
              )
            }
          >
            Reopen requirement
          </button>
        </div>
      ) : null}
    </div>
  );
}
