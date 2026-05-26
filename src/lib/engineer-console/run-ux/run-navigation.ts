import {
  RUN_PANEL_IDS,
  type RunCommandCenterState,
  type RunSectionGroupId,
  type RunWorkflowSummary,
} from "./run-ux-types";

export const RUN_GROUP_ANCHOR_IDS: Record<RunSectionGroupId, string> = {
  active_work: "active-work",
  governance_review: "governance-review",
  pr_release: "pr-release",
  technical_audit: "technical-audit",
};

export const RUN_NAV_TARGET_IDS = {
  currentAction: "current-action",
  prTechnicalReadiness: "pr-technical-readiness",
  replayTechnicalDetails: "replay-technical-details",
  evidenceDetails: "evidence-bundle-details",
  auditChainDiagnostics: "audit-chain-diagnostics",
} as const;

export type RunNavTone = "neutral" | "ready" | "warning" | "blocked" | "complete";

export interface RunQuickNavItemState {
  id: string;
  label: string;
  href: string;
  targetId: string;
  tone: RunNavTone;
  statusLabel: string;
  shortcutKey?: string;
}

export interface RunExpertSummaryItem {
  id: string;
  label: string;
  status: string;
}

export const RUN_NAV_SHORTCUTS = [
  { key: "w", label: "Worker plan", targetId: RUN_PANEL_IDS.workerPlan },
  { key: "a", label: "Approval", targetId: RUN_PANEL_IDS.approval },
  { key: "p", label: "PR creation", targetId: RUN_PANEL_IDS.prCreation },
  { key: "r", label: "Review stages", targetId: RUN_PANEL_IDS.reviewStages },
  { key: "e", label: "Evidence", targetId: RUN_PANEL_IDS.evidence },
  { key: "t", label: "Technical audit", targetId: RUN_PANEL_IDS.auditTimeline },
] as const;

function panelHref(targetId: string): string {
  return `#${targetId}`;
}

function badgeStatus(tone: RunNavTone, label: string): { tone: RunNavTone; statusLabel: string } {
  return { tone, statusLabel: label };
}

function workerPlanNavStatus(summary: RunWorkflowSummary) {
  if (summary.workerPlan.executionStatus === "failed" || summary.workerPlan.validationStatus === "invalid") {
    return badgeStatus("blocked", "blocked");
  }
  if (summary.workerPlan.executionStatus === "executed") {
    return badgeStatus("complete", "done");
  }
  if (summary.workerPlan.hasDraft || summary.workerPlan.exists) {
    return badgeStatus("ready", "ready");
  }
  return badgeStatus("neutral", "none");
}

function approvalNavStatus(summary: RunWorkflowSummary) {
  if (summary.approval.latestDecision === "approved") {
    return badgeStatus("complete", "approved");
  }
  if (summary.approval.latestDecision === "request_fix" || summary.approval.latestDecision === "stopped") {
    return badgeStatus("blocked", "decision");
  }
  if (summary.review.rejectedCount > 0 || summary.policy.status === "blocked") {
    return badgeStatus("blocked", "blocked");
  }
  if (summary.review.pendingCount > 0 || summary.policy.status === "requires_review") {
    return badgeStatus("warning", "review");
  }
  if (summary.approval.canApprove) {
    return badgeStatus("ready", "ready");
  }
  return badgeStatus("neutral", "pending");
}

function replayNavStatus(summary: RunWorkflowSummary) {
  if (!summary.replay.exists) return badgeStatus("ready", "missing");
  if (summary.replay.status === "failed") return badgeStatus("blocked", "failed");
  if (summary.replay.status === "warning") return badgeStatus("warning", "warning");
  if (summary.replay.status === "passed") return badgeStatus("complete", "passed");
  return badgeStatus("neutral", summary.replay.status ?? "unknown");
}

function policyNavStatus(summary: RunWorkflowSummary) {
  if (!summary.policy.exists) return badgeStatus("ready", "missing");
  if (summary.policy.status === "blocked") return badgeStatus("blocked", "blocked");
  if (summary.policy.status === "requires_review") return badgeStatus("warning", "review");
  if (summary.policy.status === "passed") return badgeStatus("complete", "passed");
  return badgeStatus("neutral", summary.policy.status ?? "unknown");
}

function reviewNavStatus(summary: RunWorkflowSummary) {
  if (summary.review.rejectedCount > 0) return badgeStatus("blocked", "rejected");
  if (summary.review.pendingCount > 0) return badgeStatus("warning", "pending");
  if (summary.review.requiredCount > 0 && summary.review.approvedCount >= summary.review.requiredCount) {
    return badgeStatus("complete", "approved");
  }
  if (summary.policy.status === "requires_review" || summary.review.requiredCount > 0) {
    return badgeStatus("ready", "needed");
  }
  return badgeStatus("neutral", "none");
}

