import { describe, expect, it } from "vitest";
import {
  isTerminalRunStatus,
  planFleetCommence,
  publicRunFailureDetail,
} from "./fleet-commence";
import {
  publicFleetStatusLine,
  type FleetJobRef,
  type MultitaskFleetItem,
} from "./multitask-fleet-intent";

function task(title: string): MultitaskFleetItem {
  return {
    type: "commission_task",
    title,
    objective: title,
    success: null,
    constraints: null,
    repoId: "repo-1",
  };
}

describe("fleet commence", () => {
  it("runs every job when start-all is on, even if one already has a failed task", () => {
    const items = [task("Event log"), task("Memory records"), task("Retrieval"), task("Context"), task("Agnostic")];
    const jobs: FleetJobRef[] = [
      {
        itemIndex: 4,
        kind: "task",
        title: "Agnostic",
        taskId: "task-5",
        runId: "run-5",
      },
    ];
    const plan = planFleetCommence({ items, jobs, startAllRuns: true });
    expect(plan.createIndexes).toEqual([0, 1, 2, 3]);
    expect(plan.startIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(plan.buttonLabel).toBe("Run all 5 jobs");
    expect(plan.showCommence).toBe(true);
  });

  it("does not drop later jobs just because an earlier task already exists", () => {
    const items = [task("One"), task("Two")];
    const plan = planFleetCommence({
      items,
      jobs: [{ itemIndex: 0, kind: "task", title: "One", taskId: "t1" }],
      startAllRuns: false,
    });
    expect(plan.createIndexes).toEqual([1]);
    expect(plan.startIndexes).toEqual([]);
    expect(plan.buttonLabel).toBe("Create 1 task");
  });

  it("exposes a leak-safe failure reason instead of a bare failed label", () => {
    expect(
      publicRunFailureDetail({
        agentMessage: "Worker died at /home/ndesantis/secret on localhost:8081",
        runStatus: "failed",
      }),
    ).toMatch(/that folder|\.\.\./);
    expect(
      publicRunFailureDetail({
        agentMessage: "Quality gates failed: npx vitest run",
        runStatus: "failed",
      }),
    ).toContain("Quality gates failed");
    expect(publicRunFailureDetail({ runStatus: "failed" })).toMatch(/Open the run/);
    expect(
      publicFleetStatusLine({
        title: "Model-agnostic design",
        taskStatus: "failed",
        runStatus: "failed",
        failureDetail: "Quality gates failed: npx vitest run",
      }),
    ).toBe("Model-agnostic design · run failed · Quality gates failed: npx vitest run");
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("preparing_workspace")).toBe(false);
  });
});
