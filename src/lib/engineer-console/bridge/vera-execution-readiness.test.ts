import { beforeEach, describe, expect, it } from "vitest";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task-types";
import { assessVeraExecutionReadiness } from "./vera-execution-readiness";

const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";

function buildVeraHandoffDescription(): string {
  return [
    VERA_HANDOFF_DESCRIPTION_HEADING,
    "",
    "- **Source:** veralux-os",
    "- **Requested by:** operator@test",
    "",
    "### Instructions",
    "",
    VERA_HANDOFF_NON_EXECUTION_NOTE,
    "",
    `Source work order ID: ${VERA_WORK_ORDER_ID}`,
    "",
    "### Business context",
    "",
    "```json",
    JSON.stringify({ module: `vera-work-order:${VERA_WORK_ORDER_ID}` }, null, 2),
    "```",
  ].join("\n");
}

function seedDb(): void {
  const tmpDb = `/tmp/engineer-console-vera-readiness-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  initializeEngineerConsoleDatabase();
}

function createVeraPreparedRun() {
  const task = createTask({
    title: "[Vera WO] readiness",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: process.cwd(),
  });
  const run = createRun(task.id);
  const updated = updateRun(run.id, {
    currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      preparedBy: "operator@test",
      preparedAt: new Date().toISOString(),
    }),
  });
  return { task, run: updated! };
}

describe("assessVeraExecutionReadiness", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    seedDb();
  });

  it("accepts a valid Vera prepared run", () => {
    const { run } = createVeraPreparedRun();
    const readiness = assessVeraExecutionReadiness(run.id);
    expect(readiness.safeToRequestExecutionApproval).toBe(true);
    expect(readiness.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);
  });

  it("rejects non-Vera run", () => {
    const task = createTask({
      title: "Regular",
      description: "Not Vera",
      priority: "normal",
      status: "draft",
      targetRepoPath: process.cwd(),
    });
    const run = createRun(task.id);
    const readiness = assessVeraExecutionReadiness(run.id);
    expect(readiness.safeToRequestExecutionApproval).toBe(false);
  });

  it("rejects missing governance notes", () => {
    const task = createTask({
      title: "[Vera WO] missing notes",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "draft",
      targetRepoPath: process.cwd(),
    });
    const run = createRun(task.id);
    updateRun(run.id, { currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP });
    const readiness = assessVeraExecutionReadiness(run.id);
    expect(readiness.safeToRequestExecutionApproval).toBe(false);
    expect(readiness.reasons.some((r) => r.includes("veraHandoff"))).toBe(true);
  });

  it("rejects wrong currentStep", () => {
    const { run } = createVeraPreparedRun();
    updateRun(run.id, { currentStep: "pending" });
    const readiness = assessVeraExecutionReadiness(run.id);
    expect(readiness.safeToRequestExecutionApproval).toBe(false);
  });

  it("rejects startedAt not null", () => {
    const { run } = createVeraPreparedRun();
    updateRun(run.id, { startedAt: new Date().toISOString() });
    const readiness = assessVeraExecutionReadiness(run.id);
    expect(readiness.safeToRequestExecutionApproval).toBe(false);
  });

  it("rejects branchName not null", () => {
    const { run } = createVeraPreparedRun();
    updateRun(run.id, { branchName: "feature/test" });
    const readiness = assessVeraExecutionReadiness(run.id);
    expect(readiness.safeToRequestExecutionApproval).toBe(false);
  });
});
