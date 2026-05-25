import type {
  RunCommandCenterState,
  RunCurrentActionZoneState,
  RunSectionGroupState,
  RunWorkflowSummary,
} from "./run-ux-types";
import { RUN_PANEL_IDS } from "./run-ux-types";

function stageIn(
  currentStageId: RunCommandCenterState["currentStageId"],
  ids: RunCommandCenterState["currentStageId"][],
): boolean {
  return ids.includes(currentStageId);
}

function releaseFlowActive(summary: RunWorkflowSummary): boolean {
  return (
    summary.approval.latestDecision === "approved" ||
    summary.pr.attemptCount > 0 ||
    summary.merge.attemptCount > 0 ||
    summary.deployment.approvalCount > 0 ||
    summary.deployment.latestExecutionStatus !== null ||
    summary.deployment.latestHealthCheckStatus !== null ||
    summary.deployment.latestHealthPolicyStatus !== null ||
    summary.release.checklistRecorded ||
    summary.release.signoffCount > 0
  );
}

function activeWorkState(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): Omit<RunSectionGroupState, "id" | "title" | "description" | "panelIds"> {
  if (stageIn(guidance.currentStageId, ["worker_plan"])) {
    return {
      currentStateLabel: "Worker plan work is active.",
      nextActionLabel: guidance.nextRecommendedAction,
      defaultExpanded: true,
      tone: guidance.blockers.length > 0 ? "blocked" : guidance.warnings.length > 0 ? "warning" : "ready",
    };
  }
  if (stageIn(guidance.currentStageId, ["quality_gates"])) {
    return {
      currentStateLabel: "Quality gate review is active.",
      nextActionLabel: guidance.nextRecommendedAction,
      defaultExpanded: true,
      tone: guidance.blockers.length > 0 ? "blocked" : guidance.warnings.length > 0 ? "warning" : "ready",
    };
  }
  if (stageIn(guidance.currentStageId, ["approval"])) {
    return {
      currentStateLabel: "Approval work is active.",
      nextActionLabel: guidance.nextRecommendedAction,
      defaultExpanded: true,
      tone: guidance.blockers.length > 0 ? "blocked" : guidance.warnings.length > 0 ? "warning" : "ready",
    };
  }
  if (summary.workerPlan.executionStatus !== "executed") {
    return {
      currentStateLabel: "Preparation work is still in progress.",
      nextActionLabel: "Review and execute the worker plan.",
      defaultExpanded: true,
      tone: "ready",
    };
  }
  return {
    currentStateLabel: "Preparation panels are available for reference.",
    nextActionLabel: "Use this group when the run needs file, diff, gate, or approval work.",
    defaultExpanded: false,
    tone: "neutral",
  };
}

function governanceState(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): Omit<RunSectionGroupState, "id" | "title" | "description" | "panelIds"> {
  const governanceStageActive = stageIn(guidance.currentStageId, ["evidence", "replay", "policy", "review", "approval"]);
  const governanceNeedsAttention =
    !summary.evidence.exists ||
    !summary.replay.exists ||
    summary.replay.status === "failed" ||
    summary.policy.status === "blocked" ||
    summary.policy.status === "requires_review" ||
    summary.review.pendingCount > 0 ||
    summary.review.rejectedCount > 0;

  return {
    currentStateLabel: governanceNeedsAttention
      ? "Governance review still needs attention."
      : "Governance evidence is recorded.",
    nextActionLabel: governanceStageActive
      ? guidance.nextRecommendedAction
      : "Open this group when evidence, replay, policy, review, or approval details matter.",
    defaultExpanded: governanceStageActive || governanceNeedsAttention,
    tone: summary.policy.status === "blocked" || summary.review.rejectedCount > 0 || summary.replay.status === "failed"
      ? "blocked"
      : summary.policy.status === "requires_review" || summary.review.pendingCount > 0
        ? "warning"
        : governanceNeedsAttention
          ? "ready"
          : "neutral",
  };
}

function releaseState(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): Omit<RunSectionGroupState, "id" | "title" | "description" | "panelIds"> {
  const releaseStageActive = stageIn(guidance.currentStageId, ["pr", "merge", "deployment", "health", "checklist", "signoff"]);
  const hasHardGateBlockers =
    summary.hardGates.mergeBlockers.length > 0 ||
    summary.hardGates.deploymentApprovalBlockers.length > 0 ||
    summary.hardGates.deploymentExecutionBlockers.length > 0 ||
    summary.hardGates.signoffCompletedBlockers.length > 0 ||
    summary.hardGates.signoffExceptionsBlockers.length > 0;

  return {
    currentStateLabel: releaseFlowActive(summary)
      ? "Release controls are active for this run."
      : "Release controls stay available after approval.",
    nextActionLabel: releaseStageActive
      ? guidance.nextRecommendedAction
      : "This group becomes the main workspace after approval and PR readiness.",
    defaultExpanded: releaseStageActive || releaseFlowActive(summary),
    tone: hasHardGateBlockers
      ? "blocked"
      : summary.pr.latestStatus === "failed" || summary.release.checklistStatus === "needs_attention"
        ? "warning"
        : releaseFlowActive(summary)
          ? "ready"
          : "neutral",
  };
}

