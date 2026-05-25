import { describe, expect, it } from "vitest";
import type { EngineeringRun, EngineeringTask } from "@/lib/engineer-console/types";
import type { RunCommandCenterState, RunWorkflowSummary } from "./run-ux-types";
import {
  DEFAULT_OPERATOR_QUEUE_PRESET,
  buildOperatorQueueSections,
  queuePresetToQueryValue,
  resolveOperatorQueuePresetId,
  hasOperatorQueueActionableItems,
} from "./operator-queue-view";
import {
  assessOperatorQueueSnapshot,
  type OperatorQueueItem,
  type OperatorQueueSnapshot,
} from "./operator-queue";

function createTask(overrides: Partial<EngineeringTask> = {}): EngineeringTask {
  return {
    id: "task-1",
    title: "Queue test task",
    description: "Queue test description",
    targetRepoPath: "/tmp/repo",
    registeredRepoId: null,
    status: "draft",
    priority: "normal",
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

function createRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "run-12345678",
    taskId: "task-1",
    status: "pending",
    branchName: "feature/queue-test",
    currentStep: "worker_plan",
    modelRole: "engineer",
    retryCount: 0,
    startedAt: "2026-05-01T11:00:00.000Z",
    completedAt: null,
    agentMessage: null,
    riskLevel: "medium",
    governanceNotes: null,
    ...overrides,
  };
}

function createSummary(overrides: Partial<RunWorkflowSummary> = {}): RunWorkflowSummary {
  return {
    run: {
      id: "run-12345678",
      status: "pending",
      currentStep: "worker_plan",
      branchName: "feature/queue-test",
      riskLevel: "medium",
      agentMessage: null,
    },
    task: {
      id: "task-1",
      title: "Queue test task",
      description: "Queue test description",
    },
    workerPlan: {
      hasDraft: false,
      exists: true,
      validationStatus: "valid",
      executionStatus: "executed",
      validationErrorCount: 0,
      validationWarningCount: 0,
      executionErrorCount: 0,
      executedOperationCount: 1,
      changedFileCount: 1,
      showReadmeSmokeHelper: false,
    },
    qualityGates: {
      count: 1,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      failedCommands: [],
      skippedCommands: [],
    },
    approval: {
      reportAvailable: true,
      canApprove: false,
      governanceIssues: [],
      recommendedNextAction: null,
      decisionCount: 0,
      latestDecision: null,
    },
    evidence: {
      exists: true,
      updatedAt: "2026-05-01T11:05:00.000Z",
    },
    replay: {
      exists: true,
      status: "passed",
      warningCount: 0,
      failedCount: 0,
    },
    policy: {
      exists: true,
      status: "passed",
      blockers: [],
      warnings: [],
      reviewRequired: [],
      recommendedNextAction: null,
    },
    review: {
      stageCount: 0,
      requiredCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      skippedCount: 0,
    },
    pr: {
      attemptCount: 0,
      latestStatus: null,
      latestPrUrl: null,
      latestPrNumber: null,
      latestCommitShaPrefix: null,
      latestReadinessStatus: null,
      latestReadinessBlockers: [],
      latestReadinessWarnings: [],
      latestErrorMessage: null,
    },
    merge: {
      attemptCount: 0,
      latestStatus: null,
      latestMergeShaPrefix: null,
    },
    deployment: {
      approvalCount: 0,
      latestApprovalDecision: null,
      latestExecutionStatus: null,
      latestHealthCheckStatus: null,
      latestHealthPolicyStatus: null,
      latestHealthPolicyRecommendedAction: null,
      latestHealthPolicyBlockers: [],
      latestHealthPolicyWarnings: [],
    },
    release: {
      checklistRecorded: false,
      checklistStatus: null,
      checklistBlockers: [],
      checklistNeedsAttention: [],
      checklistRecommendedAction: null,
      signoffCount: 0,
      latestSignoffDecision: null,
      latestSignoffRationale: null,
    },
    hardGates: {
      enabled: true,
      mergeStatus: null,
      mergeBlockers: [],
      deploymentApprovalStatus: null,
      deploymentApprovalBlockers: [],
      deploymentExecutionStatus: null,
      deploymentExecutionBlockers: [],
      signoffCompletedStatus: null,
      signoffCompletedBlockers: [],
      signoffExceptionsStatus: null,
      signoffExceptionsBlockers: [],
    },
    audit: {
      eventCount: 1,
      chainOk: true,
      chainFailureCount: 0,
      chainFailures: [],
    },
    ...overrides,
  };
}

