import { RUN_NAV_TARGET_IDS } from "./run-navigation";
import {
  applicableFromStageForIssue,
  resolveIssueApplicability,
  summarizeRunIssueAttention,
  toDisplaySeverity,
  type CurrentApplicability,
  type OperatorSeverity,
  type RunIssueDisplaySeverity,
  type RunIssueKind,
} from "./issue-lifecycle-applicability";
import type { RunCommandCenterState, RunLifecycleStepId, RunWorkflowSummary } from "./run-ux-types";
import { RUN_PANEL_IDS } from "./run-ux-types";
import type { RunWorkspaceViewId } from "./run-workspace";

export interface RunIssue {
  id: string;
  kind: RunIssueKind;
  severity: RunIssueDisplaySeverity;
  operatorSeverity: OperatorSeverity;
  applicability: CurrentApplicability;
  lifecycleStage: RunLifecycleStepId;
  applicableFromStage: RunLifecycleStepId;
  title: string;
  message: string;
  suggestedAction: string;
  view: RunWorkspaceViewId;
  anchorId?: string;
  sortPriority: number;
}

export interface RunIssueQueue {
  active: RunIssue[];
  future: RunIssue[];
  historical: RunIssue[];
  ordered: RunIssue[];
  attention: ReturnType<typeof summarizeRunIssueAttention>;
}

