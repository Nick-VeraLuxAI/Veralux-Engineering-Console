import {
  type RunApprovalActionCardState,
  RUN_PANEL_IDS,
  type RunCommandCenterState,
  type RunGuidanceItem,
  type RunLifecycleStepId,
  type RunLifecycleStepState,
  type RunLifecycleStepStatus,
  type RunSecondaryActionSummary,
  type RunWorkflowSummary,
} from "./run-ux-types";
import { buildReleaseGateChecklistItems } from "./release-gate-ux";

const STEP_LABELS: Record<RunLifecycleStepId, string> = {
  task: "Task",
  branch: "Branch",
  worker_plan: "Worker Plan",
  quality_gates: "Quality Gates",
  evidence: "Evidence",
  replay: "Replay",
  policy: "Policy",
  review: "Review",
  approval: "Approval",
  pr: "PR",
  merge: "Merge",
  deployment: "Deployment",
  health: "Health",
  checklist: "Checklist",
  signoff: "Sign-off",
};

function panelHref(id: string): string {
  return `#${id}`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function stepHref(summary: RunWorkflowSummary, stepId: RunLifecycleStepId): string {
  switch (stepId) {
    case "task":
      return `/engineer/tasks/${summary.task.id}`;
    case "branch":
      return panelHref(RUN_PANEL_IDS.runState);
    case "worker_plan":
      return panelHref(RUN_PANEL_IDS.workerPlan);
    case "quality_gates":
      return panelHref(RUN_PANEL_IDS.qualityGates);
    case "evidence":
      return panelHref(RUN_PANEL_IDS.evidence);
    case "replay":
      return panelHref(RUN_PANEL_IDS.replay);
    case "policy":
      return panelHref(RUN_PANEL_IDS.policy);
    case "review":
      return panelHref(RUN_PANEL_IDS.reviewStages);
    case "approval":
      return panelHref(RUN_PANEL_IDS.approval);
    case "pr":
      return panelHref(RUN_PANEL_IDS.prCreation);
    case "merge":
      return panelHref(RUN_PANEL_IDS.mergeControls);
    case "deployment":
      return panelHref(RUN_PANEL_IDS.deploymentGates);
    case "health":
      return panelHref(RUN_PANEL_IDS.deploymentHealth);
    case "checklist":
      return panelHref(RUN_PANEL_IDS.releaseChecklist);
    case "signoff":
      return panelHref(RUN_PANEL_IDS.releaseSignoff);
  }
}

function reviewRequired(summary: RunWorkflowSummary): boolean {
  return summary.policy.reviewRequired.length > 0 || summary.review.requiredCount > 0;
}

function reviewComplete(summary: RunWorkflowSummary): boolean {
  if (summary.review.requiredCount > 0) {
    return summary.review.pendingCount === 0 && summary.review.rejectedCount === 0;
  }
  return summary.policy.exists && summary.policy.status !== "requires_review";
}

function approvalComplete(summary: RunWorkflowSummary): boolean {
  return (
    summary.approval.latestDecision === "approved" ||
    summary.run.currentStep === "approved_by_operator"
  );
}

function prCreated(summary: RunWorkflowSummary): boolean {
  return summary.pr.latestStatus === "pr_created";
}

function mergeComplete(summary: RunWorkflowSummary): boolean {
  return summary.merge.latestStatus === "merged";
}

function deploymentExecuted(summary: RunWorkflowSummary): boolean {
  return summary.deployment.latestExecutionStatus === "succeeded";
}

function healthPolicyEvaluated(summary: RunWorkflowSummary): boolean {
  return summary.deployment.latestHealthPolicyStatus !== null;
}

function healthStepPassed(summary: RunWorkflowSummary): boolean {
  return summary.deployment.latestHealthPolicyStatus === "healthy";
}

function pushAll(target: RunGuidanceItem[], items: string[], href: string): void {
  for (const item of items) {
    target.push({ text: item, href });
  }
}

function buildSecondaryActions(summary: RunWorkflowSummary): RunSecondaryActionSummary[] {
  const actions: RunSecondaryActionSummary[] = [];
  const approvalCardRelevant =
    summary.workerPlan.executionStatus === "executed" || summary.run.status === "waiting_for_approval";

  if (approvalCardRelevant && !approvalComplete(summary)) {
    actions.push(
      {
        label: "Request Fix",
        description: "Request Fix - send this run back for correction.",
        href: panelHref(RUN_PANEL_IDS.approval),
      },
      {
        label: "Stop Run",
        description: "Stop Run - end this run without approval.",
        href: panelHref(RUN_PANEL_IDS.approval),
      },
    );
  }

  if (!approvalComplete(summary)) {
    actions.push({
      label: "Approval needed",
      description: "A human approval is still required before PR creation can continue.",
      href: panelHref(RUN_PANEL_IDS.approval),
    });
  }

  if (
    summary.policy.status === "requires_review" ||
    summary.review.pendingCount > 0 ||
    summary.review.rejectedCount > 0
  ) {
    actions.push({
      label: "Review needed",
      description: "Required review stages still need human attention before approval.",
      href: panelHref(RUN_PANEL_IDS.reviewStages),
    });
  }

  if (summary.pr.latestStatus === "failed" && summary.pr.latestCommitShaPrefix) {
    actions.push({
      label: "Retry PR creation",
      description: `Retry will reuse commit ${summary.pr.latestCommitShaPrefix}.`,
      href: panelHref(RUN_PANEL_IDS.prCreation),
    });
  }

  return actions;
}

function prRetryAvailable(summary: RunWorkflowSummary): boolean {
  return summary.pr.latestStatus === "failed" && summary.pr.latestCommitShaPrefix !== null;
}

function prManualRecoveryRequired(summary: RunWorkflowSummary): boolean {
  const blockerText = [
    summary.pr.latestErrorMessage ?? "",
    ...summary.pr.latestReadinessBlockers,
  ].join(" ");
  return /no reusable run commit|no changed files/i.test(blockerText);
}

function mapPrReadinessBlocker(blocker: string): RunGuidanceItem {
  const normalized = blocker.toLowerCase();

  if (normalized.includes("approved human decision")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.approval) };
  }
  if (normalized.includes("evidence bundle")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.evidence) };
  }
  if (normalized.includes("policy")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.policy) };
  }
  if (normalized.includes("review stage")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.reviewStages) };
  }
  if (normalized.includes("replay verification")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.replay) };
  }
  if (normalized.includes("quality gate")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.qualityGates) };
  }
  if (normalized.includes("protected path")) {
    return { text: blocker, href: panelHref(RUN_PANEL_IDS.workerPlan) };
  }
  return { text: blocker, href: panelHref(RUN_PANEL_IDS.prCreation) };
}