function prNavStatus(summary: RunWorkflowSummary) {
  if (summary.pr.latestReadinessStatus === "blocked") return badgeStatus("blocked", "blocked");
  if (summary.pr.latestStatus === "failed") return badgeStatus("warning", "retry");
  if (summary.pr.latestStatus === "pr_created") return badgeStatus("complete", "open");
  if (summary.pr.latestReadinessStatus === "requires_review") return badgeStatus("warning", "review");
  if (summary.pr.latestReadinessStatus === "ready") return badgeStatus("ready", "ready");
  if (summary.approval.latestDecision === "approved") return badgeStatus("ready", "next");
  return badgeStatus("neutral", "none");
}

function mergeNavStatus(summary: RunWorkflowSummary) {
  if (summary.hardGates.mergeBlockers.length > 0) return badgeStatus("blocked", "blocked");
  if (summary.merge.latestStatus === "merged") return badgeStatus("complete", "merged");
  if (summary.pr.latestStatus === "pr_created") return badgeStatus("ready", "ready");
  return badgeStatus("neutral", "none");
}

function deployNavStatus(summary: RunWorkflowSummary) {
  if (
    summary.deployment.latestHealthPolicyBlockers.length > 0 ||
    summary.hardGates.deploymentApprovalBlockers.length > 0 ||
    summary.hardGates.deploymentExecutionBlockers.length > 0
  ) {
    return badgeStatus("blocked", "blocked");
  }
  if (summary.deployment.latestHealthPolicyWarnings.length > 0) {
    return badgeStatus("warning", "warning");
  }
  if (summary.deployment.latestExecutionStatus === "succeeded") {
    return badgeStatus("complete", "done");
  }
  if (summary.merge.latestStatus === "merged" || summary.deployment.approvalCount > 0) {
    return badgeStatus("ready", "ready");
  }
  return badgeStatus("neutral", "none");
}

function checklistNavStatus(summary: RunWorkflowSummary) {
  if (summary.release.checklistStatus === "blocked") return badgeStatus("blocked", "blocked");
  if (summary.release.checklistStatus === "needs_attention") return badgeStatus("warning", "attention");
  if (summary.release.checklistStatus === "complete" || summary.release.checklistStatus === "passed") {
    return badgeStatus("complete", "ready");
  }
  if (summary.deployment.latestExecutionStatus === "succeeded") return badgeStatus("ready", "next");
  return badgeStatus("neutral", "none");
}

function signoffNavStatus(summary: RunWorkflowSummary) {
  if (summary.release.latestSignoffDecision === "rejected") return badgeStatus("blocked", "rejected");
  if (summary.release.latestSignoffDecision === "completed_with_exceptions") {
    return badgeStatus("warning", "exceptions");
  }
  if (summary.release.latestSignoffDecision === "completed") return badgeStatus("complete", "signed");
  if (summary.release.checklistRecorded) return badgeStatus("ready", "next");
  return badgeStatus("neutral", "none");
}

function auditNavStatus(summary: RunWorkflowSummary) {
  if (!summary.audit.chainOk) return badgeStatus("blocked", "issues");
  if (summary.audit.eventCount > 0) return badgeStatus("complete", "verified");
  return badgeStatus("neutral", "empty");
}

