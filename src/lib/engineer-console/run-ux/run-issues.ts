import { RUN_NAV_TARGET_IDS } from "./run-navigation";
import type { RunCommandCenterState, RunWorkflowSummary } from "./run-ux-types";
import { RUN_PANEL_IDS } from "./run-ux-types";
import type { RunWorkspaceViewId } from "./run-workspace";

export interface RunIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  suggestedAction: string;
  view: RunWorkspaceViewId;
  anchorId?: string;
  sortPriority: number;
}

function hasHardGateBlockers(summary: RunWorkflowSummary): boolean {
  return (
    summary.hardGates.mergeBlockers.length > 0 ||
    summary.hardGates.deploymentApprovalBlockers.length > 0 ||
    summary.hardGates.deploymentExecutionBlockers.length > 0 ||
    summary.hardGates.signoffCompletedBlockers.length > 0 ||
    summary.hardGates.signoffExceptionsBlockers.length > 0
  );
}

function firstHardGateAnchor(summary: RunWorkflowSummary): string {
  if (summary.hardGates.mergeBlockers.length > 0) return RUN_PANEL_IDS.mergeControls;
  if (summary.hardGates.deploymentApprovalBlockers.length > 0) return RUN_PANEL_IDS.deploymentGates;
  if (summary.hardGates.deploymentExecutionBlockers.length > 0) return RUN_PANEL_IDS.deploymentExecution;
  if (summary.hardGates.signoffCompletedBlockers.length > 0) return RUN_PANEL_IDS.releaseSignoff;
  if (summary.hardGates.signoffExceptionsBlockers.length > 0) return RUN_PANEL_IDS.releaseSignoff;
  return RUN_PANEL_IDS.releaseChecklist;
}

function pushIssue(
  issues: RunIssue[],
  issue: RunIssue,
) {
  issues.push(issue);
}

