import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";

export function buildCommitMessage(runId: string): string {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const task = getTaskById(run.taskId);
  const title = task?.title?.trim() || "Engineering Console change";
  const shortRun = runId.replace(/-/g, "").slice(0, 8);
  return `${title} [run:${shortRun}]\n\nGenerated through VeraLux Engineering Console`;
}