export function buildRunQuickNavItems(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunQuickNavItemState[] {
  return [
    {
      id: "current-action",
      label: "Current action",
      href: panelHref(RUN_NAV_TARGET_IDS.currentAction),
      targetId: RUN_NAV_TARGET_IDS.currentAction,
      shortcutKey: undefined,
      ...badgeStatus(
        guidance.blockers.length > 0 ? "blocked" : guidance.warnings.length > 0 ? "warning" : "ready",
        guidance.currentStageLabel.toLowerCase(),
      ),
    },
    {
      id: "worker-plan",
      label: "Worker plan",
      href: panelHref(RUN_PANEL_IDS.workerPlan),
      targetId: RUN_PANEL_IDS.workerPlan,
      shortcutKey: "g w",
      ...workerPlanNavStatus(summary),
    },
    {
      id: "approval",
      label: "Approval",
      href: panelHref(RUN_PANEL_IDS.approval),
      targetId: RUN_PANEL_IDS.approval,
      shortcutKey: "g a",
      ...approvalNavStatus(summary),
    },
    {
      id: "evidence",
      label: "Evidence",
      href: panelHref(RUN_PANEL_IDS.evidence),
      targetId: RUN_PANEL_IDS.evidence,
      shortcutKey: "g e",
      ...(summary.evidence.exists ? badgeStatus("complete", "ready") : badgeStatus("ready", "missing")),
    },
    {
      id: "replay",
      label: "Replay",
      href: panelHref(RUN_PANEL_IDS.replay),
      targetId: RUN_PANEL_IDS.replay,
      ...replayNavStatus(summary),
    },
    {
      id: "policy",
      label: "Policy",
      href: panelHref(RUN_PANEL_IDS.policy),
      targetId: RUN_PANEL_IDS.policy,
      ...policyNavStatus(summary),
    },
    {
      id: "reviews",
      label: "Reviews",
      href: panelHref(RUN_PANEL_IDS.reviewStages),
      targetId: RUN_PANEL_IDS.reviewStages,
      shortcutKey: "g r",
      ...reviewNavStatus(summary),
    },
    {
      id: "pr",
      label: "PR",
      href: panelHref(RUN_PANEL_IDS.prCreation),
      targetId: RUN_PANEL_IDS.prCreation,
      shortcutKey: "g p",
      ...prNavStatus(summary),
    },
    {
      id: "merge",
      label: "Merge",
      href: panelHref(RUN_PANEL_IDS.mergeControls),
      targetId: RUN_PANEL_IDS.mergeControls,
      ...mergeNavStatus(summary),
    },
    {
      id: "deploy",
      label: "Deploy",
      href: panelHref(RUN_PANEL_IDS.deploymentGates),
      targetId: RUN_PANEL_IDS.deploymentGates,
      ...deployNavStatus(summary),
    },
    {
      id: "checklist",
      label: "Checklist",
      href: panelHref(RUN_PANEL_IDS.releaseChecklist),
      targetId: RUN_PANEL_IDS.releaseChecklist,
      ...checklistNavStatus(summary),
    },
    {
      id: "signoff",
      label: "Sign-off",
      href: panelHref(RUN_PANEL_IDS.releaseSignoff),
      targetId: RUN_PANEL_IDS.releaseSignoff,
      ...signoffNavStatus(summary),
    },
    {
      id: "audit",
      label: "Audit",
      href: panelHref(RUN_PANEL_IDS.auditTimeline),
      targetId: RUN_PANEL_IDS.auditTimeline,
      shortcutKey: "g t",
      ...auditNavStatus(summary),
    },
  ];
}

function expertSummaryStatus(
  value: string | null | undefined,
  fallback = "not started",
): string {
  return value ?? fallback;
}

export function buildRunExpertSummaryItems(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunExpertSummaryItem[] {
  const gateStatus =
    summary.qualityGates.failedCount > 0
      ? "failed"
      : summary.qualityGates.count > 0
        ? "passed"
        : "pending";
  const reviewStatus =
    summary.review.rejectedCount > 0
      ? "rejected"
      : summary.review.pendingCount > 0
        ? "pending"
        : summary.review.requiredCount > 0 && summary.review.approvedCount >= summary.review.requiredCount
          ? "approved"
          : "not required";
  const prStatus =
    summary.pr.latestStatus ??
    summary.pr.latestReadinessStatus ??
    (summary.approval.latestDecision === "approved" ? "ready" : "not started");
  const releaseGateStatus = summary.hardGates.enabled
    ? summary.hardGates.mergeStatus ??
      summary.hardGates.deploymentExecutionStatus ??
      summary.hardGates.signoffCompletedStatus ??
      "enabled"
    : "disabled";

  return [
    { id: "run-status", label: "Run", status: summary.run.status },
    { id: "stage", label: "Stage", status: guidance.currentStageLabel },
    { id: "risk", label: "Risk", status: expertSummaryStatus(summary.run.riskLevel, "none") },
    { id: "gates", label: "Gates", status: gateStatus },
    { id: "evidence", label: "Evidence", status: summary.evidence.exists ? "ready" : "missing" },
    { id: "replay", label: "Replay", status: expertSummaryStatus(summary.replay.status, "missing") },
    { id: "policy", label: "Policy", status: expertSummaryStatus(summary.policy.status, "missing") },
    { id: "review", label: "Reviews", status: reviewStatus },
    { id: "pr", label: "PR", status: prStatus },
    { id: "release-gates", label: "Release gates", status: releaseGateStatus },
    {
      id: "signoff",
      label: "Sign-off",
      status: expertSummaryStatus(summary.release.latestSignoffDecision, "not started"),
    },
  ];
}

const PANEL_LINK_LABELS: Record<string, string> = {
  [RUN_PANEL_IDS.runState]: "Go to Run state",
  [RUN_PANEL_IDS.workerPlan]: "Go to Worker plan",
  [RUN_PANEL_IDS.qualityGates]: "Go to Quality gates",
  [RUN_PANEL_IDS.evidence]: "Go to Evidence bundle",
  [RUN_PANEL_IDS.replay]: "Go to Replay verification",
  [RUN_PANEL_IDS.policy]: "Go to Policy results",
  [RUN_PANEL_IDS.reviewStages]: "Go to Review stages",
  [RUN_PANEL_IDS.approval]: "Go to Approval report",
  [RUN_PANEL_IDS.prCreation]: "Go to PR creation",
  [RUN_PANEL_IDS.mergeControls]: "Go to Merge controls",
  [RUN_PANEL_IDS.deploymentGates]: "Go to Deployment gates",
  [RUN_PANEL_IDS.deploymentHealthPolicy]: "Go to Deployment health policy",
  [RUN_PANEL_IDS.releaseChecklist]: "Go to Release checklist",
  [RUN_PANEL_IDS.releaseSignoff]: "Go to Release sign-off",
  [RUN_PANEL_IDS.auditTimeline]: "Go to Technical audit",
  [RUN_NAV_TARGET_IDS.prTechnicalReadiness]: "View technical readiness",
  [RUN_NAV_TARGET_IDS.replayTechnicalDetails]: "View technical replay details",
  [RUN_NAV_TARGET_IDS.evidenceDetails]: "View evidence hash and details",
  [RUN_NAV_TARGET_IDS.auditChainDiagnostics]: "View audit chain diagnostics",
};

export function runNavigationLabelForHref(href?: string): string | null {
  if (!href?.startsWith("#")) return null;
  return PANEL_LINK_LABELS[href.slice(1)] ?? null;
}

export function runSectionGroupIdForTarget(targetId: string): RunSectionGroupId | null {
  if ([RUN_PANEL_IDS.workerPlan, RUN_PANEL_IDS.changedFiles, RUN_PANEL_IDS.qualityGates].includes(targetId as never)) {
    return "active_work";
  }

  if (
    [
      RUN_PANEL_IDS.evidence,
      RUN_PANEL_IDS.replay,
      RUN_PANEL_IDS.policy,
      RUN_PANEL_IDS.reviewStages,
      RUN_PANEL_IDS.approval,
      RUN_NAV_TARGET_IDS.prTechnicalReadiness,
      RUN_NAV_TARGET_IDS.replayTechnicalDetails,
      RUN_NAV_TARGET_IDS.evidenceDetails,
    ].includes(targetId as never)
  ) {
    return "governance_review";
  }

  if (
    [
      RUN_PANEL_IDS.prCreation,
      RUN_PANEL_IDS.mergeControls,
      RUN_PANEL_IDS.deploymentGates,
      RUN_PANEL_IDS.deploymentExecution,
      RUN_PANEL_IDS.deploymentHealth,
      RUN_PANEL_IDS.deploymentHealthPolicy,
      RUN_PANEL_IDS.releaseChecklist,
      RUN_PANEL_IDS.releaseSignoff,
    ].includes(targetId as never) ||
    targetId.startsWith("hard-release-gate-details-")
  ) {
    return "pr_release";
  }

  if ([RUN_PANEL_IDS.auditTimeline, RUN_NAV_TARGET_IDS.auditChainDiagnostics].includes(targetId as never)) {
    return "technical_audit";
  }

  return null;
}

export function expandGroupForTarget(
  expanded: Record<RunSectionGroupId, boolean>,
  targetId: string,
): Record<RunSectionGroupId, boolean> {
  const groupId = runSectionGroupIdForTarget(targetId);
  if (!groupId) return expanded;
  return {
    ...expanded,
    [groupId]: true,
  };
}

function hasClosestMethod(
  target: EventTarget | null,
): target is EventTarget & { closest: (selector: string) => unknown } {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!hasClosestMethod(target)) return false;
  if (target.closest("input, textarea, select")) return true;
  if (target.closest("[contenteditable='true']")) return true;
  return target.closest("[contenteditable]") !== null;
}

export function shouldIgnoreRunNavigationShortcut(input: {
  target: EventTarget | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): boolean {
  return Boolean(input.metaKey || input.ctrlKey || input.altKey || isEditableElement(input.target));
}

export function resolveRunNavigationShortcut(input: {
  pendingPrefix: string | null;
  key: string;
  target: EventTarget | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): { nextPendingPrefix: string | null; targetId: string | null } {
  if (shouldIgnoreRunNavigationShortcut(input)) {
    return { nextPendingPrefix: null, targetId: null };
  }

  const key = input.key.toLowerCase();
  if (key === "escape") {
    return { nextPendingPrefix: null, targetId: null };
  }

  if (!input.pendingPrefix) {
    if (key === "g") {
      return { nextPendingPrefix: "g", targetId: null };
    }
    return { nextPendingPrefix: null, targetId: null };
  }

  if (input.pendingPrefix === "g") {
    const match = RUN_NAV_SHORTCUTS.find((shortcut) => shortcut.key === key);
    return {
      nextPendingPrefix: null,
      targetId: match?.targetId ?? null,
    };
  }

  return { nextPendingPrefix: null, targetId: null };
}
