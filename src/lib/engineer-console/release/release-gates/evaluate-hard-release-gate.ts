import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getLatestDeploymentHealthPolicyResult } from "../deployment-health-policy/deployment-health-policy-manager";
import {
  getDeploymentApprovalById,
  listDeploymentApprovalsForRun,
} from "../deployment-gates/deployment-gate-manager";
import { getLatestReleaseChecklistForRun } from "../release-checklist/release-checklist-manager";
import { getLatestReleaseSignoffForRun } from "../release-signoff/list-release-signoffs";
import { isHardReleaseGatesEnabled } from "./release-gate-config";
import type {
  HardReleaseGateAction,
  HardReleaseGateEvaluation,
} from "./release-gate-types";

export interface EvaluateHardReleaseGateContext {
  deploymentApprovalId?: string;
  signoffRationale?: string | null;
}

function hasApprovedDeploymentApproval(runId: string, approvalId?: string): boolean {
  if (approvalId) {
    const approval = getDeploymentApprovalById(approvalId);
    return approval?.runId === runId && approval.decision === "approved";
  }
  return listDeploymentApprovalsForRun(runId).some((a) => a.decision === "approved");
}

function collectPolicyReplayReviewBlockers(runId: string): string[] {
  const blockers: string[] = [];

  const policy = getLatestPolicyEvaluationResult(runId);
  if (policy?.status === "blocked") {
    blockers.push(
      `Governance policy is blocked (hard release gates): ${policy.blockers[0] ?? policy.summary}`,
    );
  }

  const replay = getLatestReplayVerificationResult(runId);
  if (!replay) {
    blockers.push("Replay verification has not been run (hard release gates).");
  } else if (replay.status !== "passed") {
    blockers.push(`Replay verification must pass (current: ${replay.status}, hard release gates).`);
  }

  const reviewSummary = summarizeReviewStages(listReviewStagesForRun(runId));
  if (reviewSummary.pendingCount > 0) {
    blockers.push("Required review stages are still pending (hard release gates).");
  }
  if (reviewSummary.rejectedCount > 0) {
    blockers.push("Required review stages were rejected (hard release gates).");
  }

  return blockers;
}

function collectChecklistBlockers(runId: string, requirePersisted: boolean): string[] {
  const checklist = getLatestReleaseChecklistForRun(runId);
  if (!checklist) {
    if (requirePersisted) {
      return [
        "Persisted release checklist evaluation is required (hard release gates). Evaluate the checklist first.",
      ];
    }
    return [];
  }
  if (checklist.status === "blocked") {
    return ["Release checklist is blocked (hard release gates)."];
  }
  return [];
}

function collectSignoffRejectionBlockers(runId: string): string[] {
  const signoff = getLatestReleaseSignoffForRun(runId);
  if (signoff?.decision === "rejected") {
    return [
      "Latest release sign-off is rejected; resolve blockers or record an updated sign-off before proceeding (hard release gates).",
    ];
  }
  return [];
}

function collectHealthPolicyCompletionBlockers(runId: string): string[] {
  const health = getLatestDeploymentHealthPolicyResult(runId);
  if (health?.status === "unhealthy") {
    return [
      "Deployment health policy is unhealthy; release cannot be marked completed (hard release gates).",
    ];
  }
  return [];
}

function buildSignals(runId: string) {
  const checklist = getLatestReleaseChecklistForRun(runId);
  const signoff = getLatestReleaseSignoffForRun(runId);
  const health = getLatestDeploymentHealthPolicyResult(runId);
  const policy = getLatestPolicyEvaluationResult(runId);
  const replay = getLatestReplayVerificationResult(runId);

  return {
    checklistStatus: checklist?.status ?? null,
    signoffDecision: signoff?.decision ?? null,
    healthPolicyStatus: health?.status ?? null,
    policyStatus: policy?.status ?? null,
    replayStatus: replay?.status ?? null,
    hasEvidenceBundle: getEvidenceBundleForRun(runId) !== null,
    hasApprovedDeploymentApproval: hasApprovedDeploymentApproval(runId),
  };
}

export function evaluateHardReleaseGate(
  runId: string,
  action: HardReleaseGateAction,
  context: EvaluateHardReleaseGateContext = {},
): HardReleaseGateEvaluation {
  const enabled = isHardReleaseGatesEnabled();
  const signals = buildSignals(runId);

  if (!enabled) {
    return {
      enabled: false,
      action,
      status: "passed",
      blockers: [],
      recommendedAction: null,
      signals,
    };
  }

  if (!getRunById(runId)) {
    return {
      enabled: true,
      action,
      status: "blocked",
      blockers: ["Run not found."],
      recommendedAction: "Verify run id.",
      signals,
    };
  }

  const blockers: string[] = [];

  switch (action) {
    case "merge": {
      if (!signals.hasEvidenceBundle) {
        blockers.push("Evidence bundle is required before merge (hard release gates).");
      }
      blockers.push(...collectPolicyReplayReviewBlockers(runId));
      break;
    }
    case "deployment_approval_approve": {
      blockers.push(...collectPolicyReplayReviewBlockers(runId));
      blockers.push(...collectChecklistBlockers(runId, true));
      blockers.push(...collectSignoffRejectionBlockers(runId));
      break;
    }
    case "deployment_execution": {
      blockers.push(...collectPolicyReplayReviewBlockers(runId));
      blockers.push(...collectChecklistBlockers(runId, true));
      blockers.push(...collectSignoffRejectionBlockers(runId));
      if (!hasApprovedDeploymentApproval(runId, context.deploymentApprovalId)) {
        blockers.push("An approved deployment approval is required (hard release gates).");
      }
      break;
    }
    case "release_signoff_completed": {
      blockers.push(...collectChecklistBlockers(runId, true));
      blockers.push(...collectHealthPolicyCompletionBlockers(runId));
      if (signals.checklistStatus && signals.checklistStatus !== "complete") {
        blockers.push(
          `Release checklist must be complete for completed sign-off (current: ${signals.checklistStatus}, hard release gates).`,
        );
      }
      if (signals.signoffDecision === "rejected") {
        blockers.push(
          "A rejected release sign-off must be superseded before recording completed sign-off (hard release gates).",
        );
      }
      break;
    }
    case "release_signoff_completed_with_exceptions": {
      blockers.push(...collectChecklistBlockers(runId, true));
      if (signals.checklistStatus !== "needs_attention") {
        blockers.push(
          `Completed with exceptions requires checklist needs_attention (current: ${signals.checklistStatus ?? "none"}, hard release gates).`,
        );
      }
      if (!context.signoffRationale?.trim()) {
        blockers.push(
          "Admin rationale is required for completed_with_exceptions sign-off (hard release gates).",
        );
      }
      break;
    }
    default:
      break;
  }

  const status = blockers.length > 0 ? "blocked" : "passed";
  const recommendedAction =
    status === "blocked"
      ? "Resolve hard release gate blockers or disable ENGINEER_CONSOLE_RELEASE_GATES_ENABLED for advisory-only mode."
      : "Hard release gate checks passed for this action.";

  return {
    enabled: true,
    action,
    status,
    blockers,
    recommendedAction,
    signals,
  };
}
