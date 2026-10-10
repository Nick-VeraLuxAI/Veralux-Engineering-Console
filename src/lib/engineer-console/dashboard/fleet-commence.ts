import { publicCommissionTaskError } from "./commission-task-intent";
import type { FleetJobRef, MultitaskFleetItem } from "./multitask-fleet-intent";

const TERMINAL_RUN_STATUSES = new Set([
  "failed",
  "completed",
  "exhausted",
  "aborted",
]);

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return TERMINAL_RUN_STATUSES.has(status.replace(/\s+/g, "_").toLowerCase());
}

export function jobAtIndex(jobs: FleetJobRef[], index: number): FleetJobRef | undefined {
  return jobs.find((job) => job.itemIndex === index);
}

export function planFleetCommence(input: {
  items: MultitaskFleetItem[];
  jobs: FleetJobRef[];
  startAllRuns: boolean;
}): {
  taskIndexes: number[];
  createIndexes: number[];
  startIndexes: number[];
  showCommence: boolean;
  buttonLabel: string;
} {
  const taskIndexes = input.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === "commission_task")
    .map(({ index }) => index);

  const createIndexes = taskIndexes.filter((index) => !jobAtIndex(input.jobs, index)?.taskId);
  const startIndexes = input.startAllRuns ? [...taskIndexes] : [];
  const showCommence = createIndexes.length > 0 || startIndexes.length > 0;
  const taskCount = taskIndexes.length;
  const taskWord = createIndexes.length === 1 ? "task" : "tasks";
  const buttonLabel = input.startAllRuns
    ? `Run all ${taskCount} jobs`
    : `Create ${createIndexes.length} ${taskWord}`;

  return { taskIndexes, createIndexes, startIndexes, showCommence, buttonLabel };
}

export function publicRunFailureDetail(input: {
  agentMessage?: string | null;
  runStatus?: string | null;
  fallback?: string | null;
}): string | null {
  const fromAgent = input.agentMessage?.trim()
    ? publicCommissionTaskError(input.agentMessage)
    : "";
  if (fromAgent) return fromAgent;
  const fromFallback = input.fallback?.trim()
    ? publicCommissionTaskError(input.fallback)
    : "";
  if (fromFallback) return fromFallback;
  const status = input.runStatus?.replace(/\s+/g, "_").toLowerCase();
  if (status === "failed" || status === "exhausted" || status === "aborted") {
    return "The run stopped before the job finished. Open the run for the recorded step.";
  }
  return null;
}
