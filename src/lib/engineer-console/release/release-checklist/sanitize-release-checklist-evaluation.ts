import { redactDeploymentOutput } from "../deployment-execution/redact-deployment-output";
import type { ReleaseChecklistEvaluation, ReleaseChecklistItem } from "./release-checklist-types";

function redactItem(item: ReleaseChecklistItem): ReleaseChecklistItem {
  return {
    ...item,
    summary: redactDeploymentOutput(item.summary),
    recommendedAction: redactDeploymentOutput(item.recommendedAction),
  };
}

/** Allowlisted, redacted snapshot for DB storage — no diffs, logs, prompts, or response bodies. */
export function toStorableReleaseChecklistEvaluation(
  evaluation: ReleaseChecklistEvaluation,
): Omit<ReleaseChecklistEvaluation, "evidenceBundleId" | "evidenceBundleHash"> {
  return {
    runId: evaluation.runId,
    status: evaluation.status,
    evaluatedAt: evaluation.evaluatedAt,
    items: evaluation.items.map(redactItem),
    blockers: evaluation.blockers.map((b) => redactDeploymentOutput(b)),
    needsAttention: evaluation.needsAttention.map((w) => redactDeploymentOutput(w)),
    recommendedAction: redactDeploymentOutput(evaluation.recommendedAction),
  };
}
