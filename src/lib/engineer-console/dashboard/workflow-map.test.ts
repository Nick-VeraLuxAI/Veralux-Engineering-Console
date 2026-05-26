import { describe, expect, it } from "vitest";
import type { RegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";
import type { DashboardSetupSummary } from "@/lib/engineer-console/setup/build-setup-readiness-summary";
import type { EngineeringTask } from "@/lib/engineer-console/types";
import type { OperatorQueueItem } from "@/lib/engineer-console/run-ux/operator-queue";
import { buildEngineeringWorkflowMapData } from "./workflow-map";

function buildSetupSummary(
  overrides: Partial<DashboardSetupSummary> = {},
): DashboardSetupSummary {
  return {
    readiness: {
      items: [
        {
          id: "registered-repos",
          title: "Registered repositories",
          status: "ready",
          detail: "1 registered repo available.",
        },
        {
          id: "verified-repo",
          title: "Verified repository",
          status: "ready",
          detail: "1 verified repo available.",
        },
        {
          id: "file-index",
          title: "File index",
          status: "ready",
          detail: "File index exists.",
        },
        {
          id: "code-index",
          title: "Code index",
          status: "ready",
          detail: "Code index exists.",
        },
        {
          id: "compatibility",
          title: "Compatibility analysis",
          status: "ready",
          detail: "Compatibility analysis is available.",
        },
      ],
    },
    showStagingHelper: false,
    smokeRepoExamplePath: "/tmp/smoke-repo",
    stagingTaskPreset: {
      title: "Create README staging verification note",
      description: "staging preset",
      priority: "normal",
    },
    repoRoots: [],
    ...overrides,
  };
}

function buildRepo(overrides: Partial<RegisteredRepo> = {}): RegisteredRepo {
  return {
    id: "repo-1",
    name: "repo",
    path: "/tmp/repo",
    description: "Repo",
    language: "TypeScript",
    verificationStatus: "ok",
    verificationMessage: "ok",
    verifiedAt: "2026-05-25T00:00:00.000Z",
    fileCount: 10,
    indexedAt: "2026-05-25T00:00:00.000Z",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

function buildTask(overrides: Partial<EngineeringTask> = {}): EngineeringTask {
  return {
    id: "task-1",
    title: "Example task",
    description: "Example task",
    targetRepoPath: "/tmp/repo",
    registeredRepoId: "repo-1",
    status: "draft",
    priority: "normal",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

function buildQueueItem(overrides: Partial<OperatorQueueItem> = {}): OperatorQueueItem {
  return {
    id: "run:run-1",
    kind: "run",
    title: "Example task",
    taskId: "task-1",
    taskTitle: "Example task",
    runId: "run-1",
    runIdShort: "run-1",
    repoLabel: "repo",
    currentStageLabel: "Approval",
    nextAction: "Open the run and review approval state.",
    status: "waiting_for_approval",
    blockerCount: 0,
    warningCount: 1,
    href: "/engineer/runs/run-1",
    secondaryHref: "/engineer/tasks/task-1",
    secondaryLabel: "Open task",
    priority: 100,
    bucket: "ready_for_approval",
    reason: "This run is ready for a human approval decision.",
    sortKey: "0001",
    lastUpdatedAt: "2026-05-25T00:00:00.000Z",
    lastUpdatedLabel: "Updated",
    ageLabel: "5m",
    isStale: false,
    staleKind: null,
    staleReason: null,
    staleSuggestedAction: null,
    whyItMatters: "Approval blocks PR work.",
    handoffNote: null,
    canStartRun: false,
    ...overrides,
  };
}

describe("buildEngineeringWorkflowMapData", () => {
  it("shows register repo as the primary action in a new-user state", () => {
    const data = buildEngineeringWorkflowMapData({
      tasks: [],
      repos: [],
      queueItems: [],
      setup: buildSetupSummary({
        readiness: {
          items: [
            {
              id: "registered-repos",
              title: "Registered repositories",
              status: "missing",
              detail: "No repositories are registered yet.",
              nextAction: "Register a repo first.",
            },
          ],
        },
      }),
    });

    expect(data.primaryChip.label).toBe("Register repo");
    expect(data.defaultSelectedNodeId).toBe("repository");
    expect(data.nodes.find((node) => node.id === "repository")?.state).toBe("Needs repo");
  });

  it("shows create task when a repo exists but no task exists", () => {
    const data = buildEngineeringWorkflowMapData({
      tasks: [],
      repos: [buildRepo()],
      queueItems: [],
      setup: buildSetupSummary(),
    });

    expect(data.primaryChip.label).toBe("Create task");
    expect(data.nodes.find((node) => node.id === "task")?.state).toBe("No task");
  });

  it("routes a waiting approval run into review-focused status", () => {
    const data = buildEngineeringWorkflowMapData({
      tasks: [buildTask()],
      repos: [buildRepo()],
      queueItems: [buildQueueItem()],
      setup: buildSetupSummary(),
    });

    expect(data.primaryChip.label).toBe("Run waiting approval");
    expect(data.defaultSelectedNodeId).toBe("review");
    expect(data.nodes.find((node) => node.id === "review")?.state).toBe("Required");
    expect(data.nodes.find((node) => node.id === "audit")?.state).toBe("Recording");
    expect(data.issues[0]?.nodeId).toBe("review");
    expect(data.featuredIssue?.title).toBe("Run waiting approval");
  });

  it("shows PR retry availability as a PR issue", () => {
    const data = buildEngineeringWorkflowMapData({
      tasks: [buildTask()],
      repos: [buildRepo()],
      queueItems: [
        buildQueueItem({
          currentStageLabel: "PR",
          bucket: "ready_for_release",
          status: "failed",
          nextAction: "Review the PR state card before retrying draft PR creation.",
          reason: "A draft PR retry is available without creating a duplicate commit.",
          href: "/engineer/runs/run-1",
        }),
      ],
      setup: buildSetupSummary(),
    });

    expect(data.nodes.find((node) => node.id === "pr")?.state).toBe("Failed");
    expect(data.issues[0]?.title).toBe("PR retry available");
  });
});
