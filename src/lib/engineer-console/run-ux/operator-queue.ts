import { getRegisteredRepoById } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  listRunsForTask,
} from "@/lib/engineer-console/run-manager/run-manager";
import type { ApprovalReport, EngineeringRun, EngineeringTask } from "@/lib/engineer-console/types";
import { resolveTaskTargetRepoPath } from "@/lib/engineer-console/repo-intelligence/task-repo-path";
import { getWorkerPlanChangedFilesScope } from "@/lib/engineer-console/worker-plan/worker-plan-manager";
import { getChangedFiles } from "@/lib/engineer-console/workspace/git-workspace";
import { buildRunWorkflowSummary } from "./build-run-workflow-summary";
import { deriveRunCommandCenterState } from "./derive-run-ux";
import type { RunCommandCenterState, RunWorkflowSummary } from "./run-ux-types";
import type { DashboardSetupSummary } from "../setup/build-setup-readiness-summary";

export type OperatorQueueBucketId =
  | "needs_action"
  | "blocked_failed"
  | "ready_for_approval"
  | "ready_for_release"
  | "recently_completed"
  | "setup_attention";

export type OperatorQueueFilterId =
  | "all"
  | "needs_action"
  | "blocked"
  | "approval"
  | "pr_release"
  | "completed";

export interface OperatorQueueItem {
  id: string;
  kind: "task" | "run" | "setup";
  title: string;
  taskId: string | null;
  taskTitle: string;
  runId: string | null;
  runIdShort: string | null;
  repoLabel: string;
  currentStageLabel: string;
  nextAction: string;
  status: string;
  blockerCount: number;
  warningCount: number;
  href: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  priority: number;
  bucket: OperatorQueueBucketId;
  reason: string;
  sortKey: string;
  lastUpdatedAt: string;
  lastUpdatedLabel: string;
  canStartRun: boolean;
  pathHint?: string;
}

export interface OperatorQueueSection {
  id: OperatorQueueBucketId;
  title: string;
  items: OperatorQueueItem[];
}

export interface OperatorQueueDashboardData {
  items: OperatorQueueItem[];
  taskCount: number;
  taskCountWithoutRuns: number;
}

export interface OperatorQueueSnapshot {
  task: EngineeringTask;
  repoLabel: string;
  latestRun: EngineeringRun | null;
  summary: RunWorkflowSummary | null;
  guidance: RunCommandCenterState | null;
  blockerCount: number;
  warningCount: number;
  href: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  lastUpdatedAt: string;
  lastUpdatedLabel: string;
  canStartRun: boolean;
}

function shortId(id: string | null): string | null {
  return id ? id.slice(0, 8) : null;
}

function isoTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function timestampLabel(input: { task: EngineeringTask; run: EngineeringRun | null }): {
  at: string;
  label: string;
} {
  if (input.run?.completedAt) {
    return { at: input.run.completedAt, label: "Completed" };
  }
  if (input.run?.startedAt) {
    return { at: input.run.startedAt, label: "Started" };
  }
  return { at: input.task.updatedAt, label: "Updated" };
}

function repoLabelForTask(task: EngineeringTask): string {
  if (task.registeredRepoId) {
    const repo = getRegisteredRepoById(task.registeredRepoId);
    if (repo) {
      return `${repo.name} (${repo.path})`;
    }
  }
  return task.targetRepoPath;
}