interface IssueDraft {
  id: string;
  kind: RunIssueKind;
  operatorSeverity: OperatorSeverity;
  title: string;
  activeTitle?: string;
  futureTitle?: string;
  message: string;
  activeMessage?: string;
  futureMessage?: string;
  suggestedAction: string;
  activeSuggestedAction?: string;
  futureSuggestedAction?: string;
  view: RunWorkspaceViewId;
  anchorId?: string;
  sortPriority: number;
  signalRecorded?: boolean;
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

function finalizeIssue(
  draft: IssueDraft,
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunIssue | null {
  const applicability = resolveIssueApplicability({
    kind: draft.kind,
    currentStageId: guidance.currentStageId,
    operatorSeverity: draft.operatorSeverity,
    summary,
    guidance,
    signalRecorded: draft.signalRecorded ?? true,
  });

  if (applicability === "not_applicable" || applicability === "resolved") {
    return null;
  }

  const severity = toDisplaySeverity(draft.operatorSeverity, applicability);
  const isFuture = applicability === "future_requirement";
  const isHistorical = applicability === "historical_context" || applicability === "stale";

  return {
    id: draft.id,
    kind: draft.kind,
    severity,
    operatorSeverity: draft.operatorSeverity,
    applicability,
    lifecycleStage: guidance.currentStageId,
    applicableFromStage: applicableFromStageForIssue(draft.kind),
    title: isFuture
      ? (draft.futureTitle ?? draft.title)
      : isHistorical
        ? draft.title
        : (draft.activeTitle ?? draft.title),
    message: isFuture
      ? (draft.futureMessage ?? draft.message)
      : isHistorical
        ? draft.message
        : (draft.activeMessage ?? draft.message),
    suggestedAction: isFuture
      ? (draft.futureSuggestedAction ?? draft.suggestedAction)
      : (draft.activeSuggestedAction ?? draft.suggestedAction),
    view: draft.view,
    anchorId: draft.anchorId,
    sortPriority: isFuture ? draft.sortPriority - 40 : isHistorical ? draft.sortPriority - 20 : draft.sortPriority,
  };
}

function sortIssues(issues: RunIssue[]): RunIssue[] {
  return issues.sort(
    (left, right) => right.sortPriority - left.sortPriority || left.title.localeCompare(right.title),
  );
}

function buildIssueDrafts(summary: RunWorkflowSummary, guidance: RunCommandCenterState): IssueDraft[] {
  const drafts: IssueDraft[] = [];
  const workerPlanComplete = summary.workerPlan.executionStatus === "executed";
  const workerPlanBlocked =
    summary.workerPlan.validationStatus === "invalid" ||
    summary.workerPlan.executionStatus === "failed";

  if (!workerPlanComplete && workerPlanBlocked) {
    if (summary.workerPlan.validationErrorCount > 0) {
      drafts.push({
        id: "worker-plan-validation-errors",
        kind: "worker_plan_validation",
        operatorSeverity: "critical",
        title: "Worker plan validation errors",
        activeTitle: "Current blocker: Worker plan validation errors",
        message: `${summary.workerPlan.validationErrorCount} validation error(s) must be fixed before execution.`,
        suggestedAction: "Open the work plan view and fix validation errors before executing.",
        view: "work_plan",
        anchorId: RUN_PANEL_IDS.workerPlan,
        sortPriority: 110,
      });
    }
    if (summary.workerPlan.executionErrorCount > 0) {
      drafts.push({
        id: "worker-plan-execution-errors",
        kind: "worker_plan_execution",
        operatorSeverity: "critical",
        title: "Worker plan execution failed",
        activeTitle: "Current blocker: Worker plan execution failed",
        message: `${summary.workerPlan.executionErrorCount} execution error(s) were recorded for the latest worker plan.`,
        suggestedAction: "Open the work plan view and review execution errors before retrying.",
        view: "work_plan",
        anchorId: RUN_PANEL_IDS.workerPlan,
        sortPriority: 109,
      });
    }
  }
  const auditScopeFailures = summary.audit.chainFailures.filter(
    (failure) =>
      failure.startsWith("duplicate_previous_hash:") || failure.startsWith("duplicate_chain_hash:"),
  );
  const auditRunFailures = summary.audit.chainFailures.filter(
    (failure) =>
      !failure.startsWith("duplicate_previous_hash:") && !failure.startsWith("duplicate_chain_hash:"),
  );

  if (!summary.audit.chainOk && auditRunFailures.length > 0 && auditScopeFailures.length > 0) {
    drafts.push({
      id: "audit-chain-inconsistent",
      kind: "audit_chain_inconsistent",
      operatorSeverity: "critical",
      title: "Audit state inconsistent",
      activeTitle: "Current blocker: Audit state inconsistent — review audit details",
      message:
        "This run has both run-scoped audit chain failures and global chain-scope duplicate hash signals.",
      suggestedAction: "Open the audit view and reconcile run events with chain-scope diagnostics.",
      view: "audit",
      anchorId: RUN_NAV_TARGET_IDS.auditChainDiagnostics,
      sortPriority: 101,
    });
  } else if (!summary.audit.chainOk && auditRunFailures.length > 0) {
    drafts.push({
      id: "audit-chain-failed",
      kind: "audit_chain_failed",
      operatorSeverity: "critical",
      title: "Audit chain failed",
      activeTitle: "Current blocker: Audit chain verification failed for this run.",
      futureTitle: "Audit verification required before release work",
      message: "The audit history did not verify cleanly for this run.",
      futureMessage: "Audit chain verification will need to pass before release work can continue.",
      suggestedAction: "Open the audit view and review chain diagnostics before continuing release work.",
      activeSuggestedAction:
        "Open the audit view and resolve run-scoped chain failures before continuing.",
      futureSuggestedAction: "Open the audit view when you are ready to verify the audit chain.",
      view: "audit",
      anchorId: RUN_NAV_TARGET_IDS.auditChainDiagnostics,
      sortPriority: 100,
    });
  } else if (!summary.audit.chainOk && auditScopeFailures.length > 0) {
    drafts.push({
      id: "audit-scope-notice",
      kind: "audit_scope_notice",
      operatorSeverity: "warning",
      title: "Audit chain scope notice",
      message:
        "Global audit chain scope reports duplicate hash entries that are not tied to this run's event chain.",
      suggestedAction: "Open the audit view and review chain-scope diagnostics. This is informational unless run events also fail.",
      view: "audit",
      anchorId: RUN_NAV_TARGET_IDS.auditChainDiagnostics,
      sortPriority: 55,
    });
  } else if (
    summary.audit.eventCount === 0 &&
    !["completed", "failed"].includes(summary.run.status)
  ) {
    drafts.push({
      id: "audit-verification-pending",
      kind: "audit_verification_pending",
      operatorSeverity: "info",
      title: "Audit verification not yet run",
      futureTitle: "Audit verification required later",
      message: "No audit events are recorded for this run yet.",
      futureMessage: "Audit verification will run once this run records audit events.",
      suggestedAction: "Continue the run workflow; audit verification will become relevant after events are recorded.",
      view: "audit",
      anchorId: RUN_NAV_TARGET_IDS.auditChainDiagnostics,
      sortPriority: 20,
      signalRecorded: true,
    });
  }

  if (hasHardGateBlockers(summary)) {
    drafts.push({
      id: "hard-release-gates-blocked",
      kind: "hard_release_gates_blocked",
      operatorSeverity: "critical",
      title: "Hard release gate blocked",
      activeTitle: "Current blocker: Hard release gate blocked",
      futureTitle: "Release gate requirements pending later",
      message: "A required release gate is still blocking merge, deployment, or sign-off work.",
      futureMessage:
        "Release gates will apply at merge, deployment, and sign-off. Requirements are recorded but not blocking the current stage.",
      suggestedAction: "Open the release view and follow the first gate checklist item before continuing.",
      futureSuggestedAction:
        "Continue the current lifecycle stage. Review release gates when the run reaches merge or deployment.",
      view: "release",
      anchorId: firstHardGateAnchor(summary),
      sortPriority: 96,
    });
  }

  if (!summary.evidence.exists) {
    drafts.push({
      id: "evidence-missing",
      kind: "evidence_missing",
      operatorSeverity: "warning",
      title: "Evidence missing",
      futureTitle: "Evidence bundle required later",
      message: "This run does not have a recorded evidence bundle yet.",
      futureMessage: "An evidence bundle will be required before replay and approval work.",
      suggestedAction: "Open the review view and generate or inspect the evidence bundle.",
      view: "review",
      anchorId: RUN_PANEL_IDS.evidence,
      sortPriority: 88,
    });
  }

  if (!summary.replay.exists) {
    drafts.push({
      id: "replay-missing",
      kind: "replay_missing",
      operatorSeverity: "warning",
      title: "Replay verification missing",
      futureTitle: "Replay verification required after evidence",
      message: "Replay verification has not been recorded for this run.",
      futureMessage: "Replay verification will be required after the evidence bundle is available.",
      suggestedAction: "Open the review view and run replay verification.",
      view: "review",
      anchorId: RUN_PANEL_IDS.replay,
      sortPriority: 86,
    });
  } else if (summary.replay.status === "failed") {
    drafts.push({
      id: "replay-failed",
      kind: "replay_failed",
      operatorSeverity: "critical",
      title: "Replay verification failed",
      activeTitle: "Current blocker: Replay verification failed",
      message: "Replay verification reported failed checks that must be reviewed before continuing.",
      suggestedAction: "Open the review view and inspect replay failures before approval or release work.",
      view: "review",
      anchorId: RUN_PANEL_IDS.replay,
      sortPriority: 92,
    });
  } else if (summary.replay.status === "warning") {
    drafts.push({
      id: "replay-warning",
      kind: "replay_warning",
      operatorSeverity: "warning",
      title: "Replay warning",
      message: "Replay verification passed with warnings that should be reviewed.",
      suggestedAction: "Open the review view and review the replay warning details.",
      view: "review",
      anchorId: RUN_PANEL_IDS.replay,
      sortPriority: 74,
    });
  }

  if (!summary.policy.exists) {
    drafts.push({
      id: "policy-missing",
      kind: "policy_missing",
      operatorSeverity: "warning",
      title: "Policy evaluation missing",
      futureTitle: "Policy evaluation required later",
      message: "Policy results have not been recorded for this run yet.",
      futureMessage: "Policy evaluation will be required before approval can complete.",
      suggestedAction: "Open the review view and evaluate policy before approval.",
      view: "review",
      anchorId: RUN_PANEL_IDS.policy,
      sortPriority: 84,
    });
  } else if (summary.policy.status === "blocked") {
    drafts.push({
      id: "policy-blocked",
      kind: "policy_blocked",
      operatorSeverity: "critical",
      title: "Policy blocked",
      activeTitle: "Current blocker: Policy evaluation blocked",
      futureTitle: "Policy evaluation required later",
      message: "Policy evaluation found blockers that must be resolved before approval.",
      futureMessage: "Policy evaluation will need to pass before approval and release work.",
      suggestedAction: "Open the review view and resolve policy blockers before continuing.",
      view: "review",
      anchorId: RUN_PANEL_IDS.policy,
      sortPriority: 90,
    });
  } else if (summary.policy.status === "requires_review") {
    drafts.push({
      id: "policy-requires-review",
      kind: "policy_requires_review",
      operatorSeverity: "warning",
      title: "Policy requires review",
      futureTitle: "Senior policy review required later",
      message: "Senior review is required before final approval can complete.",
      suggestedAction: "Open the review view and complete review stages before approving.",
      view: "review",
      anchorId: RUN_PANEL_IDS.reviewStages,
      sortPriority: 78,
    });
  }

  if (summary.review.rejectedCount > 0) {
    drafts.push({
      id: "review-stages-rejected",
      kind: "review_stages_rejected",
      operatorSeverity: "critical",
      title: "Review stage rejected",
      activeTitle: "Current blocker: Review stage rejected",
      message: "At least one required review stage has been rejected.",
      suggestedAction: "Open the review view and inspect rejected review stages before approval.",
      view: "review",
      anchorId: RUN_PANEL_IDS.reviewStages,
      sortPriority: 89,
    });
  } else if (summary.review.pendingCount > 0) {
    drafts.push({
      id: "review-stages-pending",
      kind: "review_stages_pending",
      operatorSeverity: "warning",
      title: "Review stages pending",
      futureTitle: "Review stages required later",
      message: "Required review work is still pending for this run.",
      suggestedAction: "Open the review view and complete required review stages.",
      view: "review",
      anchorId: RUN_PANEL_IDS.reviewStages,
      sortPriority: 80,
    });
  }

  if (summary.run.status === "waiting_for_approval") {
    if (summary.approval.canApprove && summary.policy.status === "requires_review") {
      drafts.push({
        id: "approval-rationale-required",
        kind: "approval_rationale_required",
        operatorSeverity: "warning",
        title: "Approval rationale required",
        message: "Approval is available, but a rationale is required because policy requires review.",
        suggestedAction: "Open the review view and record the decision with the required rationale.",
        view: "review",
        anchorId: RUN_PANEL_IDS.approval,
        sortPriority: 77,
      });
    } else if (summary.approval.canApprove) {
      drafts.push({
        id: "approval-pending",
        kind: "approval_pending",
        operatorSeverity: "info",
        title: "Approval pending",
        futureTitle: "Approval required after review gates complete",
        message: "The run is waiting for a human approval decision.",
        futureMessage: "Approval will be required after review and policy gates complete.",
        suggestedAction:
          "Open the review view and review the approval report before approving, requesting fixes, or stopping.",
        view: "review",
        anchorId: RUN_PANEL_IDS.approval,
        sortPriority: 68,
      });
    } else {
      drafts.push({
        id: "approval-blocked",
        kind: "approval_blocked",
        operatorSeverity: "warning",
        title: "Approval blocked",
        futureTitle: "Approval required after review gates complete",
        message:
          "The run is waiting for approval, but one or more governance issues still block the decision.",
        suggestedAction: "Open the review view and clear the remaining blockers before approving.",
        view: "review",
        anchorId: RUN_PANEL_IDS.approval,
        sortPriority: 82,
      });
    }
  }

  if (summary.pr.latestStatus === "failed" && summary.pr.latestCommitShaPrefix) {
    drafts.push({
      id: "pr-retry-available",
      kind: "pr_retry_available",
      operatorSeverity: "warning",
      title: "PR retry available",
      message:
        "A prior PR attempt recorded reusable state, so retry is available without creating a duplicate commit.",
      suggestedAction: "Open the PR view and review the PR state card before retrying draft PR creation.",
      view: "pr",
      anchorId: RUN_PANEL_IDS.prCreation,
      sortPriority: 72,
    });
  } else if (summary.pr.latestStatus === "failed") {
    drafts.push({
      id: "pr-failed",
      kind: "pr_failed",
      operatorSeverity: "warning",
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
    drafts.push({
      id: "pr-ready",
      kind: "pr_ready",
      operatorSeverity: "info",
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
    drafts.push({
      id: "deployment-health-warning",
      kind: "deployment_health_warning",
      operatorSeverity: "warning",
      title: "Deployment health warning",
      futureTitle: "Deployment health review required later",
      message: "Deployment health signals still need review before release work can finish.",
      suggestedAction: "Open the release view and review health checks and health policy.",
      view: "release",
      anchorId: RUN_PANEL_IDS.deploymentHealthPolicy,
      sortPriority: 66,
    });
  }

  if (!summary.release.checklistRecorded && guidance.currentStageId === "checklist") {
    drafts.push({
      id: "release-checklist-missing",
      kind: "release_checklist_missing",
      operatorSeverity: "warning",
      title: "Release checklist incomplete",
      message: "The release checklist has not been recorded yet.",
      suggestedAction: "Open the release view and evaluate the release checklist.",
      view: "release",
      anchorId: RUN_PANEL_IDS.releaseChecklist,
      sortPriority: 64,
    });
  } else if (summary.release.checklistStatus === "needs_attention") {
    drafts.push({
      id: "release-checklist-attention",
      kind: "release_checklist_attention",
      operatorSeverity: "warning",
      title: "Release checklist incomplete",
      message: "The checklist is recorded, but it still contains items that need attention.",
      suggestedAction: "Open the release view and review checklist exceptions before sign-off.",
      view: "release",
      anchorId: RUN_PANEL_IDS.releaseChecklist,
      sortPriority: 63,
    });
  }

  if (summary.release.checklistRecorded && !summary.release.latestSignoffDecision) {
    drafts.push({
      id: "release-signoff-missing",
      kind: "release_signoff_missing",
      operatorSeverity: "warning",
      title: "Sign-off missing",
      futureTitle: "Release sign-off required later",
      message: "Release checklist data exists, but no final sign-off decision has been recorded.",
      suggestedAction: "Open the release view and review release sign-off.",
      view: "release",
      anchorId: RUN_PANEL_IDS.releaseSignoff,
      sortPriority: 62,
    });
  }

  return drafts;
}

export function deriveRunIssueQueue(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunIssueQueue {
  const drafts = buildIssueDrafts(summary, guidance);
  const finalized = drafts
    .map((draft) => finalizeIssue(draft, summary, guidance))
    .filter((issue): issue is RunIssue => issue !== null);

  const active = sortIssues(finalized.filter((issue) => issue.applicability === "active_now"));
  const future = sortIssues(finalized.filter((issue) => issue.applicability === "future_requirement"));
  const historical = sortIssues(
    finalized.filter(
      (issue) => issue.applicability === "historical_context" || issue.applicability === "stale",
    ),
  );

  const ordered = [...active, ...future, ...historical];

  return {
    active,
    future,
    historical,
    ordered,
    attention: summarizeRunIssueAttention(ordered),
  };
}

/** Flat issue list: active first, then future requirements, then historical notices. */
export function deriveRunIssues(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunIssue[] {
  return deriveRunIssueQueue(summary, guidance).ordered;
}
