import { RUN_PANEL_IDS } from "@/lib/engineer-console/run-ux/run-ux-types";
import type { PrReadinessResult } from "@/lib/engineer-console/release/pr-creation/pr-creation-types";
import type { DangerPoint, PlaybookRecommendation } from "./danger-point-types";

export interface RecommendPlaybooksInput {
  dangerPoints: DangerPoint[];
  latestPrReadiness: PrReadinessResult | null;
  qualityGateFailed: boolean;
  replayStatus: string | null;
  policyStatus: string | null;
}

function hasDanger(dangerPoints: DangerPoint[], id: string): boolean {
  return dangerPoints.some((point) => point.id === id);
}

export function recommendPlaybooks(input: RecommendPlaybooksInput): PlaybookRecommendation[] {
  const recommendations: PlaybookRecommendation[] = [];
  const prSignals = input.latestPrReadiness?.signals;

  if (prSignals?.currentBranchMatchesRunBranch === false) {
    recommendations.push({
      playbookId: "checkout-run-branch",
      title: "Checkout the run branch before retrying",
      description:
        "The current checkout differs from the run branch. A future safe playbook could switch back to the run branch before retrying PR work.",
      safetyLevel: "safe",
      requiresHumanConfirmation: true,
      targetPanelAnchor: RUN_PANEL_IDS.prCreation,
    });
  }

  if (prSignals?.reusableCommitShaPrefix) {
    recommendations.push({
      playbookId: "reuse-existing-run-commit",
      title: "Reuse the existing run commit",
      description:
        "PR readiness already detected a reusable run commit. A future playbook should prefer reuse over creating duplicate commits.",
      safetyLevel: "safe",
      requiresHumanConfirmation: false,
      targetPanelAnchor: RUN_PANEL_IDS.prCreation,
    });
  }

  if (prSignals?.remoteBranchMatchesReusableCommit) {
    recommendations.push({
      playbookId: "skip-redundant-push",
      title: "Skip a redundant branch push",
      description:
        "The remote branch already matches the reusable commit, so a future PR retry playbook could skip the push step.",
      safetyLevel: "safe",
      requiresHumanConfirmation: false,
      targetPanelAnchor: RUN_PANEL_IDS.prCreation,
    });
  }

  if (prSignals?.existingPrUrl) {
    recommendations.push({
      playbookId: "reuse-existing-pr",
      title: "Reuse the existing PR record",
      description:
        "An existing PR is already associated with the run branch. A future playbook should record or reuse it instead of creating a duplicate PR.",
      safetyLevel: "safe",
      requiresHumanConfirmation: false,
      targetPanelAnchor: RUN_PANEL_IDS.prCreation,
    });
  }

  if (hasDanger(input.dangerPoints, "file-index-stale")) {
    recommendations.push({
      playbookId: "reindex-repository",
      title: "Re-index the repository",
      description:
        "The worker plan or policy results suggest file-index drift. A future read-only playbook could refresh the repository index before the next evaluation.",
      safetyLevel: "safe",
      requiresHumanConfirmation: false,
      targetPanelAnchor: RUN_PANEL_IDS.workerPlan,
    });
  }

  if (
    input.replayStatus == null ||
    hasDanger(input.dangerPoints, "stale-governance-signals") ||
    hasDanger(input.dangerPoints, "replay-warning-or-failure")
  ) {
    recommendations.push({
      playbookId: "rerun-replay-verification",
      title: "Re-run replay verification",
      description:
        "Replay verification is missing, stale, or warning-prone. A future playbook could recompute it safely without changing approval authority.",
      safetyLevel: "safe",
      requiresHumanConfirmation: false,
      targetPanelAnchor: RUN_PANEL_IDS.replay,
    });
  }

  if (
    input.policyStatus == null ||
    hasDanger(input.dangerPoints, "stale-governance-signals") ||
    hasDanger(input.dangerPoints, "policy-review-required")
  ) {
    recommendations.push({
      playbookId: "rerun-policy-evaluation",
      title: "Re-run policy evaluation",
      description:
        "Policy evaluation is missing, stale, or needs refreshed context after replay or evidence changes.",
      safetyLevel: "safe",
      requiresHumanConfirmation: false,
      targetPanelAnchor: RUN_PANEL_IDS.policy,
    });
  }

  if (input.qualityGateFailed) {
    recommendations.push({
      playbookId: "focused-quality-fix",
      title: "Attempt a focused quality-gate fix later",
      description:
        "A future bounded playbook could let the worker attempt a narrow lint, import, or changed-module fix after explicit human confirmation.",
      safetyLevel: "cautious",
      requiresHumanConfirmation: true,
      targetPanelAnchor: RUN_PANEL_IDS.qualityGates,
    });
  }

  return recommendations;
}