export function deriveRunIssues(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunIssue[] {
  const issues: RunIssue[] = [];

  if (!summary.audit.chainOk) {
    pushIssue(issues, {
      id: "audit-chain-failed",
      severity: "critical",
      title: "Audit chain failed",
      message: "The audit history did not verify cleanly for this run.",
      suggestedAction: "Open the audit view and review chain diagnostics before continuing release work.",
      view: "audit",
      anchorId: RUN_NAV_TARGET_IDS.auditChainDiagnostics,
      sortPriority: 100,
    });
  }

  if (hasHardGateBlockers(summary)) {
    pushIssue(issues, {
      id: "hard-release-gates-blocked",
      severity: "critical",
      title: "Hard release gate blocked",
      message: "A required release gate is still blocking merge, deployment, or sign-off work.",
      suggestedAction: "Open the release view and follow the first gate checklist item before continuing.",
      view: "release",
      anchorId: firstHardGateAnchor(summary),
      sortPriority: 96,
    });
  }

  if (!summary.evidence.exists) {
    pushIssue(issues, {
      id: "evidence-missing",
      severity: "warning",
      title: "Evidence missing",
      message: "This run does not have a recorded evidence bundle yet.",
      suggestedAction: "Open the review view and generate or inspect the evidence bundle.",
      view: "review",
      anchorId: RUN_PANEL_IDS.evidence,
      sortPriority: 88,
    });
  }

  if (!summary.replay.exists) {
    pushIssue(issues, {
      id: "replay-missing",
      severity: "warning",
      title: "Replay verification missing",
      message: "Replay verification has not been recorded for this run.",
      suggestedAction: "Open the review view and run replay verification.",
      view: "review",
      anchorId: RUN_PANEL_IDS.replay,
      sortPriority: 86,
    });
  } else if (summary.replay.status === "failed") {
    pushIssue(issues, {
      id: "replay-failed",
      severity: "critical",
      title: "Replay verification failed",
      message: "Replay verification reported failed checks that must be reviewed before continuing.",
      suggestedAction: "Open the review view and inspect replay failures before approval or release work.",
      view: "review",
      anchorId: RUN_PANEL_IDS.replay,
      sortPriority: 92,
    });
  } else if (summary.replay.status === "warning") {
    pushIssue(issues, {
      id: "replay-warning",
      severity: "warning",
      title: "Replay warning",
      message: "Replay verification passed with warnings that should be reviewed.",
      suggestedAction: "Open the review view and review the replay warning details.",
      view: "review",
      anchorId: RUN_PANEL_IDS.replay,
      sortPriority: 74,
    });
  }

  if (!summary.policy.exists) {
    pushIssue(issues, {
      id: "policy-missing",
      severity: "warning",
      title: "Policy evaluation missing",
      message: "Policy results have not been recorded for this run yet.",
      suggestedAction: "Open the review view and evaluate policy before approval.",
      view: "review",
      anchorId: RUN_PANEL_IDS.policy,
      sortPriority: 84,
    });
  } else if (summary.policy.status === "blocked") {
    pushIssue(issues, {
      id: "policy-blocked",
      severity: "critical",
      title: "Policy blocked",
      message: "Policy evaluation found blockers that must be resolved before approval.",
      suggestedAction: "Open the review view and resolve policy blockers before continuing.",
      view: "review",
      anchorId: RUN_PANEL_IDS.policy,
      sortPriority: 90,
    });
  } else if (summary.policy.status === "requires_review") {
    pushIssue(issues, {
      id: "policy-requires-review",
      severity: "warning",
      title: "Policy requires review",
      message: "Senior review is required before final approval can complete.",
      suggestedAction: "Open the review view and complete review stages before approving.",
      view: "review",
      anchorId: RUN_PANEL_IDS.reviewStages,
      sortPriority: 78,
    });
  }

  if (summary.review.rejectedCount > 0) {
    pushIssue(issues, {
      id: "review-stages-rejected",
      severity: "critical",
      title: "Review stage rejected",
      message: "At least one required review stage has been rejected.",
      suggestedAction: "Open the review view and inspect rejected review stages before approval.",
      view: "review",
      anchorId: RUN_PANEL_IDS.reviewStages,
      sortPriority: 89,
    });
  } else if (summary.review.pendingCount > 0) {
    pushIssue(issues, {
      id: "review-stages-pending",
      severity: "warning",
      title: "Review stages pending",
      message: "Required review work is still pending for this run.",
      suggestedAction: "Open the review view and complete required review stages.",
      view: "review",
      anchorId: RUN_PANEL_IDS.reviewStages,
      sortPriority: 80,
    });
  }

  if (summary.run.status === "waiting_for_approval") {
    if (summary.approval.canApprove && summary.policy.status === "requires_review") {
      pushIssue(issues, {
        id: "approval-rationale-required",
        severity: "warning",
        title: "Approval rationale required",
        message: "Approval is available, but a rationale is required because policy requires review.",
        suggestedAction: "Open the review view and record the decision with the required rationale.",
        view: "review",
        anchorId: RUN_PANEL_IDS.approval,
        sortPriority: 77,
      });
    } else if (summary.approval.canApprove) {
      pushIssue(issues, {
        id: "approval-pending",
        severity: "info",
        title: "Approval pending",
        message: "The run is waiting for a human approval decision.",
        suggestedAction: "Open the review view and review the approval report before approving, requesting fixes, or stopping.",
        view: "review",
        anchorId: RUN_PANEL_IDS.approval,
        sortPriority: 68,
      });
    } else {
      pushIssue(issues, {
        id: "approval-blocked",
        severity: "warning",
        title: "Approval blocked",
        message: "The run is waiting for approval, but one or more governance issues still block the decision.",
        suggestedAction: "Open the review view and clear the remaining blockers before approving.",
        view: "review",
        anchorId: RUN_PANEL_IDS.approval,
        sortPriority: 82,
      });
    }
  }

  if (summary.pr.latestStatus === "failed" && summary.pr.latestCommitShaPrefix) {
    pushIssue(issues, {
      id: "pr-retry-available",
      severity: "warning",
      title: "PR retry available",
      message: "A prior PR attempt recorded reusable state, so retry is available without creating a duplicate commit.",
      suggestedAction: "Open the PR view and review the PR state card before retrying draft PR creation.",
      view: "pr",
      anchorId: RUN_PANEL_IDS.prCreation,
      sortPriority: 72,
    });
  } else if (summary.pr.latestStatus === "failed") {
    pushIssue(issues, {
      id: "pr-failed",
      severity: "warning",
      title: "PR creation failed",
      message: "The latest PR attempt failed and needs operator review.",
      suggestedAction: "Open the PR view and inspect the PR state card before trying again.",
      view: "pr",
      anchorId: RUN_PANEL_IDS.prCreation,
      sortPriority: 70,
    });
  } else if (
    summary.approval.latestDecision === "approved" &&
    !summary.pr.latestStatus &&
    guidance.currentStageId === "pr"
  ) {
    pushIssue(issues, {
      id: "pr-ready",
      severity: "info",
      title: "PR ready",
      message: "The run is approved and ready for PR review or draft PR creation.",
      suggestedAction: "Open the PR view and check PR readiness before creating the draft PR.",
      view: "pr",
      anchorId: RUN_PANEL_IDS.prCreation,
      sortPriority: 60,
    });
  }

  if (
    summary.deployment.latestHealthPolicyStatus === "needs_attention" ||
    summary.deployment.latestHealthCheckStatus === "failed" ||
    summary.deployment.latestHealthCheckStatus === "unhealthy"
  ) {
    pushIssue(issues, {
      id: "deployment-health-warning",
      severity: "warning",
      title: "Deployment health warning",
      message: "Deployment health signals still need review before release work can finish.",
      suggestedAction: "Open the release view and review health checks and health policy.",
      view: "release",
      anchorId: RUN_PANEL_IDS.deploymentHealthPolicy,
      sortPriority: 66,
    });
  }

  if (!summary.release.checklistRecorded && guidance.currentStageId === "checklist") {
    pushIssue(issues, {
      id: "release-checklist-missing",
      severity: "warning",
      title: "Release checklist incomplete",
      message: "The release checklist has not been recorded yet.",
      suggestedAction: "Open the release view and evaluate the release checklist.",
      view: "release",
      anchorId: RUN_PANEL_IDS.releaseChecklist,
      sortPriority: 64,
    });
  } else if (summary.release.checklistStatus === "needs_attention") {
    pushIssue(issues, {
      id: "release-checklist-attention",
      severity: "warning",
      title: "Release checklist incomplete",
      message: "The checklist is recorded, but it still contains items that need attention.",
      suggestedAction: "Open the release view and review checklist exceptions before sign-off.",
      view: "release",
      anchorId: RUN_PANEL_IDS.releaseChecklist,
      sortPriority: 63,
    });
  }

  if (summary.release.checklistRecorded && !summary.release.latestSignoffDecision) {
    pushIssue(issues, {
      id: "release-signoff-missing",
      severity: "warning",
      title: "Sign-off missing",
      message: "Release checklist data exists, but no final sign-off decision has been recorded.",
      suggestedAction: "Open the release view and review release sign-off.",
      view: "release",
      anchorId: RUN_PANEL_IDS.releaseSignoff,
      sortPriority: 62,
    });
  }

  return issues.sort((left, right) => right.sortPriority - left.sortPriority || left.title.localeCompare(right.title));
}
