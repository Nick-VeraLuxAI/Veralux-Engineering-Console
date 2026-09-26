import { engineerConsoleFetch } from "@/lib/engineer-console-client/fetch";
import {
  buildCommissionTaskCreatePayload,
  publicCommissionTaskError,
} from "@/lib/engineer-console/dashboard/commission-task-intent";
import { isTerminalRunStatus } from "@/lib/engineer-console/dashboard/fleet-commence";

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export type CommissionedTaskResult = {
  taskId: string;
  runId?: string;
  startError?: string;
  redirect: string;
};

export async function startAutonomousRunForTask(input: {
  taskId: string;
  title: string;
  objective: string;
  success: string;
  constraints: string;
}): Promise<{ runId?: string; error?: string }> {
  const listResponse = await engineerConsoleFetch(`/api/engineer-console/tasks/${input.taskId}/runs`, {
    method: "GET",
  });
  if (listResponse.ok) {
    const listed = (await listResponse.json()) as { runs?: Array<{ id?: string; status?: string }> };
    const latest = listed.runs?.find((run) => run && typeof run === "object");
    if (latest?.id && latest.status) {
      const status = latest.status.replace(/\s+/g, "_").toLowerCase();
      if (!isTerminalRunStatus(status) || status === "completed") {
        return { runId: latest.id };
      }
    }
  }

  const runResponse = await engineerConsoleFetch(`/api/engineer-console/tasks/${input.taskId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "autonomous",
      objective: input.objective.trim() || input.title.trim(),
      acceptanceCriteria: splitLines(input.success),
      constraints: splitLines(input.constraints),
    }),
  });
  const runData = (await runResponse.json()) as {
    error?: string;
    run?: { id: string };
  };
  if (!runResponse.ok || !runData.run) {
    return {
      error: publicCommissionTaskError(runData.error ?? "Could not start the autonomous run"),
    };
  }
  return { runId: runData.run.id };
}

export async function submitCommissionedTask(input: {
  title: string;
  objective: string;
  success: string;
  constraints: string;
  registeredRepoId: string;
  startRun: boolean;
}): Promise<CommissionedTaskResult> {
  const payload = buildCommissionTaskCreatePayload({
    title: input.title,
    objective: input.objective,
    success: input.success,
    constraints: input.constraints,
    registeredRepoId: input.registeredRepoId,
  });
  const response = await engineerConsoleFetch("/api/engineer-console/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as {
    error?: string;
    task?: { id: string };
  };
  if (!response.ok || !data.task) {
    throw new Error(publicCommissionTaskError(data.error ?? "Could not create the task"));
  }

  if (!input.startRun) {
    return { taskId: data.task.id, redirect: `/engineer/tasks/${data.task.id}` };
  }

  const started = await startAutonomousRunForTask({
    taskId: data.task.id,
    title: input.title,
    objective: input.objective,
    success: input.success,
    constraints: input.constraints,
  });
  if (started.error || !started.runId) {
    return {
      taskId: data.task.id,
      startError: started.error ?? "Could not start the autonomous run",
      redirect: `/engineer/tasks/${data.task.id}`,
    };
  }
  return {
    taskId: data.task.id,
    runId: started.runId,
    redirect: `/engineer/runs/${started.runId}`,
  };
}