function buildTaskOnlyQueueItem(task: EngineeringTask, repoLabel: string): OperatorQueueItem {
  const timestamp = timestampLabel({ task, run: null });
  const priority = 60_000 + isoTime(timestamp.at);
  return {
    id: `task:${task.id}`,
    kind: "task",
    title: task.title,
    taskId: task.id,
    taskTitle: task.title,
    runId: null,
    runIdShort: null,
    repoLabel,
    currentStageLabel: "Task",
    nextAction: "Start run.",
    status: task.status,
    blockerCount: 0,
    warningCount: 0,
    href: `/engineer/tasks/${task.id}`,
    priority,
    bucket: "needs_action",
    reason: "This task does not have a run yet.",
    sortKey: `${String(999_999_999_999 - isoTime(timestamp.at)).padStart(12, "0")}:${task.id}`,
    lastUpdatedAt: timestamp.at,
    lastUpdatedLabel: timestamp.label,
    canStartRun: true,
  };
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

export function assessOperatorQueueSnapshot(input: OperatorQueueSnapshot): Pick<
  OperatorQueueItem,
  "priority" | "bucket" | "nextAction" | "reason" | "href" | "sortKey" | "canStartRun"
> {
  const { task, latestRun, summary, guidance, blockerCount, warningCount, href, lastUpdatedAt } = input;
  const timestampScore = isoTime(lastUpdatedAt);

  if (!latestRun || !summary || !guidance) {
    return {
      priority: 60_000 + timestampScore,
      bucket: "needs_action",
      nextAction: "Start run.",
      reason: "This task does not have a run yet.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${task.id}`,
      canStartRun: true,
    };
  }

  if (latestRun.status === "failed") {
    return {
      priority: 100_000 + timestampScore,
      bucket: "blocked_failed",
      nextAction: guidance.nextRecommendedAction,
      reason: "The latest run failed and needs operator review.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (!summary.audit.chainOk) {
    return {
      priority: 98_000 + timestampScore,
      bucket: "blocked_failed",
      nextAction: guidance.nextRecommendedAction,
      reason: "Audit chain verification failed.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (hasHardGateBlockers(summary)) {
    return {
      priority: 96_000 + timestampScore,
      bucket: "blocked_failed",
      nextAction: guidance.nextRecommendedAction,
      reason: "Hard release gates are blocking downstream work.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (latestRun.status === "completed") {
    return {
      priority: 10_000 + timestampScore,
      bucket: "recently_completed",
      nextAction: guidance.nextRecommendedAction,
      reason: warningCount > 0
        ? "Completed, but warnings remain visible for review."
        : "Completed and no immediate operator action is required.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: true,
    };
  }

  if (guidance.currentStageId === "approval" && blockerCount > 0) {
    return {
      priority: 94_000 + timestampScore,
      bucket: "blocked_failed",
      nextAction: guidance.nextRecommendedAction,
      reason: "Approval is blocked with actionable follow-up.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (
    latestRun.status === "waiting_for_approval" &&
    summary.approval.canApprove &&
    summary.review.pendingCount === 0 &&
    summary.review.rejectedCount === 0
  ) {
    return {
      priority: 86_000 + timestampScore,
      bucket: "ready_for_approval",
      nextAction: guidance.nextRecommendedAction,
      reason: "This run is ready for a human approval decision.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (
    summary.policy.status === "requires_review" ||
    summary.review.pendingCount > 0 ||
    summary.review.rejectedCount > 0
  ) {
    return {
      priority: 82_000 + timestampScore,
      bucket: "ready_for_approval",
      nextAction: guidance.nextRecommendedAction,
      reason: "Review work is still required before approval can finish.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (summary.pr.latestStatus === "failed" && summary.pr.latestCommitShaPrefix) {
    return {
      priority: 80_000 + timestampScore,
      bucket: "ready_for_release",
      nextAction: guidance.nextRecommendedAction,
      reason: "A draft PR retry is available without creating a duplicate commit.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (
    summary.approval.latestDecision === "approved" ||
    summary.pr.latestStatus === "pr_created" ||
    summary.merge.latestStatus === "merged" ||
    summary.deployment.approvalCount > 0 ||
    summary.release.checklistRecorded ||
    summary.release.signoffCount > 0
  ) {
    return {
      priority: 76_000 + timestampScore,
      bucket: "ready_for_release",
      nextAction: guidance.nextRecommendedAction,
      reason: "This run has entered the PR, release, deployment, or sign-off flow.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (!summary.evidence.exists || !summary.replay.exists || !summary.policy.exists) {
    return {
      priority: 62_000 + timestampScore,
      bucket: "needs_action",
      nextAction: guidance.nextRecommendedAction,
      reason: "Evidence, replay, or policy steps are still missing.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  if (guidance.currentStageId === "quality_gates" || guidance.currentStageId === "worker_plan") {
    return {
      priority: 58_000 + timestampScore,
      bucket: "needs_action",
      nextAction: guidance.nextRecommendedAction,
      reason: "The run is still in active preparation or validation work.",
      href,
      sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
      canStartRun: false,
    };
  }

  return {
    priority: 48_000 + timestampScore,
    bucket: "needs_action",
    nextAction: guidance.nextRecommendedAction,
    reason: "This run still has an operator-visible next step.",
    href,
    sortKey: `${String(999_999_999_999 - timestampScore).padStart(12, "0")}:${latestRun.id}`,
    canStartRun: false,
  };
}

export async function buildOperatorQueueSnapshot(
  task: EngineeringTask,
  run: EngineeringRun | null,
): Promise<OperatorQueueSnapshot> {
  const repoLabel = repoLabelForTask(task);

  if (!run) {
    const taskOnly = buildTaskOnlyQueueItem(task, repoLabel);
    return {
      task,
      repoLabel,
      latestRun: null,
      summary: null,
      guidance: null,
      blockerCount: 0,
      warningCount: 0,
      href: taskOnly.href,
      lastUpdatedAt: taskOnly.lastUpdatedAt,
      lastUpdatedLabel: taskOnly.lastUpdatedLabel,
      canStartRun: true,
    };
  }

  let changedFiles: string[] = [];
  try {
    const repoPath = resolveTaskTargetRepoPath(task);
    const scope = getWorkerPlanChangedFilesScope(run.id);
    changedFiles = await getChangedFiles(repoPath, scope ?? {});
  } catch {
    changedFiles = [];
  }

  const qualityGates = getQualityGateResultsForRun(run.id);
  const reportJson = getApprovalReportJson(run.id);
  const approvalReport: ApprovalReport | null = reportJson
    ? (JSON.parse(reportJson) as ApprovalReport)
    : null;
  const summary = buildRunWorkflowSummary({
    run,
    task,
    qualityGates,
    approvalReport,
    changedFiles,
  });
  const guidance = deriveRunCommandCenterState(summary);
  const timestamp = timestampLabel({ task, run });

  return {
    task,
    repoLabel,
    latestRun: run,
    summary,
    guidance,
    blockerCount: guidance.blockers.length,
    warningCount: guidance.warnings.length,
    href: `/engineer/runs/${run.id}`,
    secondaryHref: `/engineer/tasks/${task.id}`,
    secondaryLabel: "Open task",
    lastUpdatedAt: timestamp.at,
    lastUpdatedLabel: timestamp.label,
    canStartRun: run.status === "completed",
  };
}

export async function buildDashboardOperatorQueueData(
  tasks: EngineeringTask[],
): Promise<OperatorQueueDashboardData> {
  const snapshots = await Promise.all(
    tasks.map(async (task) => {
      const latestRun = listRunsForTask(task.id)[0] ?? null;
      return buildOperatorQueueSnapshot(task, latestRun);
    }),
  );

  const items = snapshots.map((snapshot) => {
    if (!snapshot.latestRun || !snapshot.summary || !snapshot.guidance) {
      return buildTaskOnlyQueueItem(snapshot.task, snapshot.repoLabel);
    }

    const assessment = assessOperatorQueueSnapshot(snapshot);
    return {
      id: `run:${snapshot.latestRun.id}`,
      kind: "run" as const,
      title: snapshot.task.title,
      taskId: snapshot.task.id,
      taskTitle: snapshot.task.title,
      runId: snapshot.latestRun.id,
      runIdShort: shortId(snapshot.latestRun.id),
      repoLabel: snapshot.repoLabel,
      currentStageLabel: snapshot.guidance.currentStageLabel,
      nextAction: assessment.nextAction,
      status: snapshot.latestRun.status,
      blockerCount: snapshot.blockerCount,
      warningCount: snapshot.warningCount,
      href: assessment.href,
      secondaryHref: snapshot.secondaryHref,
      secondaryLabel: snapshot.secondaryLabel,
      priority: assessment.priority,
      bucket: assessment.bucket,
      reason: assessment.reason,
      sortKey: assessment.sortKey,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      lastUpdatedLabel: snapshot.lastUpdatedLabel,
      canStartRun: assessment.canStartRun,
    };
  });

  return {
    items,
    taskCount: tasks.length,
    taskCountWithoutRuns: items.filter((item) => item.kind === "task").length,
  };
}

export function buildSetupAttentionQueueItems(
  setup: DashboardSetupSummary,
): OperatorQueueItem[] {
  const items = setup.readiness.items
    .filter((item) => item.status !== "ready")
    .map<OperatorQueueItem>((item, index) => {
      const priority =
        item.status === "missing" ? 65_000 - index : item.status === "warning" ? 55_000 - index : 45_000 - index;
      return {
        id: `setup:${item.id}`,
        kind: "setup",
        title: item.title,
        taskId: null,
        taskTitle: item.title,
        runId: null,
        runIdShort: null,
        repoLabel: "Dashboard setup",
        currentStageLabel: "Setup",
        nextAction: item.nextAction ?? "Review the setup panel.",
        status: item.status,
        blockerCount: item.status === "missing" ? 1 : 0,
        warningCount: item.status === "warning" || item.status === "not_checked" ? 1 : 0,
        href:
          item.id === "compatibility"
            ? "/engineer/compatibility"
            : item.id === "registered-repos" ||
                item.id === "verified-repo" ||
                item.id === "file-index" ||
                item.id === "code-index" ||
                item.id === "repo-roots"
              ? "/engineer/repos"
              : "/engineer",
        priority,
        bucket: "setup_attention",
        reason: item.detail,
        sortKey: `${String(999_999_999_999 - priority).padStart(12, "0")}:${item.id}`,
        lastUpdatedAt: new Date(0).toISOString(),
        lastUpdatedLabel: "Manual",
        canStartRun: false,
      };
    });

  if (setup.showStagingHelper) {
    items.push({
      id: "setup:staging-report",
      kind: "setup",
      title: "Complete staging report",
      taskId: null,
      taskTitle: "Complete staging report",
      runId: null,
      runIdShort: null,
      repoLabel: "Staging workflow",
      currentStageLabel: "Staging",
      nextAction: "Update docs/staging-dry-run-report.md after the smoke run and manual checks complete.",
      status: "not_checked",
      blockerCount: 0,
      warningCount: 1,
      href: "/engineer",
      priority: 44_000,
      bucket: "setup_attention",
      reason: "The staging report is still a manual operator step.",
      sortKey: `${String(999_999_999_999 - 44_000).padStart(12, "0")}:staging-report`,
      lastUpdatedAt: new Date(0).toISOString(),
      lastUpdatedLabel: "Manual",
      canStartRun: false,
      pathHint: "docs/staging-dry-run-report.md",
    });
  }

  return items;
}
