import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import {
  evaluateHardReleaseGate,
  type EvaluateHardReleaseGateContext,
} from "./evaluate-hard-release-gate";
import { getPublicReleaseGateConfig } from "./release-gate-config";
import { recordHardReleaseGateAudit } from "./release-gate-audit-lifecycle";
import {
  HARD_RELEASE_GATE_ACTIONS,
  type HardReleaseGateAction,
  type HardReleaseGateEvaluation,
  ReleaseGateError,
} from "./release-gate-types";

export {
  evaluateHardReleaseGate,
  type EvaluateHardReleaseGateContext,
} from "./evaluate-hard-release-gate";
export {
  getReleaseGateConfig,
  getPublicReleaseGateConfig,
  isHardReleaseGatesEnabled,
} from "./release-gate-config";
export { ReleaseGateError } from "./release-gate-types";
export type { HardReleaseGateAction, HardReleaseGateEvaluation } from "./release-gate-types";

export function assertHardReleaseGateOrThrow(
  runId: string,
  action: HardReleaseGateAction,
  options: {
    actorLabel: string;
    audit?: boolean;
    context?: EvaluateHardReleaseGateContext;
  },
): HardReleaseGateEvaluation {
  const evaluation = evaluateHardReleaseGate(runId, action, options.context ?? {});

  if (evaluation.enabled && options.audit !== false) {
    const run = getRunById(runId);
    const task = run ? getTaskById(run.taskId) : null;
    recordHardReleaseGateAudit(runId, task?.id ?? null, evaluation, options.actorLabel);
  }

  if (evaluation.enabled && evaluation.status === "blocked") {
    throw new ReleaseGateError(
      evaluation.blockers[0] ?? "Hard release gate blocked this action.",
      evaluation,
    );
  }

  return evaluation;
}

export function getHardReleaseGateStatusForRun(runId: string): {
  config: ReturnType<typeof getPublicReleaseGateConfig>;
  evaluations: Record<HardReleaseGateAction, HardReleaseGateEvaluation>;
} {
  const evaluations = {} as Record<HardReleaseGateAction, HardReleaseGateEvaluation>;
  for (const action of HARD_RELEASE_GATE_ACTIONS) {
    evaluations[action] = evaluateHardReleaseGate(runId, action);
  }
  return {
    config: getPublicReleaseGateConfig(),
    evaluations,
  };
}

export function toPublicHardReleaseGateEvaluation(
  evaluation: HardReleaseGateEvaluation,
): Omit<HardReleaseGateEvaluation, "blockers"> & { blockers: string[]; blockerCount: number } {
  return {
    ...evaluation,
    blockers: evaluation.blockers.slice(0, 20),
    blockerCount: evaluation.blockers.length,
  };
}
