import { describe, expect, it } from "vitest";
import { getEngineerConsoleDb } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { buildRunEvidenceSummaryForBridge } from "./run-evidence-summary";

describe("buildRunEvidenceSummaryForBridge", () => {
  it("returns null for unknown run", async () => {
    const tmpDb = `/tmp/engineer-console-evidence-${Date.now()}.db`;
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    initializeEngineerConsoleDatabase();

    const summary = await buildRunEvidenceSummaryForBridge("missing-run-id");
    expect(summary).toBeNull();
  });

  it("returns safe summary for a draft task/run", async () => {
    const tmpDb = `/tmp/engineer-console-evidence-${Date.now()}-2.db`;
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    initializeEngineerConsoleDatabase();

    const task = createTask({
      title: "Bridge evidence task",
      targetRepoPath: process.cwd(),
      status: "draft",
    });
    const run = createRun(task.id);

    const summary = await buildRunEvidenceSummaryForBridge(run.id);
    expect(summary).not.toBeNull();
    expect(summary?.runId).toBe(run.id);
    expect(summary?.taskId).toBe(task.id);
    expect(summary?.repo).toBe(process.cwd());
    expect(summary?.consoleRunPath).toBe(`/engineer/runs/${run.id}`);
    expect(summary?.testStatus).toBe("not_run");
    expect(summary?.buildStatus).toBe("not_run");

    getEngineerConsoleDb().close();
  });
});