function technicalAuditState(
  summary: RunWorkflowSummary,
): Omit<RunSectionGroupState, "id" | "title" | "description" | "panelIds"> {
  return {
    currentStateLabel: summary.audit.chainOk
      ? "Audit chain is healthy."
      : "Audit chain verification needs attention.",
    nextActionLabel: summary.audit.chainOk
      ? "Open this group for audit history, chain verification, and raw technical details."
      : "Review the audit timeline and chain failures before continuing release work.",
    defaultExpanded: !summary.audit.chainOk,
    tone: summary.audit.chainOk ? "neutral" : "blocked",
  };
}

export function deriveRunSectionGroups(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunSectionGroupState[] {
  const active = activeWorkState(summary, guidance);
  const governance = governanceState(summary, guidance);
  const release = releaseState(summary, guidance);
  const technical = technicalAuditState(summary);

  return [
    {
      id: "active_work",
      title: "Active Work",
      description:
        "Panels for preparing the change set, reviewing file changes, checking gates, and handling approval actions when the run is still in active operator work.",
      panelIds: [
        RUN_PANEL_IDS.workerPlan,
        RUN_PANEL_IDS.changedFiles,
        RUN_PANEL_IDS.qualityGates,
        RUN_PANEL_IDS.approval,
      ],
      ...active,
    },
    {
      id: "governance_review",
      title: "Governance & Review",
      description:
        "Evidence and review panels that explain why the run can or cannot move forward. Use this group for evidence, replay, policy, review stages, approval report details, and decision history.",
      panelIds: [
        RUN_PANEL_IDS.evidence,
        RUN_PANEL_IDS.replay,
        RUN_PANEL_IDS.policy,
        RUN_PANEL_IDS.reviewStages,
        RUN_PANEL_IDS.approval,
      ],
      ...governance,
    },
    {
      id: "pr_release",
      title: "PR & Release",
      description:
        "Manual release controls used after approval to create or record a PR, merge, approve deployment, review health, complete the release checklist, and record sign-off.",
      panelIds: [
        RUN_PANEL_IDS.prCreation,
        RUN_PANEL_IDS.mergeControls,
        RUN_PANEL_IDS.deploymentGates,
        RUN_PANEL_IDS.deploymentExecution,
        RUN_PANEL_IDS.deploymentHealth,
        RUN_PANEL_IDS.deploymentHealthPolicy,
        RUN_PANEL_IDS.releaseChecklist,
        RUN_PANEL_IDS.releaseSignoff,
      ],
      ...release,
    },
    {
      id: "technical_audit",
      title: "Technical Audit",
      description:
        "Append-only audit history and technical verification details. This group keeps advanced context accessible without dominating the main operator workflow.",
      panelIds: [RUN_PANEL_IDS.auditTimeline],
      ...technical,
    },
  ];
}

const STAGE_DESCRIPTIONS: Record<RunCommandCenterState["currentStageId"], string> = {
  task: "Review the task definition and confirm the run context before continuing.",
  branch: "Confirm the working branch is ready before the run moves into file changes and review.",
  worker_plan: "Review the planned file operations and complete the active work needed to prepare this run.",
  quality_gates: "Use the recorded gate results to confirm the change set is safe to move into governance review.",
  evidence: "Capture and inspect the run facts that later policy, replay, and approval decisions depend on.",
  replay: "Confirm the recorded run history is internally consistent before policy and approval continue.",
  policy: "Review governance evaluation results and resolve policy blockers or review requirements.",
  review: "Complete the required review stages before final approval.",
  approval: "Record the final human decision for this run without changing any governance authority.",
  pr: "Create or record the draft PR after approval readiness checks pass.",
  merge: "Review the merge controls after PR creation is complete and release gates allow it.",
  deployment: "Use deployment gates and execution panels when the release path is active.",
  health: "Run and review health verification before final release checklist and sign-off work.",
  checklist: "Complete the release checklist before final sign-off.",
  signoff: "Record the final release sign-off once the release checklist is ready.",
};

export function deriveRunCurrentActionZoneState(
  summary: RunWorkflowSummary,
  guidance: RunCommandCenterState,
): RunCurrentActionZoneState {
  const blockers = guidance.blockers.slice(0, 3);
  const warnings = guidance.warnings.slice(0, 3);

  return {
    title: `Current action: ${guidance.currentStageLabel}`,
    description: STAGE_DESCRIPTIONS[guidance.currentStageId],
    currentStateLabel: guidance.nextRecommendedAction,
    currentStateDetail: guidance.explanation,
    primaryAction: guidance.primaryAction,
    blockers,
    warnings,
  };
}

export function groupContainsPanel(
  groups: RunSectionGroupState[],
  groupId: RunSectionGroupState["id"],
  panelId: string,
): boolean {
  return groups.find((group) => group.id === groupId)?.panelIds.includes(panelId) ?? false;
}
