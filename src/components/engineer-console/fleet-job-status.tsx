"use client";

import React, { useEffect, useState } from "react";
import { publicRunFailureDetail } from "@/lib/engineer-console/dashboard/fleet-commence";
import {
  publicFleetStatusLine,
  publicJobTitle,
  publicRunStatusLabel,
  publicTaskStatusLabel,
  type FleetJobRef,
} from "@/lib/engineer-console/dashboard/multitask-fleet-intent";
import { ChatApprovalBar } from "./chat-approval-bar";

type View = {
  title: string;
  taskStatus: string | null;
  runStatus: string | null;
  runId: string | null;
  rawStatus: string | null;
  failureDetail: string | null;
};

function safeTaskPayload(data: unknown, fallbackTitle: string): View {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const task = record.task && typeof record.task === "object" ? (record.task as Record<string, unknown>) : {};
  return {
    title: publicJobTitle(task.title, fallbackTitle),
    taskStatus: publicTaskStatusLabel(task.status),
    runStatus: null,
    runId: null,
    rawStatus: null,
    failureDetail: null,
  };
}

function latestRunView(data: unknown): {
  runId: string | null;
  runStatus: string | null;
  rawStatus: string | null;
  failureDetail: string | null;
} {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const runs = Array.isArray(record.runs) ? record.runs : [];
  const latest = runs.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  if (!latest) return { runId: null, runStatus: null, rawStatus: null, failureDetail: null };
  const rawStatus = typeof latest.status === "string" ? latest.status : null;
  const runStatus = publicRunStatusLabel(latest.status);
  const agentMessage = typeof latest.agentMessage === "string" ? latest.agentMessage : null;
  const currentStep = typeof latest.currentStep === "string" ? latest.currentStep : null;
  return {
    runId: typeof latest.id === "string" ? latest.id : null,
    runStatus,
    rawStatus,
    failureDetail: publicRunFailureDetail({
      agentMessage,
      runStatus: rawStatus ?? runStatus,
      fallback: currentStep,
    }),
  };
}

function isWaitingForApproval(status: string | null): boolean {
  return (status ?? "").replace(/\s+/g, "_").toLowerCase() === "waiting_for_approval";
}

export function FleetJobStatus({ job }: { job: FleetJobRef }) {
  const [view, setView] = useState<View>({
    title: job.title,
    taskStatus: job.taskId ? "in progress" : job.repoId ? "mapped" : "waiting",
    runStatus: job.runId ? "in progress" : null,
    runId: job.runId ?? null,
    rawStatus: null,
    failureDetail: job.error ?? null,
  });

  useEffect(() => {
    if (!job.taskId) return;
    let cancelled = false;

    async function refresh() {
      try {
        const taskResponse = await fetch(`/api/engineer-console/tasks/${job.taskId}`, {
          credentials: "same-origin",
        });
        const taskData: unknown = await taskResponse.json();
        if (cancelled || !taskResponse.ok) return;
        const next = safeTaskPayload(taskData, job.title);
        const runsResponse = await fetch(`/api/engineer-console/tasks/${job.taskId}/runs`, {
          credentials: "same-origin",
        });
        const runsData: unknown = await runsResponse.json();
        if (cancelled) return;
        const latest = runsResponse.ok
          ? latestRunView(runsData)
          : {
              runId: job.runId ?? null,
              runStatus: job.runId ? "in progress" : null,
              rawStatus: null,
              failureDetail: job.error ?? null,
            };
        setView({
          ...next,
          runStatus: latest.runStatus,
          runId: latest.runId ?? job.runId ?? null,
          rawStatus: latest.rawStatus,
          failureDetail: latest.failureDetail ?? job.error ?? null,
        });
      } catch {
        if (!cancelled) {
          setView((current) => current);
        }
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job.taskId, job.runId, job.title, job.error]);

  const href = view.runId
    ? `/engineer/runs/${view.runId}`
    : job.runId
      ? `/engineer/runs/${job.runId}`
      : job.taskId
        ? `/engineer/tasks/${job.taskId}`
        : null;
  const label = publicFleetStatusLine(view);
  const pendingRunId = view.runId ?? job.runId ?? null;
  const waiting = isWaitingForApproval(view.rawStatus);

  if (!href) {
    return (
      <p data-fleet-job-status="true" className="text-[12px] text-white/60">
        {job.kind === "repo" ? `${job.title} · mapped` : `${job.title} · waiting`}
        {job.error ? ` · ${job.error}` : ""}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {waiting ? (
        <p data-fleet-job-status="true" className="text-[12px] text-white/70">
          {label}
        </p>
      ) : (
        <a
          href={href}
          data-fleet-job-status="true"
          className="block text-[12px] text-white/70 underline-offset-2 hover:underline"
        >
          {label}
        </a>
      )}
      {waiting && pendingRunId ? (
        <ChatApprovalBar
          pending={{
            runId: pendingRunId,
            title: view.title,
            href,
          }}
        />
      ) : null}
    </div>
  );
}