function createGuidance(overrides: Partial<RunCommandCenterState> = {}): RunCommandCenterState {
  return {
    currentStageId: "worker_plan",
    currentStageLabel: "Worker plan",
    nextRecommendedAction: "Review and execute the worker plan.",
    explanation: "Queue test explanation.",
    primaryAction: {
      label: "Open worker plan",
      href: "#worker-plan",
    },
    blockers: [],
    warnings: [],
    secondaryActions: [],
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<OperatorQueueSnapshot> = {}): OperatorQueueSnapshot {
  const task = overrides.task ?? createTask();
  const latestRun = overrides.latestRun ?? createRun();
  return {
    task,
    repoLabel: "/tmp/repo",
    latestRun,
    summary: createSummary(),
    guidance: createGuidance(),
    blockerCount: 0,
    warningCount: 0,
    href: `/engineer/runs/${latestRun.id}`,
    secondaryHref: `/engineer/tasks/${task.id}`,
    secondaryLabel: "Open task",
    lastUpdatedAt: latestRun.startedAt ?? task.updatedAt,
    lastUpdatedLabel: "Started",
    canStartRun: false,
    ...overrides,
  };
}

describe("assessOperatorQueueSnapshot", () => {
  it("buckets failed runs ahead of completed runs", () => {
    const failed = assessOperatorQueueSnapshot(
      createSnapshot({
        latestRun: createRun({ status: "failed" }),
        summary: createSummary({
          run: {
            id: "run-12345678",
            status: "failed",
            currentStep: "worker_plan",
            branchName: "feature/queue-test",
            riskLevel: "medium",
            agentMessage: null,
          },
        }),
      }),
    );
    const completed = assessOperatorQueueSnapshot(
      createSnapshot({
        latestRun: createRun({
          status: "completed",
          completedAt: "2026-05-01T12:00:00.000Z",
        }),
        summary: createSummary({
          run: {
            id: "run-12345678",
            status: "completed",
            currentStep: "signoff",
            branchName: "feature/queue-test",
            riskLevel: "medium",
            agentMessage: null,
          },
        }),
      }),
    );

    expect(failed.bucket).toBe("blocked_failed");
    expect(completed.bucket).toBe("recently_completed");
    expect(failed.priority).toBeGreaterThan(completed.priority);
  });

  it("places waiting approval runs into the approval bucket", () => {
    const assessment = assessOperatorQueueSnapshot(
      createSnapshot({
        latestRun: createRun({ status: "waiting_for_approval" }),
        summary: createSummary({
          approval: {
            reportAvailable: true,
            canApprove: true,
            governanceIssues: [],
            recommendedNextAction: "Review approval report",
            decisionCount: 0,
            latestDecision: null,
          },
          run: {
            id: "run-12345678",
            status: "waiting_for_approval",
            currentStep: "approval",
            branchName: "feature/queue-test",
            riskLevel: "medium",
            agentMessage: null,
          },
        }),
        guidance: createGuidance({
          currentStageId: "approval",
          currentStageLabel: "Approval",
          nextRecommendedAction: "Review approval report and take a human decision.",
        }),
      }),
    );

    expect(assessment.bucket).toBe("ready_for_approval");
  });

  it("places PR retry work into the PR / release bucket", () => {
    const assessment = assessOperatorQueueSnapshot(
      createSnapshot({
        summary: createSummary({
          pr: {
            attemptCount: 1,
            latestStatus: "failed",
            latestPrUrl: null,
            latestPrNumber: null,
            latestCommitShaPrefix: "abc123def456",
            latestReadinessStatus: "warning",
            latestReadinessBlockers: [],
            latestReadinessWarnings: [],
            latestErrorMessage: "network timeout",
          },
        }),
        guidance: createGuidance({
          currentStageId: "pr",
          currentStageLabel: "PR",
          nextRecommendedAction: "Retry draft PR creation.",
        }),
      }),
    );

    expect(assessment.bucket).toBe("ready_for_release");
    expect(assessment.reason).toContain("retry");
  });
});

describe("operator queue sections", () => {
  const items: OperatorQueueItem[] = [
    {
      id: "run:blocked",
      kind: "run",
      title: "Blocked task",
      taskId: "task-1",
      taskTitle: "Blocked task",
      runId: "run-blocked",
      runIdShort: "run-bloc",
      repoLabel: "/tmp/repo",
      currentStageLabel: "Approval",
      nextAction: "Resolve blockers.",
      status: "failed",
      blockerCount: 2,
      warningCount: 0,
      href: "/engineer/runs/run-blocked",
      priority: 100,
      bucket: "blocked_failed",
      reason: "Blocked",
      sortKey: "0001",
      lastUpdatedAt: "2026-05-01T11:00:00.000Z",
      lastUpdatedLabel: "Started",
      ageLabel: "1h old",
      isStale: false,
      staleKind: null,
      staleReason: null,
      staleSuggestedAction: null,
      whyItMatters: "Blocked work needs review.",
      handoffNote: "Review Current Action before taking over.",
      canStartRun: false,
    },
    {
      id: "run:approval",
      kind: "run",
      title: "Approval task",
      taskId: "task-2",
      taskTitle: "Approval task",
      runId: "run-approval",
      runIdShort: "run-appr",
      repoLabel: "/tmp/repo",
      currentStageLabel: "Approval",
      nextAction: "Review approval report.",
      status: "waiting_for_approval",
      blockerCount: 0,
      warningCount: 0,
      href: "/engineer/runs/run-approval",
      priority: 90,
      bucket: "ready_for_approval",
      reason: "Approval",
      sortKey: "0002",
      lastUpdatedAt: "2026-05-01T11:05:00.000Z",
      lastUpdatedLabel: "Started",
      ageLabel: "55m old",
      isStale: false,
      staleKind: null,
      staleReason: null,
      staleSuggestedAction: null,
      whyItMatters: "Approval work needs a human decision.",
      handoffNote: "Review the approval report before taking over.",
      canStartRun: false,
    },
    {
      id: "run:completed",
      kind: "run",
      title: "Completed task",
      taskId: "task-3",
      taskTitle: "Completed task",
      runId: "run-completed",
      runIdShort: "run-comp",
      repoLabel: "/tmp/repo",
      currentStageLabel: "Sign-off",
      nextAction: "No action.",
      status: "completed",
      blockerCount: 0,
      warningCount: 0,
      href: "/engineer/runs/run-completed",
      priority: 10,
      bucket: "recently_completed",
      reason: "Completed",
      sortKey: "0003",
      lastUpdatedAt: "2026-05-01T12:00:00.000Z",
      lastUpdatedLabel: "Completed",
      ageLabel: null,
      isStale: false,
      staleKind: null,
      staleReason: null,
      staleSuggestedAction: null,
      whyItMatters: "Completed work stays visible for audit continuity.",
      handoffNote: "Review the run history before resuming follow-up.",
      canStartRun: true,
    },
  ];

  it("filters approval work into the approval preset", () => {
    const sections = buildOperatorQueueSections(items, "approval_queue");
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("ready_for_approval");
    expect(sections[0]?.items[0]?.href).toBe("/engineer/runs/run-approval");
  });

  it("keeps completed work lower priority and non-actionable", () => {
    const sections = buildOperatorQueueSections(items, "recently_completed");
    expect(sections[0]?.id).toBe("recently_completed");
    expect(hasOperatorQueueActionableItems([items[2]!])).toBe(false);
  });

  it("maps stale preset to stale queue items only", () => {
    const staleSections = buildOperatorQueueSections(
      [
        {
          ...items[0]!,
          id: "run:stale-blocked",
          isStale: true,
          staleKind: "stale_failed_run",
          staleReason: "The failed run has been unresolved for over 12 hours.",
          staleSuggestedAction: "Review the run before retrying.",
        },
      ],
      "stale_runs",
    );

    expect(staleSections).toHaveLength(1);
    expect(staleSections[0]?.items[0]?.id).toBe("run:stale-blocked");
  });

  it("resolves queue query params safely", () => {
    expect(resolveOperatorQueuePresetId("blocked")).toBe("blocked_failed");
    expect(resolveOperatorQueuePresetId("approval")).toBe("approval_queue");
    expect(resolveOperatorQueuePresetId("unknown")).toBe(DEFAULT_OPERATOR_QUEUE_PRESET);
    expect(queuePresetToQueryValue("pr_release_queue")).toBe("release");
  });
});
