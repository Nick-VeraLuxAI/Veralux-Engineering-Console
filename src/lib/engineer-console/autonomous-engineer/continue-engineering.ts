import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import { updateTask } from "../task-manager/task-manager";
import { auditAutonomousEvent } from "./audit";
import { executeAutonomousLoop, type AutonomousLoopDependencies } from "./loop";
import { getAutonomousState, persistAutonomousDocument, transitionAutonomousState } from "./state-store";
import type { AutonomousLoopResult } from "./types";

/**
 * Operator rejected a delivery candidate and wants AE to keep iterating on the same run.
 * Records feedback into constraints, clears delivery-ready, transitions to diagnosing, resumes loop.
 */
export function prepareContinueEngineering(input: {
  runId: string;
  feedback: string;
  actorLabel: string;
}): void {
  const state = getAutonomousState(input.runId);
  if (!state) {
    throw new Error(`Run ${input.runId} is not an autonomous engineer run`);
  }
  if (state.currentState !== "waiting_for_approval") {
    throw new Error(
      `Continue engineering only works from waiting_for_approval (state: ${state.currentState})`,
    );
  }
  const feedback = input.feedback.trim();
  if (!feedback) {
    throw new Error("Feedback is required to continue engineering");
  }

  let document = state.document;
  const stamped = `Operator continue-engineering (${new Date().toISOString()}): ${feedback}`;
  document.constraints = [...document.constraints, stamped].slice(-40);
  document.decisions.push({
    at: new Date().toISOString(),
    kind: "director",
    summary: "Operator requested continue engineering",
    rationale: feedback,
  });
  document.deliveryCandidateStatus = "blocked";
  document.completionEvaluation = null;
  document.escalationReason = null;
  document.failureClass = null;
  document.strategy = `Continue engineering: ${feedback.slice(0, 200)}`;

  document = transitionAutonomousState(input.runId, "diagnosing", document).document;
  persistAutonomousDocument(input.runId, document);

  const run = getRunById(input.runId);
  if (run) {
    updateRun(input.runId, {
      status: "diagnosing",
      currentStep: "diagnosing",
      completedAt: null,
      agentMessage: document.strategy,
    });
    updateTask(run.taskId, { status: "running" });
    auditAutonomousEvent(AUDIT_EVENT_TYPES.AUTONOMOUS_STATE_TRANSITION, input.runId, run.taskId, {
      from: "waiting_for_approval",
      to: "diagnosing",
      reason: "continue_engineering",
      actorLabel: input.actorLabel,
      feedback: feedback.slice(0, 500),
    });
  }
}

export async function continueEngineeringAndResume(
  input: { runId: string; feedback: string; actorLabel: string },
  deps: AutonomousLoopDependencies = {},
): Promise<AutonomousLoopResult> {
  prepareContinueEngineering(input);
  return executeAutonomousLoop(input.runId, deps);
}
