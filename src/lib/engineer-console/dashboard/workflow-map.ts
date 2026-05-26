import type { RegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";
import type { DashboardSetupSummary } from "@/lib/engineer-console/setup/build-setup-readiness-summary";
import type { SetupReadinessItem } from "@/lib/engineer-console/setup/setup-ux";
import type { EngineeringTask } from "@/lib/engineer-console/types";
import type { OperatorQueueItem } from "@/lib/engineer-console/run-ux/operator-queue";

export type WorkflowMapNodeId =
  | "setup"
  | "repository"
  | "task"
  | "run"
  | "review"
  | "pr"
  | "release"
  | "audit";

export type WorkflowMapTone = "ready" | "warning" | "blocked" | "inactive" | "active" | "completed";

export interface WorkflowMapNode {
  id: WorkflowMapNodeId;
  label: string;
  tone: WorkflowMapTone;
  state: string;
  shortState: string;
  issueCount: number;
}

export interface WorkflowNodeInspectorData {
  nodeId: WorkflowMapNodeId;
  title: string;
  state: string;
  whyItMatters: string;
  nextAction: string;
  blockers: string[];
  warnings: string[];
  primaryActionLabel: string;
  primaryActionHref: string;
  secondaryActionLabel: string;
  secondaryActionHref: string;
}

export interface DashboardWorkflowIssue {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  destination: string;
  suggestedAction: string;
  href: string;
  nodeId: WorkflowMapNodeId;
  sortPriority: number;
}

export interface DashboardActivityItem {
  id: string;
  label: string;
  detail: string;
  href: string;
}

export interface DashboardPrimaryActionChip {
  label: string;
  detail: string;
  href: string;
}

export interface WorkflowDockLink {
  id: string;
  label: string;
  href: string;
}

export interface EngineeringWorkflowMapData {
  nodes: WorkflowMapNode[];
  inspectors: Record<WorkflowMapNodeId, WorkflowNodeInspectorData>;
  issues: DashboardWorkflowIssue[];
  featuredIssue: DashboardWorkflowIssue | null;
  activityItems: DashboardActivityItem[];
  primaryChip: DashboardPrimaryActionChip;
  defaultSelectedNodeId: WorkflowMapNodeId;
  dockLinks: WorkflowDockLink[];
}

function buildDashboardDetailHref(section: "setup" | "queue" | "tasks"): string {
  return `/engineer?details=${section}#dashboard-details-${section}`;
}

function sortQueueItems(items: OperatorQueueItem[]): OperatorQueueItem[] {
  return [...items].sort(
    (left, right) => right.priority - left.priority || left.sortKey.localeCompare(right.sortKey),
  );
}

function toneForSetupStatus(status: SetupReadinessItem["status"]): WorkflowMapTone {
  switch (status) {
    case "missing":
      return "blocked";
    case "warning":
      return "warning";
    case "not_checked":
      return "inactive";
    default:
      return "ready";
  }
}

function toneForQueueItem(item: OperatorQueueItem | null): WorkflowMapTone {
  if (!item) return "inactive";
  if (item.bucket === "blocked_failed" || item.status === "failed") return "blocked";
  if (item.bucket === "ready_for_approval" || item.bucket === "ready_for_release") return "warning";
  if (item.bucket === "recently_completed") return "completed";
  return "active";
}

function worstTone(tones: WorkflowMapTone[]): WorkflowMapTone {
  if (tones.includes("blocked")) return "blocked";
  if (tones.includes("warning")) return "warning";
  if (tones.includes("inactive")) return "inactive";
  return "ready";
}

function runReviewHref(item: OperatorQueueItem | null): string {
  return item?.runId ? `/engineer/runs/${item.runId}#approval` : buildDashboardDetailHref("queue");
}

function runPrHref(item: OperatorQueueItem | null): string {
  return item?.runId ? `/engineer/runs/${item.runId}#pr-creation` : buildDashboardDetailHref("queue");
}

function runReleaseHref(item: OperatorQueueItem | null): string {
  return item?.runId ? `/engineer/runs/${item.runId}#release-signoff` : buildDashboardDetailHref("queue");
}

function runAuditHref(item: OperatorQueueItem | null): string {
  return item?.runId ? `/engineer/runs/${item.runId}#audit-timeline` : buildDashboardDetailHref("queue");
}

function mapQueueIssue(
  item: OperatorQueueItem,
  nodeId: WorkflowMapNodeId,
  destination: string,
  href: string,
): DashboardWorkflowIssue {
  const severity: DashboardWorkflowIssue["severity"] =
    item.bucket === "blocked_failed"
      ? "critical"
      : item.bucket === "ready_for_approval" || item.bucket === "ready_for_release"
        ? "warning"
        : "info";

  let title = item.title;
  if (item.kind === "setup") {
    title = item.title;
  } else if (item.bucket === "ready_for_approval") {
    title = "Run waiting approval";
  } else if (item.bucket === "blocked_failed") {
    title = item.status === "failed" ? "Run blocked" : "Workflow blocked";
  } else if (item.bucket === "ready_for_release" && /retry/i.test(item.reason)) {
    title = "PR retry available";
  } else if (item.bucket === "ready_for_release") {
    title = "Release follow-up required";
  } else if (item.kind === "task") {
    title = "Task has no run";
  }

  return {
    id: `queue-issue:${item.id}`,
    severity,
    title,
    message: item.reason,
    destination,
    suggestedAction: item.nextAction,
    href,
    nodeId,
    sortPriority: item.priority,
  };
}

export function buildEngineeringWorkflowMapData(input: {
  tasks: EngineeringTask[];
  repos: RegisteredRepo[];
  queueItems: OperatorQueueItem[];
  setup: DashboardSetupSummary;
}): EngineeringWorkflowMapData {
  const sortedQueueItems = sortQueueItems(input.queueItems);
  const runItems = sortedQueueItems.filter((item) => item.kind === "run");
  const taskOnlyItems = sortedQueueItems.filter((item) => item.kind === "task");
  const setupItems = input.setup.readiness.items;
  const setupAttention = setupItems.filter((item) => item.status !== "ready");
  const repoSetupItems = setupItems.filter((item) =>
    ["registered-repos", "verified-repo", "file-index", "code-index", "compatibility"].includes(
      item.id,
    ),
  );
  const repoAttention = repoSetupItems.filter((item) => item.status !== "ready");
  const latestRunItem = runItems[0] ?? null;
  const reviewItem =
    runItems.find(
      (item) =>
        item.bucket === "ready_for_approval" ||
        item.currentStageLabel.toLowerCase().includes("approval") ||
        item.currentStageLabel.toLowerCase().includes("review"),
    ) ?? null;
  const prItem =
    runItems.find(
      (item) =>
        item.currentStageLabel.toLowerCase() === "pr" ||
        /draft pr|pr /i.test(item.nextAction) ||
        /draft pr|pr /i.test(item.reason),
    ) ?? null;
  const releaseItem =
    runItems.find(
      (item) =>
        ["merge", "deployment", "checklist", "sign-off", "release"].some((label) =>
          item.currentStageLabel.toLowerCase().includes(label),
        ) ||
        /release|deployment|sign-off|merge/i.test(item.reason),
    ) ?? null;
  const completedItem = runItems.find((item) => item.bucket === "recently_completed") ?? null;
  const auditItem =
    runItems.find(
      (item) =>
        /audit/i.test(item.reason) ||
        /audit/i.test(item.nextAction) ||
        item.currentStageLabel.toLowerCase().includes("audit"),
    ) ?? null;

  const setupTone = worstTone(setupAttention.map((item) => toneForSetupStatus(item.status)));
  const setupNode: WorkflowMapNode = {
    id: "setup",
    label: "Setup",
    tone: setupTone,
    state:
      setupAttention.length === 0
        ? "Ready"
        : setupTone === "blocked"
          ? "Needs setup"
          : "Warning",
    shortState:
      setupAttention.length === 0
        ? "Setup checks are green"
        : `${setupAttention.length} item${setupAttention.length === 1 ? "" : "s"} need review`,
    issueCount: setupAttention.length,
  };

  const repositoryNode: WorkflowMapNode = {
    id: "repository",
    label: "Repository",
    tone:
      input.repos.length === 0
        ? "blocked"
        : repoAttention.length > 0
          ? worstTone(repoAttention.map((item) => toneForSetupStatus(item.status)))
          : "ready",
    state:
      input.repos.length === 0
        ? "Needs repo"
        : repoAttention.length > 0
          ? repoAttention.some((item) => item.id === "compatibility")
            ? "Needs analysis"
            : "Needs index"
          : "Registered",
    shortState:
      input.repos.length === 0
        ? "No repositories registered"
        : `${input.repos.length} repo${input.repos.length === 1 ? "" : "s"} in the console`,
    issueCount: input.repos.length === 0 ? 1 : repoAttention.length,
  };

  const taskNode: WorkflowMapNode = {
    id: "task",
    label: "Task",
    tone:
      input.tasks.length === 0
        ? "inactive"
        : taskOnlyItems.length > 0
          ? "warning"
          : "ready",
    state:
      input.tasks.length === 0
        ? "No task"
        : taskOnlyItems.length > 0
          ? "Needs run"
          : "Created",
    shortState:
      input.tasks.length === 0
        ? "Create the first task"
        : `${input.tasks.length} task${input.tasks.length === 1 ? "" : "s"} available`,
    issueCount: taskOnlyItems.length,
  };

  const runNode: WorkflowMapNode = {
    id: "run",
    label: "Run",
    tone: toneForQueueItem(latestRunItem),
    state:
      latestRunItem === null
        ? "No run"
        : latestRunItem.status === "waiting_for_approval"
          ? "Waiting approval"
          : latestRunItem.status === "failed"
            ? "Failed"
            : latestRunItem.bucket === "recently_completed"
              ? "Completed"
              : latestRunItem.currentStageLabel,
    shortState:
      latestRunItem === null
        ? "Start the first run"
        : `${latestRunItem.blockerCount} blocker(s), ${latestRunItem.warningCount} warning(s)`,
    issueCount: latestRunItem && latestRunItem.bucket !== "recently_completed" ? 1 : 0,
  };

  const reviewNode: WorkflowMapNode = {
    id: "review",
    label: "Review",
    tone:
      reviewItem !== null
        ? toneForQueueItem(reviewItem)
        : completedItem
          ? "ready"
          : "inactive",
    state:
      reviewItem === null
        ? completedItem
          ? "Complete"
          : "Not ready"
        : reviewItem.bucket === "blocked_failed"
          ? "Blocked"
          : "Required",
    shortState:
      reviewItem === null
        ? completedItem
          ? "No review work is pending"
          : "Review opens after run work starts"
        : reviewItem.nextAction,
    issueCount: reviewItem ? 1 : 0,
  };

  const prNode: WorkflowMapNode = {
    id: "pr",
    label: "PR",
    tone:
      prItem !== null
        ? toneForQueueItem(prItem)
        : releaseItem !== null
          ? "ready"
          : "inactive",
    state:
      prItem === null
        ? releaseItem !== null
          ? "Existing PR"
          : "Not ready"
        : prItem.status === "failed" || /retry/i.test(prItem.reason)
          ? "Failed"
          : "Ready",
    shortState:
      prItem === null
        ? releaseItem !== null
          ? "A PR already exists for the active run"
          : "PR work starts after review"
        : prItem.nextAction,
    issueCount: prItem ? 1 : 0,
  };

  const releaseNode: WorkflowMapNode = {
    id: "release",
    label: "Release",
    tone:
      releaseItem !== null
        ? toneForQueueItem(releaseItem)
        : completedItem !== null
          ? "ready"
          : "inactive",
    state:
      releaseItem === null
        ? completedItem !== null
          ? "Signed off"
          : "Not started"
        : releaseItem.bucket === "blocked_failed"
          ? "Blocked"
          : "Ready",
    shortState:
      releaseItem === null
        ? completedItem !== null
          ? "Latest governed run completed"
          : "Release opens after PR work"
        : releaseItem.nextAction,
    issueCount: releaseItem ? 1 : 0,
  };

  const auditNode: WorkflowMapNode = {
    id: "audit",
    label: "Audit",
    tone:
      auditItem !== null
        ? toneForQueueItem(auditItem)
        : latestRunItem !== null
          ? latestRunItem.bucket === "recently_completed"
            ? "completed"
            : "active"
          : "inactive",
    state:
      auditItem !== null
        ? "Attention"
        : latestRunItem !== null
          ? latestRunItem.bucket === "recently_completed"
            ? "Recorded"
            : "Recording"
          : "No audit",
    shortState:
      auditItem !== null
        ? auditItem.reason
        : latestRunItem !== null
          ? latestRunItem.bucket === "recently_completed"
            ? "History is preserved for review"
            : "The run is writing its audit trail"
          : "Audit opens after the first run",
    issueCount: auditItem ? 1 : 0,
  };

  const nodes: WorkflowMapNode[] = [
    setupNode,
    repositoryNode,
    taskNode,
    runNode,
    reviewNode,
    prNode,
    releaseNode,
    auditNode,
  ];

  const inspectors: Record<WorkflowMapNodeId, WorkflowNodeInspectorData> = {
    setup: {
      nodeId: "setup",
      title: "Setup",
      state: setupNode.state,
      whyItMatters:
        "Setup determines whether operators can safely use governed runs, staging checks, and production-facing controls.",
      nextAction:
        setupAttention[0]?.nextAction ??
        "Review setup readiness and only expand the staging helper when you need the detailed checklist.",
      blockers: setupAttention
        .filter((item) => item.status === "missing")
        .map((item) => `${item.title}: ${item.detail}`),
      warnings: setupAttention
        .filter((item) => item.status !== "missing")
        .map((item) => `${item.title}: ${item.detail}`),
      primaryActionLabel: "View setup",
      primaryActionHref: buildDashboardDetailHref("setup"),
      secondaryActionLabel: input.setup.showStagingHelper ? "View staging helper" : "Open runbook",
      secondaryActionHref: input.setup.showStagingHelper
        ? buildDashboardDetailHref("setup")
        : buildDashboardDetailHref("setup"),
    },
    repository: {
      nodeId: "repository",
      title: "Repository",
      state: repositoryNode.state,
      whyItMatters:
        "Repositories are the gateway into indexing, compatibility analysis, task creation, and governed runs.",
      nextAction:
        input.repos.length === 0
          ? "Register the first repository."
          : repoAttention[0]?.nextAction ?? "View repositories and confirm the active repo is verified and indexed.",
      blockers:
        input.repos.length === 0
          ? ["No repositories are registered yet."]
          : repoAttention
              .filter((item) => item.status === "missing")
              .map((item) => `${item.title}: ${item.detail}`),
      warnings: repoAttention
        .filter((item) => item.status !== "missing")
        .map((item) => `${item.title}: ${item.detail}`),
      primaryActionLabel: input.repos.length === 0 ? "Register repo" : "View repositories",
      primaryActionHref: "/engineer/repos",
      secondaryActionLabel: "View compatibility",
      secondaryActionHref: "/engineer/compatibility",
    },
    task: {
      nodeId: "task",
      title: "Task",
      state: taskNode.state,
      whyItMatters:
        "Tasks define the operator’s intent before any branch, run, or approval workflow begins.",
      nextAction:
        input.tasks.length === 0
          ? "Open task details and create the first task."
          : taskOnlyItems[0]?.nextAction ?? "Review the active task list.",
      blockers: [],
      warnings:
        taskOnlyItems[0] ? [`${taskOnlyItems[0].title}: ${taskOnlyItems[0].reason}`] : [],
      primaryActionLabel: input.tasks.length === 0 ? "Create task" : "View tasks",
      primaryActionHref:
        input.tasks.length === 0 ? buildDashboardDetailHref("tasks") : buildDashboardDetailHref("tasks"),
      secondaryActionLabel: input.tasks.length === 0 ? "View repositories" : "Open latest task",
      secondaryActionHref:
        input.tasks.length === 0
          ? "/engineer/repos"
          : taskOnlyItems[0]?.href ?? `/engineer/tasks/${input.tasks[0]?.id ?? ""}`,
    },
    run: {
      nodeId: "run",
      title: "Run",
      state: runNode.state,
      whyItMatters:
        "Runs are the governed execution record for planning, review, PR creation, release gates, and audit history.",
      nextAction:
        latestRunItem?.nextAction ??
        (input.tasks.length > 0 ? "Open task details and start the first run." : "Create a task first."),
      blockers:
        latestRunItem && latestRunItem.blockerCount > 0
          ? [`${latestRunItem.blockerCount} blocker(s) are attached to the latest run.`]
          : [],
      warnings:
        latestRunItem && latestRunItem.warningCount > 0
          ? [`${latestRunItem.warningCount} warning(s) are attached to the latest run.`]
          : [],
      primaryActionLabel:
        latestRunItem?.runId ? "Open run" : input.tasks.length > 0 ? "Start run" : "Create task",
      primaryActionHref:
        latestRunItem?.href ??
        (input.tasks.length > 0 ? buildDashboardDetailHref("tasks") : buildDashboardDetailHref("tasks")),
      secondaryActionLabel: "View details",
      secondaryActionHref: buildDashboardDetailHref("queue"),
    },
    review: {
      nodeId: "review",
      title: "Review",
      state: reviewNode.state,
      whyItMatters:
        "Review is where evidence, replay, policy, and human approval keep governance visible before PR and release work continues.",
      nextAction:
        reviewItem?.nextAction ??
        (completedItem ? "Review the last completed run if you need governance context." : "Start a run to reach review."),
      blockers:
        reviewItem?.bucket === "blocked_failed" ? [reviewItem.reason] : [],
      warnings:
        reviewItem && reviewItem.bucket !== "blocked_failed" ? [reviewItem.reason] : [],
      primaryActionLabel: reviewItem?.runId ? "Open review" : "Open run",
      primaryActionHref: runReviewHref(reviewItem ?? latestRunItem),
      secondaryActionLabel: "View queue details",
      secondaryActionHref: buildDashboardDetailHref("queue"),
    },
    pr: {
      nodeId: "pr",
      title: "PR",
      state: prNode.state,
      whyItMatters:
        "The PR step governs draft PR creation, retry state, and the handoff into merge and release work.",
      nextAction:
        prItem?.nextAction ??
        (releaseItem ? "Open the existing run to inspect PR state before continuing release work." : "Complete review before PR work starts."),
      blockers:
        prItem?.bucket === "blocked_failed" || prItem?.status === "failed" ? [prItem.reason] : [],
      warnings:
        prItem && (prItem.bucket !== "blocked_failed" && prItem.status !== "failed")
          ? [prItem.reason]
          : releaseItem
            ? ["A PR likely already exists for the active release follow-up."]
            : [],
      primaryActionLabel: prItem ? "Open PR workspace" : releaseItem ? "Open run" : "Open review",
      primaryActionHref: prItem ? runPrHref(prItem) : releaseItem ? releaseItem.href : runReviewHref(reviewItem),
      secondaryActionLabel: "View queue details",
      secondaryActionHref: buildDashboardDetailHref("queue"),
    },
    release: {
      nodeId: "release",
      title: "Release",
      state: releaseNode.state,
      whyItMatters:
        "Release pulls together merge, deployment, checklist, and sign-off without weakening any existing governance controls.",
      nextAction:
        releaseItem?.nextAction ??
        (completedItem ? "Inspect the latest completed run if you need release context." : "Finish PR work before release starts."),
      blockers:
        releaseItem?.bucket === "blocked_failed" ? [releaseItem.reason] : [],
      warnings:
        releaseItem && releaseItem.bucket !== "blocked_failed" ? [releaseItem.reason] : [],
      primaryActionLabel:
        releaseItem?.runId ? "Open release" : completedItem?.runId ? "Open run" : "View queue details",
      primaryActionHref: releaseItem ? runReleaseHref(releaseItem) : completedItem ? completedItem.href : buildDashboardDetailHref("queue"),
      secondaryActionLabel: "View queue details",
      secondaryActionHref: buildDashboardDetailHref("queue"),
    },
    audit: {
      nodeId: "audit",
      title: "Audit",
      state: auditNode.state,
      whyItMatters:
        "Audit preserves the governed technical record for what changed, what was reviewed, and how the workflow reached its current state.",
      nextAction:
        auditItem?.nextAction ??
        (latestRunItem
          ? "Open the audit view when you need the technical record, evidence continuity, or chain diagnostics."
          : "Start a run to generate audit history."),
      blockers: auditItem?.bucket === "blocked_failed" ? [auditItem.reason] : [],
      warnings:
        auditItem && auditItem.bucket !== "blocked_failed"
          ? [auditItem.reason]
          : latestRunItem
            ? ["Audit detail is available on the run workspace when you need the technical record."]
            : [],
      primaryActionLabel: latestRunItem?.runId ? "Open audit" : "Open run",
      primaryActionHref: runAuditHref(auditItem ?? latestRunItem),
      secondaryActionLabel: "View queue details",
      secondaryActionHref: buildDashboardDetailHref("queue"),
    },
  };

  const issues: DashboardWorkflowIssue[] = [
    ...sortedQueueItems.slice(0, 8).map((item) => {
      if (item.kind === "setup") {
        return mapQueueIssue(item, item.href.includes("repos") ? "repository" : "setup", item.repoLabel, item.href);
      }
      if (item.kind === "task") {
        return mapQueueIssue(item, "task", "Task details", buildDashboardDetailHref("tasks"));
      }
      if (item.bucket === "ready_for_approval") {
        return mapQueueIssue(item, "review", "Run review", runReviewHref(item));
      }
      if (
        item.currentStageLabel.toLowerCase() === "pr" ||
        /draft pr|pr /i.test(item.reason) ||
        /draft pr|pr /i.test(item.nextAction)
      ) {
        return mapQueueIssue(item, "pr", "Run PR workspace", runPrHref(item));
      }
      if (
        ["merge", "deployment", "checklist", "sign-off", "release"].some((label) =>
          item.currentStageLabel.toLowerCase().includes(label),
        )
      ) {
        return mapQueueIssue(item, "release", "Run release workspace", runReleaseHref(item));
      }
      if (
        /audit/i.test(item.reason) ||
        /audit/i.test(item.nextAction) ||
        item.currentStageLabel.toLowerCase().includes("audit")
      ) {
        return mapQueueIssue(item, "audit", "Run audit workspace", runAuditHref(item));
      }
      return mapQueueIssue(item, "run", item.runId ? "Run detail" : "Task detail", item.href);
    }),
  ]
    .sort((left, right) => right.sortPriority - left.sortPriority || left.title.localeCompare(right.title))
    .slice(0, 8);
  const featuredIssue = issues[0] ?? null;

  const primaryChip: DashboardPrimaryActionChip =
    featuredIssue != null
      ? {
          label: featuredIssue.title,
          detail: featuredIssue.suggestedAction,
          href: featuredIssue.href,
        }
      : input.repos.length === 0
        ? {
            label: "Register repo",
            detail: "The workflow map is waiting for its first repository.",
            href: "/engineer/repos",
          }
        : input.tasks.length === 0
          ? {
              label: "Create task",
              detail: "A verified repository exists, but no task has been created yet.",
              href: buildDashboardDetailHref("tasks"),
            }
          : latestRunItem == null
            ? {
                label: "Start run",
                detail: "Tasks exist, but no governed run has started yet.",
                href: buildDashboardDetailHref("tasks"),
              }
            : {
                label: "Open run",
                detail: latestRunItem.nextAction,
                href: latestRunItem.href,
              };

  const defaultSelectedNodeId =
    featuredIssue?.nodeId ?? (input.repos.length === 0 ? "repository" : latestRunItem ? "run" : "task");

  const activityItems: DashboardActivityItem[] = [
    latestRunItem
      ? {
          id: "latest-run",
          label: "Recent run update",
          detail: `${latestRunItem.title} • ${latestRunItem.currentStageLabel} • ${latestRunItem.nextAction}`,
          href: latestRunItem.href,
        }
      : null,
    prItem || releaseItem
      ? {
          id: "latest-pr-release",
          label: "Recent PR / release event",
          detail: `${(prItem ?? releaseItem)!.title} • ${(prItem ?? releaseItem)!.reason}`,
          href: prItem ? runPrHref(prItem) : runReleaseHref(releaseItem),
        }
      : null,
    setupAttention[0]
      ? {
          id: "setup-warning",
          label: "Latest setup warning",
          detail: `${setupAttention[0].title} • ${setupAttention[0].detail}`,
          href: buildDashboardDetailHref("setup"),
        }
      : null,
    completedItem
      ? {
          id: "latest-completed",
          label: "Latest completed item",
          detail: `${completedItem.title} • ${completedItem.reason}`,
          href: completedItem.href,
        }
      : null,
  ].filter((item): item is DashboardActivityItem => item !== null);

  const dockLinks: WorkflowDockLink[] = [
    { id: "workflow", label: "Workflows", href: "/engineer" },
    { id: "repos", label: "Repos", href: "/engineer/repos" },
    { id: "tasks", label: "Tasks", href: buildDashboardDetailHref("tasks") },
    { id: "runs", label: "Runs", href: latestRunItem?.href ?? buildDashboardDetailHref("queue") },
    { id: "reviews", label: "Reviews", href: runReviewHref(reviewItem ?? latestRunItem) },
    { id: "release", label: "Release", href: runReleaseHref(releaseItem ?? latestRunItem) },
    { id: "activity", label: "Activity", href: "/engineer?details=activity#canvas-detail-drawer" },
    { id: "docs", label: "Docs", href: "/engineer?details=docs#canvas-detail-drawer" },
  ];

  return {
    nodes,
    inspectors,
    issues,
    featuredIssue,
    activityItems,
    primaryChip,
    defaultSelectedNodeId,
    dockLinks,
  };
}
