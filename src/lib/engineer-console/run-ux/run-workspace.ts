import { RUN_GROUP_ANCHOR_IDS, RUN_NAV_TARGET_IDS } from "./run-navigation";
import { RUN_PANEL_IDS } from "./run-ux-types";

export type RunWorkspaceViewId =
  | "overview"
  | "work_plan"
  | "review"
  | "pr"
  | "release"
  | "audit";

export interface RunWorkspaceViewDefinition {
  id: RunWorkspaceViewId;
  label: string;
  description: string;
}

export const RUN_WORKSPACE_VIEWS: RunWorkspaceViewDefinition[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Status, lifecycle, current action, and top navigation.",
  },
  {
    id: "work_plan",
    label: "Work Plan",
    description: "Worker plan draft, execution, changed files, and quality gates.",
  },
  {
    id: "review",
    label: "Review",
    description: "Approval, evidence, replay, policy, review stages, and decisions.",
  },
  {
    id: "pr",
    label: "PR",
    description: "Draft PR readiness, retry, and PR request history.",
  },
  {
    id: "release",
    label: "Release",
    description: "Merge, deploy, health, checklist, and sign-off.",
  },
  {
    id: "audit",
    label: "Audit",
    description: "Audit timeline, chain diagnostics, and technical verification details.",
  },
];

export const DEFAULT_RUN_WORKSPACE_VIEW: RunWorkspaceViewId = "overview";

export function getRunWorkspaceView(
  viewId: RunWorkspaceViewId,
): RunWorkspaceViewDefinition {
  return RUN_WORKSPACE_VIEWS.find((view) => view.id === viewId) ?? RUN_WORKSPACE_VIEWS[0]!;
}

export function getRunWorkspaceViewForTarget(
  targetId: string | null | undefined,
): RunWorkspaceViewId | null {
  if (!targetId) return null;

  if (
    [
      RUN_PANEL_IDS.runState,
      RUN_NAV_TARGET_IDS.currentAction,
      RUN_GROUP_ANCHOR_IDS.active_work,
      "run-command-center",
      "run-lifecycle",
      "run-quick-nav",
      "run-expert-summary",
    ].includes(targetId as never)
  ) {
    return "overview";
  }

  if (
    [
      RUN_PANEL_IDS.workerPlan,
      RUN_PANEL_IDS.changedFiles,
      RUN_PANEL_IDS.qualityGates,
    ].includes(targetId as never)
  ) {
    return "work_plan";
  }

  if (
    [
      RUN_PANEL_IDS.evidence,
      RUN_PANEL_IDS.replay,
      RUN_PANEL_IDS.policy,
      RUN_PANEL_IDS.reviewStages,
      RUN_PANEL_IDS.approval,
      RUN_GROUP_ANCHOR_IDS.governance_review,
      RUN_NAV_TARGET_IDS.evidenceDetails,
      RUN_NAV_TARGET_IDS.replayTechnicalDetails,
    ].includes(targetId as never)
  ) {
    return "review";
  }

  if (
    [
      RUN_PANEL_IDS.prCreation,
      RUN_NAV_TARGET_IDS.prTechnicalReadiness,
    ].includes(targetId as never)
  ) {
    return "pr";
  }

  if (
    [
      RUN_PANEL_IDS.mergeControls,
      RUN_PANEL_IDS.deploymentGates,
      RUN_PANEL_IDS.deploymentExecution,
      RUN_PANEL_IDS.deploymentHealth,
      RUN_PANEL_IDS.deploymentHealthPolicy,
      RUN_PANEL_IDS.releaseChecklist,
      RUN_PANEL_IDS.releaseSignoff,
      RUN_GROUP_ANCHOR_IDS.pr_release,
    ].includes(targetId as never) ||
    targetId.startsWith("hard-release-gate-details-")
  ) {
    return "release";
  }

  if (
    [
      RUN_PANEL_IDS.auditTimeline,
      RUN_GROUP_ANCHOR_IDS.technical_audit,
      RUN_NAV_TARGET_IDS.auditChainDiagnostics,
    ].includes(targetId as never)
  ) {
    return "audit";
  }

  return null;
}

export function resolveRunWorkspaceViewForHash(
  hash: string | null | undefined,
): RunWorkspaceViewId | null {
  if (!hash) return null;
  return getRunWorkspaceViewForTarget(hash.replace(/^#/, ""));
}
