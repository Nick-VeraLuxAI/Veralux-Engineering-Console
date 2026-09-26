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

export type RunOperatorTabId = "job" | "later";

export const RUN_OPERATOR_TABS: Array<{
  id: RunOperatorTabId;
  label: string;
  description: string;
  views: RunWorkspaceViewId[];
}> = [
  {
    id: "job",
    label: "This job",
    description: "Read what happened and take the one next step. Nothing else is required here.",
    views: ["overview", "work_plan", "review"],
  },
  {
    id: "later",
    label: "Later",
    description: "Share, go live, and history. Open this only after the job itself is settled.",
    views: ["pr", "release", "audit"],
  },
];

export const RUN_WORKSPACE_VIEWS: RunWorkspaceViewDefinition[] = [
  {
    id: "overview",
    label: "This job",
    description: "What this job is doing, and the one next step for you.",
  },
  {
    id: "work_plan",
    label: "This job",
    description: "What changed, and whether the automatic checks passed.",
  },
  {
    id: "review",
    label: "This job",
    description: "Approve, ask for a fix, or stop. Evidence lives here if you need it.",
  },
  {
    id: "pr",
    label: "Later",
    description: "Turn the change into a pull request when you are ready to share it.",
  },
  {
    id: "release",
    label: "Later",
    description: "Merge, deploy, and sign off after the change is shared.",
  },
  {
    id: "audit",
    label: "Later",
    description: "A record of what happened. Open this only if you need the paper trail.",
  },
];

export function operatorTabForView(viewId: RunWorkspaceViewId): RunOperatorTabId {
  return viewId === "pr" || viewId === "release" || viewId === "audit" ? "later" : "job";
}

export function defaultViewForOperatorTab(tab: RunOperatorTabId): RunWorkspaceViewId {
  return tab === "later" ? "pr" : "overview";
}

const OPERATOR_RUN_STATUS: Record<string, string> = {
  queued: "Waiting to start",
  running: "Working",
  waiting_for_approval: "Waiting for your decision",
  approved: "Approved",
  completed: "Finished",
  failed: "Stopped — needs a fix",
  exhausted: "Stopped — retries used up",
  aborted: "Stopped",
};

export function operatorRunStatusLabel(status: string): string {
  const key = status.trim().toLowerCase().replace(/\s+/g, "_");
  return OPERATOR_RUN_STATUS[key] ?? status.replace(/_/g, " ");
}

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
      RUN_PANEL_IDS.seniorReviewAdvisory,
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