function pushTopReleaseGateItems(target: RunGuidanceItem[], blockers: string[], limit = 3): void {
  const items = buildReleaseGateChecklistItems(blockers).slice(0, limit);
  for (const item of items) {
    target.push({
      text: `${item.label} -> ${item.ctaLabel}`,
      href: item.href,
    });
  }
}

function firstReleaseGateAction(blockers: string[]): { label: string; href: string } | null {
  const first = buildReleaseGateChecklistItems(blockers)[0];
  if (!first) return null;
  return { label: first.ctaLabel, href: first.href };
}

export function deriveRunApprovalActionCardState(
  summary: RunWorkflowSummary,
): RunApprovalActionCardState {
  const blockers: RunGuidanceItem[] = [];
  const warnings: RunGuidanceItem[] = [];
  const policyRequiresReview = summary.policy.status === "requires_review";
  const policyBlocked = summary.policy.status === "blocked";
  const reviewPending = summary.review.pendingCount > 0;
  const reviewRejected = summary.review.rejectedCount > 0;
  const reviewNeedsGeneration = reviewRequired(summary) && summary.review.stageCount === 0;
  const approvalRecorded = approvalComplete(summary);
  const latestDecision = summary.approval.latestDecision;
  const showCard =
    summary.workerPlan.executionStatus === "executed" ||
    summary.run.status === "waiting_for_approval" ||
    latestDecision !== null ||
    reviewRequired(summary);

  if (!showCard) {
    return {
      showCard: false,
      tone: "warning",
      currentStateLabel: "Approval state unavailable.",
      currentStateDetail: "Approval guidance becomes visible after the run reaches the review or approval stages.",
      approvalAvailable: false,
      nextRequiredAction: "Complete earlier lifecycle steps first.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.approval),
      primaryLabel: "Open approval report",
      showApprove: false,
      showRequestFix: false,
      showStop: false,
      rationale: {
        approve: "optional",
        requestFix: "required",
        stop: "required",
        guidance: [],
      },
    };
  }

  if (approvalRecorded) {
    return {
      showCard: true,
      tone: "complete",
      currentStateLabel: "Approved by operator.",
      currentStateDetail:
        "A final approval decision is recorded. Downstream PR and release controls remain manual.",
      approvalAvailable: false,
      nextRequiredAction: "Open PR creation.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.prCreation),
      primaryLabel: "Open PR creation",
      showApprove: false,
      showRequestFix: false,
      showStop: false,
      rationale: {
        approve: policyRequiresReview ? "required" : "optional",
        requestFix: "required",
        stop: "required",
        guidance: [],
      },
    };
  }

  if (latestDecision === "request_fix") {
    return {
      showCard: true,
      tone: "blocked",
      currentStateLabel: "Request Fix recorded.",
      currentStateDetail:
        "A human decision already sent this run back for correction. Review the rationale in the decision history before retrying.",
      approvalAvailable: false,
      nextRequiredAction: "Review requested fixes before starting another run.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.auditTimeline),
      primaryLabel: "Review decision history",
      showApprove: false,
      showRequestFix: false,
      showStop: false,
      rationale: {
        approve: "optional",
        requestFix: "required",
        stop: "required",
        guidance: [],
      },
    };
  }

  if (latestDecision === "stopped" || summary.run.currentStep === "stopped_by_operator") {
    return {
      showCard: true,
      tone: "blocked",
      currentStateLabel: "Run stopped.",
      currentStateDetail:
        "This run was ended without approval. Start a new run only if work should resume.",
      approvalAvailable: false,
      nextRequiredAction: "Review audit history before creating another run.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.auditTimeline),
      primaryLabel: "Review audit timeline",
      showApprove: false,
      showRequestFix: false,
      showStop: false,
      rationale: {
        approve: "optional",
        requestFix: "required",
        stop: "required",
        guidance: [],
      },
    };
  }

  const approvalAvailable =
    summary.run.status === "waiting_for_approval" &&
    summary.approval.canApprove &&
    !policyBlocked &&
    !reviewPending &&
    !reviewRejected &&
    !reviewNeedsGeneration;
  const approveRequiresRationale = policyRequiresReview;

  if (policyRequiresReview) {
    warnings.push({
      text: "Senior review required before approval.",
      href: panelHref(RUN_PANEL_IDS.reviewStages),
    });
  }
  if (policyBlocked) {
    pushAll(blockers, summary.policy.blockers, panelHref(RUN_PANEL_IDS.policy));
  }
  if (reviewNeedsGeneration) {
    blockers.push({
      text: "Generate required review stages before final run approval.",
      href: panelHref(RUN_PANEL_IDS.reviewStages),
    });
  }
  if (reviewPending) {
    blockers.push({
      text: `${countLabel(summary.review.pendingCount, "required review stage")} still pending.`,
      href: panelHref(RUN_PANEL_IDS.reviewStages),
    });
  }
  if (reviewRejected) {
    blockers.push({
      text: `${countLabel(summary.review.rejectedCount, "required review stage")} rejected.`,
      href: panelHref(RUN_PANEL_IDS.reviewStages),
    });
  }
  if (!summary.approval.canApprove) {
    if (summary.approval.governanceIssues.length > 0) {
      pushAll(blockers, summary.approval.governanceIssues, panelHref(RUN_PANEL_IDS.approval));
    } else if (summary.run.status === "waiting_for_approval") {
      blockers.push({
        text: "Approval is blocked until these items are complete.",
        href: panelHref(RUN_PANEL_IDS.approval),
      });
    }
  }

  const rationaleGuidance = [
    approveRequiresRationale
      ? "Approval requires rationale because policy status is requires_review."
      : "Approval rationale is optional when approval is available.",
    "Request Fix requires a reason so the next operator understands what failed.",
    "Stop Run requires a reason for audit history.",
  ];

  if (approvalAvailable) {
    return {
      showCard: true,
      tone: approveRequiresRationale ? "warning" : "ready",
      currentStateLabel: approveRequiresRationale
        ? "Ready for approval with rationale."
        : "Ready for approval.",
      currentStateDetail:
        "Required review and governance checks are in place. Final human approval happens here before PR work can continue.",
      approvalAvailable: true,
      nextRequiredAction: approveRequiresRationale
        ? "Provide rationale and approve run."
        : "Approve run.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.approval),
      primaryLabel: "Open approval report",
      showApprove: true,
      showRequestFix: true,
      showStop: true,
      rationale: {
        approve: approveRequiresRationale ? "required" : "optional",
        requestFix: "required",
        stop: "required",
        guidance: rationaleGuidance,
      },
    };
  }

  if (policyBlocked) {
    return {
      showCard: true,
      tone: "blocked",
      currentStateLabel: "Approval is blocked until these items are complete.",
      currentStateDetail:
        "Policy evaluation found blockers that must be resolved before final run approval can happen.",
      approvalAvailable: false,
      nextRequiredAction: "Resolve policy blockers before approval.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.policy),
      primaryLabel: "Open policy results",
      showApprove: true,
      showRequestFix: true,
      showStop: true,
      rationale: {
        approve: approveRequiresRationale ? "required" : "optional",
        requestFix: "required",
        stop: "required",
        guidance: rationaleGuidance,
      },
    };
  }

  if (reviewNeedsGeneration || reviewPending || reviewRejected) {
    return {
      showCard: true,
      tone: reviewRejected ? "blocked" : "warning",
      currentStateLabel: "Senior review required before approval.",
      currentStateDetail:
        "The policy and review-stage flow still need human review work before final run approval can happen.",
      approvalAvailable: false,
      nextRequiredAction: reviewNeedsGeneration
        ? "Generate required review stages."
        : "Complete required review stages.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.reviewStages),
      primaryLabel: "Open review stages",
      showApprove: true,
      showRequestFix: true,
      showStop: true,
      rationale: {
        approve: approveRequiresRationale ? "required" : "optional",
        requestFix: "required",
        stop: "required",
        guidance: rationaleGuidance,
      },
    };
  }

  if (summary.run.status === "waiting_for_approval") {
    return {
      showCard: true,
      tone: "blocked",
      currentStateLabel: "Approval is blocked until these items are complete.",
      currentStateDetail:
        "The run is in the approval step, but governance or quality conditions still prevent final approval.",
      approvalAvailable: false,
      nextRequiredAction:
        summary.approval.recommendedNextAction ?? "Review approval blockers before continuing.",
      blockers,
      warnings,
      primaryHref: panelHref(RUN_PANEL_IDS.approval),
      primaryLabel: "Open approval report",
      showApprove: true,
      showRequestFix: true,
      showStop: true,
      rationale: {
        approve: approveRequiresRationale ? "required" : "optional",
        requestFix: "required",
        stop: "required",
        guidance: rationaleGuidance,
      },
    };
  }

  return {
    showCard: true,
    tone: summary.run.status === "failed" ? "blocked" : "warning",
    currentStateLabel:
      summary.run.status === "failed"
        ? "Run did not reach final approval."
        : "Approval guidance available.",
    currentStateDetail:
      "Use Request Fix or Stop Run if this run should not proceed. Final approval only becomes available after the run returns to the approval step.",
    approvalAvailable: false,
    nextRequiredAction: "Review run state and decide whether to request fix or stop run.",
    blockers,
    warnings,
    primaryHref: panelHref(RUN_PANEL_IDS.runState),
    primaryLabel: "Review run state",
    showApprove: false,
    showRequestFix: summary.workerPlan.executionStatus === "executed",
    showStop: !approvalComplete(summary),
    rationale: {
      approve: approveRequiresRationale ? "required" : "optional",
      requestFix: "required",
      stop: "required",
      guidance: rationaleGuidance,
    },
  };
}

