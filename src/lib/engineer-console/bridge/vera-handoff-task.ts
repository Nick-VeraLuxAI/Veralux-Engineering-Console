import { assertRepoUsableForTask } from "../repo-intelligence/registered-repos/register-repo";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import type { EngineeringTask } from "../types";
import {
  extractVeraWorkOrderIdFromDescription,
  hasVeraHandoffNonExecutionNote,
  isVeraLuxOsHandoffDescription,
  VERA_HANDOFF_SOURCE,
  type VeraHandoffTaskAnalysis,
} from "./vera-handoff-task-types";

export {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_HANDOFF_SOURCE,
  VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
  VERA_WORK_ORDER_MODULE_PREFIX,
  extractVeraWorkOrderIdFromDescription,
  hasVeraHandoffNonExecutionNote,
} from "./vera-handoff-task-types";

export type { VeraHandoffTaskAnalysis } from "./vera-handoff-task-types";

export function isVeraLuxOsHandoffTask(task: EngineeringTask): boolean {
  return isVeraLuxOsHandoffDescription(task.description ?? "");
}

export function validateVeraHandoffRepoBinding(task: EngineeringTask): {
  ok: boolean;
  repoPath: string | null;
} {
  try {
    if (task.registeredRepoId?.trim()) {
      assertRepoUsableForTask(task.registeredRepoId);
    }
    const repoPath = resolveTaskTargetRepoPath(task);
    return { ok: Boolean(repoPath?.trim()), repoPath: repoPath?.trim() ? repoPath : null };
  } catch {
    return { ok: false, repoPath: null };
  }
}

export function analyzeVeraHandoffTask(task: EngineeringTask): VeraHandoffTaskAnalysis {
  const description = task.description ?? "";
  const veraHandoff = isVeraLuxOsHandoffDescription(description);

  if (!veraHandoff) {
    return {
      isVeraLuxOsHandoffTask: false,
      source: null,
      veraWorkOrderId: null,
      nonExecutionNotePresent: false,
      taskIsDraft: task.status === "draft",
      repoBindingPresent: false,
      repoPath: null,
      safeToPrepareRun: false,
      blockers: ["Task is not a VeraLux OS handoff."],
    };
  }

  const veraWorkOrderId = extractVeraWorkOrderIdFromDescription(description);
  const nonExecutionNotePresent = hasVeraHandoffNonExecutionNote(description);
  const taskIsDraft = task.status === "draft";
  const repoBinding = validateVeraHandoffRepoBinding(task);
  const blockers: string[] = [];

  if (!veraWorkOrderId) {
    blockers.push("Vera work order ID not found in handoff metadata.");
  }
  if (!nonExecutionNotePresent) {
    blockers.push("Non-execution safety note is missing from handoff.");
  }
  if (!taskIsDraft) {
    blockers.push(`Task must be draft before run preparation (current: ${task.status}).`);
  }
  if (!repoBinding.ok) {
    blockers.push("Valid repo binding is required.");
  }

  return {
    isVeraLuxOsHandoffTask: true,
    source: VERA_HANDOFF_SOURCE,
    veraWorkOrderId,
    nonExecutionNotePresent,
    taskIsDraft,
    repoBindingPresent: repoBinding.ok,
    repoPath: repoBinding.repoPath,
    safeToPrepareRun: blockers.length === 0,
    blockers,
  };
}
