import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { getRunById } from "../run-manager/run-manager";
import { auditAutonomousEvent } from "./audit";
import { executeAutonomousLoop, type AutonomousLoopDependencies } from "./loop";
import { getAutonomousState, persistAutonomousDocument } from "./state-store";
import type { AutonomousLoopResult } from "./types";

export function submitDirectorClarification(input: {
  runId: string;
  answer: string;
  actorLabel: string;
}): void {
  const state = getAutonomousState(input.runId);
  if (!state) {
    throw new Error(`Run ${input.runId} is not an autonomous engineer run`);
  }
  if (state.currentState !== "waiting_for_director") {
    throw new Error(`Run ${input.runId} is not waiting for a director answer (state: ${state.currentState})`);
  }
  const answer = input.answer.trim();
  if (!answer) {
    throw new Error("Clarification answer is required");
  }
  const document = state.document;
  const asked = document.clarification?.question ?? "";
  document.clarification = {
    question: asked,
    context: document.clarification?.context ?? "",
    askedAt: document.clarification?.askedAt ?? new Date().toISOString(),
    answer,
    answeredAt: new Date().toISOString(),
    answeredBy: input.actorLabel,
  };
  if (document.interpretedObjective) {
    for (const unknown of document.interpretedObjective.unknowns) {
      if (unknown.classification === "director" && !unknown.resolved) {
        unknown.resolved = true;
        unknown.resolution = answer;
      }
    }
    document.interpretedObjective.clarificationRequired = false;
    document.constraints.push(`Director answer: ${answer}`);
  }
  persistAutonomousDocument(input.runId, document);
  const run = getRunById(input.runId);
  auditAutonomousEvent(
    AUDIT_EVENT_TYPES.AUTONOMOUS_CLARIFICATION_ANSWERED,
    input.runId,
    run?.taskId ?? "",
    { answer, actorLabel: input.actorLabel },
  );
}

export async function answerClarificationAndResume(
  input: { runId: string; answer: string; actorLabel: string },
  deps: AutonomousLoopDependencies = {},
): Promise<AutonomousLoopResult> {
  submitDirectorClarification(input);
  return executeAutonomousLoop(input.runId, deps);
}