export function deriveRunCommandCenterState(
  summary: RunWorkflowSummary,
): RunCommandCenterState {
  const blockers: RunGuidanceItem[] = [];
  const warnings: RunGuidanceItem[] = [];
  const secondaryActions = buildSecondaryActions(summary);
  const approvalState = deriveRunApprovalActionCardState(summary);

  const workerPlanComplete = summary.workerPlan.executionStatus === "executed";
  const workerPlanBlocked =
    summary.workerPlan.validationStatus === "invalid" ||
    summary.workerPlan.executionStatus === "failed";

  if (!summary.run.branchName) {
    return {
      currentStageId: "branch",
      currentStageLabel: STEP_LABELS.branch,
      nextRecommendedAction: "Wait for branch creation to finish.",
      explanation:
        "This run is still preparing workspace state. Review run status details until the branch is ready.",
      primaryAction: {
        label: "Review run state",
        href: panelHref(RUN_PANEL_IDS.runState),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!workerPlanComplete) {
    if (workerPlanBlocked) {
      if (summary.workerPlan.validationErrorCount > 0) {
        blockers.push({
          text: `${countLabel(summary.workerPlan.validationErrorCount, "validation error")} in the latest worker plan.`,
          href: panelHref(RUN_PANEL_IDS.workerPlan),
        });
      }
      if (summary.workerPlan.executionErrorCount > 0) {
        blockers.push({
          text: `${countLabel(summary.workerPlan.executionErrorCount, "execution error")} in the latest worker plan.`,
          href: panelHref(RUN_PANEL_IDS.workerPlan),
        });
      }
      return {
        currentStageId: "worker_plan",
        currentStageLabel: STEP_LABELS.worker_plan,
        nextRecommendedAction: "Fix worker plan issues before continuing.",
        explanation:
          "The latest worker plan did not validate or execute cleanly. Review the worker plan details before rerunning it.",
        primaryAction: {
          label: "Review worker plan",
          href: panelHref(RUN_PANEL_IDS.workerPlan),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    if (summary.workerPlan.hasDraft) {
      warnings.push({
        text: "A draft worker plan is available, but it has not been executed yet.",
        href: panelHref(RUN_PANEL_IDS.workerPlan),
      });
    }
    if (summary.workerPlan.validationWarningCount > 0) {
      warnings.push({
        text: `${countLabel(summary.workerPlan.validationWarningCount, "worker plan warning")} should be reviewed before execution.`,
        href: panelHref(RUN_PANEL_IDS.workerPlan),
      });
    }
    return {
      currentStageId: "worker_plan",
      currentStageLabel: STEP_LABELS.worker_plan,
      nextRecommendedAction: "Review and execute the worker plan.",
      explanation:
        "The run has a working branch, but no successful worker plan execution is recorded yet.",
      primaryAction: {
        label: "Open worker plan",
        href: panelHref(RUN_PANEL_IDS.workerPlan),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.qualityGates.failedCount > 0) {
    pushAll(
      blockers,
      summary.qualityGates.failedCommands.map((command) => `Failed quality gate: ${command}`),
      panelHref(RUN_PANEL_IDS.qualityGates),
    );
    return {
      currentStageId: "quality_gates",
      currentStageLabel: STEP_LABELS.quality_gates,
      nextRecommendedAction: "Resolve failed quality gates before continuing.",
      explanation:
        "The worker plan executed, but one or more quality gates failed and must be reviewed first.",
      primaryAction: {
        label: "Review quality gates",
        href: panelHref(RUN_PANEL_IDS.qualityGates),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.qualityGates.count === 0) {
    return {
      currentStageId: "quality_gates",
      currentStageLabel: STEP_LABELS.quality_gates,
      nextRecommendedAction: "Wait for quality gate results.",
      explanation:
        "The worker plan has executed. Quality gate results should appear before the run moves into evidence and approval.",
      primaryAction: {
        label: "Review quality gates",
        href: panelHref(RUN_PANEL_IDS.qualityGates),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.qualityGates.skippedCount > 0) {
    pushAll(
      warnings,
      summary.qualityGates.skippedCommands.map((command) => `Skipped quality gate: ${command}`),
      panelHref(RUN_PANEL_IDS.qualityGates),
    );
  }

  if (!summary.evidence.exists) {
    return {
      currentStageId: "evidence",
      currentStageLabel: STEP_LABELS.evidence,
      nextRecommendedAction: "Generate evidence bundle.",
      explanation:
        "Quality gate results are available, but the run does not have a recorded evidence bundle yet.",
      primaryAction: {
        label: "Open evidence bundle",
        href: panelHref(RUN_PANEL_IDS.evidence),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!summary.replay.exists) {
    return {
      currentStageId: "replay",
      currentStageLabel: STEP_LABELS.replay,
      nextRecommendedAction: "Run replay verification.",
      explanation:
        "An evidence bundle exists, but replay verification has not been recorded for this run yet.",
      primaryAction: {
        label: "Open replay verification",
        href: panelHref(RUN_PANEL_IDS.replay),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.replay.status === "failed") {
    blockers.push({
      text: `Replay verification reported ${countLabel(summary.replay.failedCount, "failed check")}.`,
      href: panelHref(RUN_PANEL_IDS.replay),
    });
    return {
      currentStageId: "replay",
      currentStageLabel: STEP_LABELS.replay,
      nextRecommendedAction: "Resolve replay failures before continuing.",
      explanation:
        "Replay verification failed. Review the failed checks before moving into policy and approval.",
      primaryAction: {
        label: "Review replay verification",
        href: panelHref(RUN_PANEL_IDS.replay),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.replay.status === "warning") {
    warnings.push({
      text: `Replay passed, but ${countLabel(summary.replay.warningCount, "warning")} should be reviewed before continuing.`,
      href: panelHref(RUN_PANEL_IDS.replay),
    });
  }

  if (!summary.policy.exists) {
    return {
      currentStageId: "policy",
      currentStageLabel: STEP_LABELS.policy,
      nextRecommendedAction: "Evaluate policy.",
      explanation:
        "Replay verification is recorded, but policy evaluation has not been saved for this run yet.",
      primaryAction: {
        label: "Open policy results",
        href: panelHref(RUN_PANEL_IDS.policy),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.policy.status === "blocked") {
    pushAll(blockers, summary.policy.blockers, panelHref(RUN_PANEL_IDS.policy));
    return {
      currentStageId: "policy",
      currentStageLabel: STEP_LABELS.policy,
      nextRecommendedAction: "Resolve policy blockers before continuing.",
      explanation:
        "Policy evaluation found blockers that must be resolved before this run can move to approval.",
      primaryAction: {
        label: "Review policy results",
        href: panelHref(RUN_PANEL_IDS.policy),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.policy.status === "requires_review") {
    warnings.push({
      text: "Senior review is required before approval.",
      href: panelHref(RUN_PANEL_IDS.reviewStages),
    });
    pushAll(warnings, summary.policy.reviewRequired, panelHref(RUN_PANEL_IDS.reviewStages));
  } else {
    pushAll(warnings, summary.policy.warnings, panelHref(RUN_PANEL_IDS.policy));
  }

  if (
    summary.policy.status === "requires_review" ||
    summary.review.pendingCount > 0 ||
    summary.review.rejectedCount > 0 ||
    (reviewRequired(summary) && summary.review.stageCount === 0)
  ) {
    if (summary.review.rejectedCount > 0) {
      blockers.push({
        text: `${countLabel(summary.review.rejectedCount, "required review stage")} rejected.`,
        href: panelHref(RUN_PANEL_IDS.reviewStages),
      });
    }
    if (summary.review.pendingCount > 0) {
      warnings.push({
        text: `${countLabel(summary.review.pendingCount, "required review stage")} still pending.`,
        href: panelHref(RUN_PANEL_IDS.reviewStages),
      });
    }
    if (reviewRequired(summary) && summary.review.stageCount === 0) {
      warnings.push({
        text: "Review stages should be generated before approval.",
        href: panelHref(RUN_PANEL_IDS.reviewStages),
      });
    }
    return {
      currentStageId: "review",
      currentStageLabel: STEP_LABELS.review,
      nextRecommendedAction: "Complete required review stages.",
      explanation:
        "This run needs human review before approval. Complete all required review stages before taking a final decision.",
      primaryAction: {
        label: "Open review stages",
        href: panelHref(RUN_PANEL_IDS.reviewStages),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.run.status === "waiting_for_approval") {
    if (!summary.approval.canApprove) {
      blockers.push({
        text: "Approval is not available yet. Resolve the remaining governance or quality issues first.",
        href: panelHref(RUN_PANEL_IDS.approval),
      });
    }
    pushAll(warnings, summary.approval.governanceIssues, panelHref(RUN_PANEL_IDS.approval));
    return {
      currentStageId: "approval",
      currentStageLabel: STEP_LABELS.approval,
      nextRecommendedAction: approvalState.nextRequiredAction,
      explanation:
        "All required pre-approval checks are in place. Review the approval report before taking a human decision.",
      primaryAction: {
        label: "Review approval report",
        href: panelHref(RUN_PANEL_IDS.approval),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!approvalComplete(summary)) {
    return {
      currentStageId: "approval",
      currentStageLabel: STEP_LABELS.approval,
      nextRecommendedAction: "Review the approval state before continuing.",
      explanation:
        "The run is no longer waiting for approval, but there is no recorded approval decision to unlock PR work yet.",
      primaryAction: {
        label: "Open approval report",
        href: panelHref(RUN_PANEL_IDS.approval),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!prCreated(summary)) {
    if (summary.pr.latestReadinessStatus === "blocked" && summary.pr.latestReadinessBlockers.length > 0) {
      const firstBlocker = mapPrReadinessBlocker(summary.pr.latestReadinessBlockers[0]!);
      for (const blocker of summary.pr.latestReadinessBlockers.slice(0, 3)) {
        blockers.push(mapPrReadinessBlocker(blocker));
      }
      return {
        currentStageId: "pr",
        currentStageLabel: STEP_LABELS.pr,
        nextRecommendedAction: `Fix PR blocker: ${summary.pr.latestReadinessBlockers[0]!}`,
        explanation:
          "PR readiness is currently blocked. Resolve the first blocker below before creating or retrying a draft PR.",
        primaryAction: {
          label: "Resolve first PR blocker",
          href: firstBlocker.href ?? panelHref(RUN_PANEL_IDS.prCreation),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    if (summary.pr.latestStatus === "failed" && summary.pr.latestErrorMessage) {
      const retryAvailable = prRetryAvailable(summary);
      const manualRecovery = prManualRecoveryRequired(summary);
      blockers.push(
        manualRecovery
          ? {
              text: "Manual recovery required before PR retry.",
              href: panelHref(RUN_PANEL_IDS.prCreation),
            }
          : {
              text: summary.pr.latestErrorMessage,
              href: panelHref(RUN_PANEL_IDS.prCreation),
            },
      );
      if (retryAvailable) {
        warnings.push({
          text: `Retry will reuse commit ${summary.pr.latestCommitShaPrefix}. No duplicate commit will be created.`,
          href: panelHref(RUN_PANEL_IDS.prCreation),
        });
      }
      return {
        currentStageId: "pr",
        currentStageLabel: STEP_LABELS.pr,
        nextRecommendedAction: retryAvailable
          ? "Retry draft PR creation."
          : manualRecovery
            ? "Manual recovery required before PR retry."
            : "Fix PR creation blockers before trying again.",
        explanation:
          retryAvailable
            ? "A partial PR attempt already recorded reusable state. Review the retry card, then continue without creating duplicate commits."
            : "A PR attempt failed. Review the PR state card to understand what succeeded, what failed, and whether retry is safe.",
        primaryAction: {
          label: retryAvailable ? "Retry draft PR creation" : "Open PR creation",
          href: panelHref(RUN_PANEL_IDS.prCreation),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }
    return {
      currentStageId: "pr",
      currentStageLabel: STEP_LABELS.pr,
      nextRecommendedAction: "Evaluate PR readiness and create a draft PR.",
      explanation:
        "The run is approved. Review PR readiness before opening a draft PR for downstream merge and release steps.",
      primaryAction: {
        label: "Open PR creation",
        href: panelHref(RUN_PANEL_IDS.prCreation),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!mergeComplete(summary)) {
    if (summary.hardGates.mergeStatus === "blocked") {
      pushTopReleaseGateItems(blockers, summary.hardGates.mergeBlockers);
      const firstGateAction = firstReleaseGateAction(summary.hardGates.mergeBlockers);
      return {
        currentStageId: "merge",
        currentStageLabel: STEP_LABELS.merge,
        nextRecommendedAction:
          firstGateAction?.label ?? "Release cannot continue yet. Complete the blockers below.",
        explanation:
          "A PR exists for this run, but merge is still gated by release requirements.",
        primaryAction: {
          label: firstGateAction?.label ?? "Review merge controls",
          href: firstGateAction?.href ?? panelHref(RUN_PANEL_IDS.mergeControls),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }
    if (summary.merge.latestStatus === "failed") {
      blockers.push({
        text: "The latest merge attempt failed. Review merge history before retrying.",
        href: panelHref(RUN_PANEL_IDS.mergeControls),
      });
    }
    return {
      currentStageId: "merge",
      currentStageLabel: STEP_LABELS.merge,
      nextRecommendedAction: "Review merge controls.",
      explanation:
        "A PR is recorded for this run. Review merge readiness before moving to deployment.",
      primaryAction: {
        label: "Open merge controls",
        href: panelHref(RUN_PANEL_IDS.mergeControls),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!deploymentExecuted(summary)) {
    if (summary.deployment.latestApprovalDecision === "rejected") {
      blockers.push({
        text: "The latest deployment approval was rejected. Re-evaluate readiness before deploying.",
        href: panelHref(RUN_PANEL_IDS.deploymentGates),
      });
      return {
        currentStageId: "deployment",
        currentStageLabel: STEP_LABELS.deployment,
        nextRecommendedAction: "Re-evaluate deployment readiness.",
        explanation:
          "Merge is complete, but deployment approval was rejected and must be revisited before execution.",
        primaryAction: {
          label: "Open deployment gates",
          href: panelHref(RUN_PANEL_IDS.deploymentGates),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    if (summary.deployment.latestExecutionStatus === "failed") {
      blockers.push({
        text: "The latest deployment execution failed. Review deployment history before retrying.",
        href: panelHref(RUN_PANEL_IDS.deploymentExecution),
      });
      return {
        currentStageId: "deployment",
        currentStageLabel: STEP_LABELS.deployment,
        nextRecommendedAction: "Review deployment execution before retrying.",
        explanation:
          "A deployment attempt failed. Check the recorded execution details before running another deployment.",
        primaryAction: {
          label: "Open deployment execution",
          href: panelHref(RUN_PANEL_IDS.deploymentExecution),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    if (summary.deployment.latestApprovalDecision !== "approved") {
      if (summary.hardGates.deploymentApprovalStatus === "blocked") {
        pushTopReleaseGateItems(blockers, summary.hardGates.deploymentApprovalBlockers);
        const firstGateAction = firstReleaseGateAction(summary.hardGates.deploymentApprovalBlockers);
        return {
          currentStageId: "deployment",
          currentStageLabel: STEP_LABELS.deployment,
          nextRecommendedAction:
            firstGateAction?.label ?? "Release cannot continue yet. Complete the blockers below.",
          explanation:
            "Merge is complete, but deployment approval is still blocked by release gates.",
          primaryAction: {
            label: firstGateAction?.label ?? "Open deployment gates",
            href: firstGateAction?.href ?? panelHref(RUN_PANEL_IDS.deploymentGates),
          },
          blockers,
          warnings,
          secondaryActions,
        };
      }

      return {
        currentStageId: "deployment",
        currentStageLabel: STEP_LABELS.deployment,
        nextRecommendedAction: "Evaluate deployment readiness.",
        explanation:
          "Merge is complete. Evaluate deployment readiness for the target environment before approving execution.",
        primaryAction: {
          label: "Open deployment gates",
          href: panelHref(RUN_PANEL_IDS.deploymentGates),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    if (summary.hardGates.deploymentExecutionStatus === "blocked") {
      pushTopReleaseGateItems(blockers, summary.hardGates.deploymentExecutionBlockers);
      const firstGateAction = firstReleaseGateAction(summary.hardGates.deploymentExecutionBlockers);
      return {
        currentStageId: "deployment",
        currentStageLabel: STEP_LABELS.deployment,
        nextRecommendedAction:
          firstGateAction?.label ?? "Release cannot continue yet. Complete the blockers below.",
        explanation:
          "Deployment approval is recorded, but execution is still blocked by release gates.",
        primaryAction: {
          label: firstGateAction?.label ?? "Open deployment execution",
          href: firstGateAction?.href ?? panelHref(RUN_PANEL_IDS.deploymentExecution),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    return {
      currentStageId: "deployment",
      currentStageLabel: STEP_LABELS.deployment,
      nextRecommendedAction: "Review deployment execution.",
      explanation:
        "Deployment approval is recorded. Review the configured deployment profile before execution.",
      primaryAction: {
        label: "Open deployment execution",
        href: panelHref(RUN_PANEL_IDS.deploymentExecution),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!healthPolicyEvaluated(summary)) {
    if (summary.deployment.latestHealthCheckStatus === null) {
      return {
        currentStageId: "health",
        currentStageLabel: STEP_LABELS.health,
        nextRecommendedAction: "Run health check.",
        explanation:
          "Deployment execution completed successfully. Run a health check before moving into release verification.",
        primaryAction: {
          label: "Open deployment health checks",
          href: panelHref(RUN_PANEL_IDS.deploymentHealth),
        },
        blockers,
        warnings,
        secondaryActions,
      };
    }

    if (
      summary.deployment.latestHealthCheckStatus === "failed" ||
      summary.deployment.latestHealthCheckStatus === "unhealthy"
    ) {
      blockers.push({
        text: `Latest deployment health check is ${summary.deployment.latestHealthCheckStatus}.`,
        href: panelHref(RUN_PANEL_IDS.deploymentHealth),
      });
    }

    return {
      currentStageId: "health",
      currentStageLabel: STEP_LABELS.health,
      nextRecommendedAction: "Evaluate health policy.",
      explanation:
        "A deployment health check exists, but the policy interpretation for release decisions has not been recorded yet.",
      primaryAction: {
        label: "Open deployment health policy",
        href: panelHref(RUN_PANEL_IDS.deploymentHealthPolicy),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.deployment.latestHealthPolicyStatus === "unhealthy") {
    pushAll(
      blockers,
      summary.deployment.latestHealthPolicyBlockers,
      panelHref(RUN_PANEL_IDS.deploymentHealthPolicy),
    );
    return {
      currentStageId: "health",
      currentStageLabel: STEP_LABELS.health,
      nextRecommendedAction: "Review unhealthy deployment health signals before continuing.",
      explanation:
        "Health policy evaluation found blockers that must be resolved before the release can continue.",
      primaryAction: {
        label: "Open deployment health policy",
        href: panelHref(RUN_PANEL_IDS.deploymentHealthPolicy),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.deployment.latestHealthPolicyStatus === "needs_attention") {
    pushAll(
      warnings,
      summary.deployment.latestHealthPolicyWarnings.length > 0
        ? summary.deployment.latestHealthPolicyWarnings
        : [summary.deployment.latestHealthPolicyRecommendedAction ?? "Health policy needs attention."],
      panelHref(RUN_PANEL_IDS.deploymentHealthPolicy),
    );
  }

  if (!summary.release.checklistRecorded) {
    return {
      currentStageId: "checklist",
      currentStageLabel: STEP_LABELS.checklist,
      nextRecommendedAction: "Evaluate release checklist.",
      explanation:
        "Deployment and health status are recorded, but the release checklist has not been persisted yet.",
      primaryAction: {
        label: "Open release checklist",
        href: panelHref(RUN_PANEL_IDS.releaseChecklist),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.release.checklistStatus === "blocked" && !summary.release.latestSignoffDecision) {
    pushTopReleaseGateItems(blockers, summary.release.checklistBlockers);
    const firstGateAction = firstReleaseGateAction(summary.release.checklistBlockers);
    return {
      currentStageId: "checklist",
      currentStageLabel: STEP_LABELS.checklist,
      nextRecommendedAction:
        firstGateAction?.label ?? "Release cannot continue yet. Complete the blockers below.",
      explanation:
        "Checklist evaluation found release blockers that must be addressed before sign-off.",
      primaryAction: {
        label: firstGateAction?.label ?? "Review release checklist",
        href: firstGateAction?.href ?? panelHref(RUN_PANEL_IDS.releaseChecklist),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (!summary.release.latestSignoffDecision) {
    pushAll(
      warnings,
      summary.release.checklistNeedsAttention,
      panelHref(RUN_PANEL_IDS.releaseChecklist),
    );
    return {
      currentStageId: "signoff",
      currentStageLabel: STEP_LABELS.signoff,
      nextRecommendedAction:
        summary.release.checklistStatus === "needs_attention"
          ? "Review checklist exceptions before sign-off."
          : "Record release sign-off.",
      explanation:
        "Checklist evaluation is recorded. A final human sign-off is still required to complete the release flow.",
      primaryAction: {
        label: "Open release sign-off",
        href: panelHref(RUN_PANEL_IDS.releaseSignoff),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.release.latestSignoffDecision === "rejected") {
    blockers.push({
      text:
        summary.release.latestSignoffRationale?.trim() ||
        "The latest release sign-off rejected this release.",
      href: panelHref(RUN_PANEL_IDS.releaseSignoff),
    });
    return {
      currentStageId: "signoff",
      currentStageLabel: STEP_LABELS.signoff,
      nextRecommendedAction: "Review rejected sign-off and checklist state.",
      explanation:
        "The latest sign-off rejected the release. Review the rationale and checklist state before proceeding.",
      primaryAction: {
        label: "Open release sign-off",
        href: panelHref(RUN_PANEL_IDS.releaseSignoff),
      },
      blockers,
      warnings,
      secondaryActions,
    };
  }

  if (summary.release.latestSignoffDecision === "completed_with_exceptions") {
    pushAll(
      warnings,
      summary.release.checklistNeedsAttention,
      panelHref(RUN_PANEL_IDS.releaseSignoff),
    );
  }

  return {
    currentStageId: "signoff",
    currentStageLabel: STEP_LABELS.signoff,
    nextRecommendedAction: "Run is fully signed off.",
    explanation:
      "A release sign-off is recorded for this run. Technical evidence, replay, and audit details remain available below.",
    primaryAction: {
      label: "Review audit timeline",
      href: panelHref(RUN_PANEL_IDS.auditTimeline),
    },
    blockers,
    warnings,
    secondaryActions,
  };
}

function lifecycleStatus(
  summary: RunWorkflowSummary,
  stepId: RunLifecycleStepId,
): RunLifecycleStepStatus {
  const workerPlanComplete = summary.workerPlan.executionStatus === "executed";
  const approvalDone = approvalComplete(summary);

  switch (stepId) {
    case "task":
      return "complete";
    case "branch":
      return summary.run.branchName ? "complete" : "ready";
    case "worker_plan":
      if (!summary.run.branchName) return "not_started";
      if (summary.workerPlan.executionStatus === "executed") return "complete";
      if (
        summary.workerPlan.validationStatus === "invalid" ||
        summary.workerPlan.executionStatus === "failed"
      ) {
        return "blocked";
      }
      return "ready";
    case "quality_gates":
      if (!workerPlanComplete) return "not_started";
      if (summary.qualityGates.failedCount > 0) return "blocked";
      if (summary.qualityGates.count === 0) return "ready";
      if (summary.qualityGates.skippedCount > 0) return "warning";
      return "passed";
    case "evidence":
      if (!workerPlanComplete) return "not_started";
      if (summary.qualityGates.failedCount > 0) return "blocked";
      return summary.evidence.exists ? "complete" : "ready";
    case "replay":
      if (!summary.evidence.exists) return "not_started";
      if (!summary.replay.exists) return "ready";
      if (summary.replay.status === "failed") return "blocked";
      if (summary.replay.status === "warning") return "warning";
      return "passed";
    case "policy":
      if (!summary.evidence.exists) return "not_started";
      if (!summary.policy.exists) return "ready";
      if (summary.policy.status === "blocked") return "blocked";
      if (summary.policy.status === "warning" || summary.policy.status === "requires_review") {
        return "warning";
      }
      return "passed";
    case "review":
      if (!summary.policy.exists) return "not_started";
      if (summary.review.rejectedCount > 0) return "blocked";
      if (
        summary.policy.status === "requires_review" &&
        summary.review.stageCount === 0
      ) {
        return "ready";
      }
      if (summary.review.pendingCount > 0) return "ready";
      if (reviewComplete(summary)) return "complete";
      return reviewRequired(summary) ? "ready" : "complete";
    case "approval":
      if (!reviewComplete(summary)) return "not_started";
      if (approvalDone) return "complete";
      if (summary.run.status === "waiting_for_approval") {
        return summary.approval.canApprove ? "ready" : "blocked";
      }
      if (
        summary.approval.latestDecision === "request_fix" ||
        summary.approval.latestDecision === "stopped"
      ) {
        return "blocked";
      }
      return "ready";
    case "pr":
      if (!approvalDone) return "not_started";
      if (summary.pr.latestStatus === "pr_created") return "complete";
      if (summary.pr.latestStatus === "failed") return "blocked";
      return "ready";
    case "merge":
      if (!prCreated(summary)) return "not_started";
      if (mergeComplete(summary)) return "complete";
      if (
        summary.merge.latestStatus === "failed" ||
        summary.hardGates.mergeStatus === "blocked"
      ) {
        return "blocked";
      }
      return "ready";
    case "deployment":
      if (!mergeComplete(summary)) return "not_started";
      if (deploymentExecuted(summary)) return "complete";
      if (
        summary.deployment.latestApprovalDecision === "rejected" ||
        summary.deployment.latestExecutionStatus === "failed" ||
        summary.hardGates.deploymentApprovalStatus === "blocked" ||
        summary.hardGates.deploymentExecutionStatus === "blocked"
      ) {
        return "blocked";
      }
      return "ready";
    case "health":
      if (!deploymentExecuted(summary)) return "not_started";
      if (healthStepPassed(summary)) return "passed";
      if (summary.deployment.latestHealthPolicyStatus === "needs_attention") return "warning";
      if (
        summary.deployment.latestHealthPolicyStatus === "unhealthy" ||
        summary.deployment.latestHealthCheckStatus === "failed" ||
        summary.deployment.latestHealthCheckStatus === "unhealthy"
      ) {
        return "blocked";
      }
      return "ready";
    case "checklist":
      if (!deploymentExecuted(summary)) return "not_started";
      if (!summary.release.checklistRecorded) return "ready";
      if (summary.release.checklistStatus === "blocked") return "blocked";
      if (summary.release.checklistStatus === "needs_attention") return "warning";
      return "passed";
    case "signoff":
      if (!summary.release.checklistRecorded) return "not_started";
      if (!summary.release.latestSignoffDecision) return "ready";
      if (summary.release.latestSignoffDecision === "rejected") return "blocked";
      if (summary.release.latestSignoffDecision === "completed_with_exceptions") {
        return "warning";
      }
      return "complete";
  }
}

export function deriveRunLifecycleSteps(
  summary: RunWorkflowSummary,
): RunLifecycleStepState[] {
  return (Object.keys(STEP_LABELS) as RunLifecycleStepId[]).map((stepId) => ({
    id: stepId,
    label: STEP_LABELS[stepId],
    status: lifecycleStatus(summary, stepId),
    href: stepHref(summary, stepId),
  }));
}
