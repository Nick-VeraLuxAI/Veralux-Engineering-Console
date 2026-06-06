import { beforeEach, describe, expect, it, vi } from "vitest";
import * as veraHandoffTask from "./vera-handoff-task";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task-types";
import { assessVeraExecutionStartReadiness } from "./vera-execution-start-readiness";

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
  const tmpDb = `/tmp/engineer-console-vera-start-ready-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  initializeEngineerConsoleDatabase();
}

function createApprovedVeraRun() {
  const task = createTask({
    title: "[Vera WO] start readiness",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: process.cwd(),
  });
  const run = createRun(task.id);
  updateRun(run.id, {
    currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionApprovalRequested: true,
      requestedBy: "operator@test",
      requestedAt: new Date().toISOString(),
    }),
  });
  return { task, run: updateRun(run.id, {})! };
}

describe("assessVeraExecutionStartReadiness", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    seedDb();
  });

  it("accepts a valid approval-requested Vera run", () => {
    const { run } = createApprovedVeraRun();
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(true);
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
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
  });

  it("rejects missing veraExecutionApprovalRequested", () => {
    const task = createTask({
      title: "[Vera WO] no approval flag",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "draft",
      targetRepoPath: process.cwd(),
    });
    const run = createRun(task.id);
    updateRun(run.id, {
      currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
      governanceNotes: JSON.stringify({
        veraHandoff: true,
        veraWorkOrderId: VERA_WORK_ORDER_ID,
      }),
    });
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
  });

  it("rejects wrong currentStep", () => {
    const { run } = createApprovedVeraRun();
    updateRun(run.id, { currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP });
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
  });

  it("rejects startedAt not null", () => {
    const { run } = createApprovedVeraRun();
    updateRun(run.id, { startedAt: new Date().toISOString() });
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
  });

  it("rejects branchName not null", () => {
    const { run } = createApprovedVeraRun();
    updateRun(run.id, { branchName: "feature/test" });
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
  });

  it("rejects already-started run via start marker", () => {
    const { run } = createApprovedVeraRun();
    updateRun(run.id, {
      governanceNotes: JSON.stringify({
        veraHandoff: true,
        veraWorkOrderId: VERA_WORK_ORDER_ID,
        veraExecutionApprovalRequested: true,
        veraExecutionStartRequested: true,
      }),
    });
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
  });

  it("rejects missing repo binding", () => {
    const { run, task } = createApprovedVeraRun();
    const analysis = veraHandoffTask.analyzeVeraHandoffTask(task);
    vi.spyOn(veraHandoffTask, "analyzeVeraHandoffTask").mockReturnValue({
      ...analysis,
      repoBindingPresent: false,
      repoPath: null,
      safeToPrepareRun: false,
      blockers: [...analysis.blockers, "Valid repo binding is required."],
    });

    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.safeToStartVeraExecution).toBe(false);
    expect(readiness.checks.find((check) => check.id === "repo_binding")?.ok).toBe(false);
    vi.restoreAllMocks();
  });

  it("extracts Vera work order ID deterministically", () => {
    const { run } = createApprovedVeraRun();
    const readiness = assessVeraExecutionStartReadiness(run.id);
    expect(readiness.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);
  });
});
