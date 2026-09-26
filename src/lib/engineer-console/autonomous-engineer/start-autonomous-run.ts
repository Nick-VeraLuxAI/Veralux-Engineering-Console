import { createRun, getRunById, updateRun } from "../run-manager/run-manager";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import { createAutonomousState, getAutonomousState, persistAutonomousDocument } from "./state-store";
import { executeAutonomousLoop, type AutonomousLoopDependencies } from "./loop";
import type { AutonomousLoopResult } from "./types";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { auditAutonomousEvent } from "./audit";

export interface StartAutonomousRunInput {
  taskId: string;
  objective?: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  authorizedPathPrefixes?: string[];
}

export async function startAutonomousRun(
  input: StartAutonomousRunInput,
  deps: AutonomousLoopDependencies = {},
): Promise<{ runId: string; taskId: string; result: AutonomousLoopResult }> {
  const task = getTaskById(input.taskId);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const run = createRun(task.id, "autonomous_engineer");
  const objective = (input.objective ?? task.description ?? task.title).trim();
  createAutonomousState({
    runId: run.id,
    task,
    objective,
    acceptanceCriteria: input.acceptanceCriteria,
    constraints: input.constraints,
    authorizedPathPrefixes: input.authorizedPathPrefixes,
  });
  updateTask(task.id, { status: "running" });
  updateRun(run.id, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: new Date().toISOString(),
  });

  const result = await executeAutonomousLoop(run.id, deps);
  return { runId: run.id, taskId: task.id, result };
}

export async function resumeAutonomousRun(
  runId: string,
  deps: AutonomousLoopDependencies = {},
): Promise<AutonomousLoopResult> {
  const run = getRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!getAutonomousState(runId)) {
    throw new Error(`Run ${runId} is not an autonomous engineer run`);
  }
  return executeAutonomousLoop(runId, deps);
}

export function abortAutonomousRun(
  runId: string,
  input: { reason: string; actorLabel: string },
): void {
  const state = getAutonomousState(runId);
  if (!state) throw new Error(`Run ${runId} is not an autonomous engineer run`);
  const document = state.document;
  document.currentState = "aborted";
  document.directorAbortReason = input.reason;
  document.failureClass = "DIRECTOR_DECISION_REQUIRED";
  document.deliveryCandidateStatus = "withdrawn";
  document.escalationReason = input.reason;
  persistAutonomousDocument(runId, document);
  updateRun(runId, {
    status: "aborted",
    currentStep: "aborted",
    completedAt: new Date().toISOString(),
    agentMessage: input.reason,
  });
  const run = getRunById(runId);
  if (run) {
    updateTask(run.taskId, { status: "stopped" });
    auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_ABORTED, runId, run.taskId, {
      reason: input.reason,
      actorLabel: input.actorLabel,
    });
  }
}
