import type { AutonomousState } from "./types";

const ALLOWED_TRANSITIONS: Record<AutonomousState, AutonomousState[]> = {
  created: ["investigating", "aborted", "failed"],
  investigating: ["interpreting", "waiting_for_director", "exhausted", "failed", "aborted"],
  interpreting: [
    "waiting_for_director",
    "planning",
    "investigating",
    "exhausted",
    "failed",
    "aborted",
  ],
  waiting_for_director: ["investigating", "interpreting", "planning", "aborted", "failed", "exhausted"],
  planning: ["validating", "diagnosing", "waiting_for_director", "exhausted", "failed", "aborted"],
  validating: ["executing", "quality_checking", "reviewing", "diagnosing", "exhausted", "failed", "aborted"],
  executing: ["quality_checking", "diagnosing", "exhausted", "failed", "aborted"],
  quality_checking: ["reviewing", "diagnosing", "exhausted", "failed", "aborted"],
  diagnosing: ["planning", "waiting_for_director", "exhausted", "failed", "aborted"],
  reviewing: ["evaluating_completion", "diagnosing", "exhausted", "failed", "aborted"],
  evaluating_completion: [
    "waiting_for_approval",
    "diagnosing",
    "planning",
    "exhausted",
    "failed",
    "aborted",
  ],
  // Continue engineering (build/observe modes) may return to diagnosing/planning.
  waiting_for_approval: ["diagnosing", "planning", "aborted"],
  exhausted: [],
  failed: [],
  aborted: [],
};

export const TERMINAL_AUTONOMOUS_STATES: AutonomousState[] = [
  "waiting_for_approval",
  "exhausted",
  "failed",
  "aborted",
];

export const PAUSED_AUTONOMOUS_STATES: AutonomousState[] = ["waiting_for_director"];

export function canTransition(from: AutonomousState, to: AutonomousState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AutonomousState, to: AutonomousState): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new Error(`Illegal autonomous state transition: ${from} → ${to}`);
  }
}

export function isTerminalAutonomousState(state: AutonomousState): boolean {
  return TERMINAL_AUTONOMOUS_STATES.includes(state);
}

export function isPausedAutonomousState(state: AutonomousState): boolean {
  return PAUSED_AUTONOMOUS_STATES.includes(state);
}

export function autonomousStateToRunStatus(state: AutonomousState): string {
  switch (state) {
    case "created":
      return "pending";
    case "investigating":
    case "interpreting":
      return "investigating";
    case "waiting_for_director":
      return "waiting_for_director";
    case "planning":
    case "validating":
      return "validating_worker_plan";
    case "executing":
      return "executing_worker_plan";
    case "quality_checking":
      return "running_quality_gates";
    case "diagnosing":
      return "diagnosing";
    case "reviewing":
    case "evaluating_completion":
      return "reviewing";
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "exhausted":
      return "exhausted";
    case "aborted":
      return "aborted";
    case "failed":
      return "failed";
  }
}
