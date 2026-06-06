import { beforeEach, describe, expect, it } from "vitest";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createTask } from "../task-manager/task-manager";
import type { EngineeringTask } from "../types";
import {
  analyzeVeraHandoffTask,
  extractVeraWorkOrderIdFromDescription,
  isVeraLuxOsHandoffTask,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
} from "./vera-handoff-task";

const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";

function buildVeraHandoffDescription(workOrderId = VERA_WORK_ORDER_ID): string {
  return [
    VERA_HANDOFF_DESCRIPTION_HEADING,
    "",
    "- **Source:** veralux-os",
    "- **Requested by:** operator@test",
    "- **Request type:** code",
    "- **Priority:** normal",
    "",
    "### Instructions",
    "",
    "## Vera work order engineering handoff",
    "",
    VERA_HANDOFF_NON_EXECUTION_NOTE,
    "",
    `Source work order ID: ${workOrderId}`,
    "",
    "### Business context",
    "",
    "```json",
    JSON.stringify({ module: `vera-work-order:${workOrderId}` }, null, 2),
    "```",
  ].join("\n");
}

function seedTask(overrides: Partial<EngineeringTask> = {}): EngineeringTask {
  const tmpDb = `/tmp/engineer-console-vera-handoff-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  initializeEngineerConsoleDatabase();

  return createTask({
    title: "[Vera WO] Smoke handoff",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: process.cwd(),
    ...overrides,
  });
}

describe("vera handoff detection", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
  });

  it("detects a valid VeraLux OS handoff task", () => {
    const task = seedTask();
    expect(isVeraLuxOsHandoffTask(task)).toBe(true);
    const analysis = analyzeVeraHandoffTask(task);
    expect(analysis.isVeraLuxOsHandoffTask).toBe(true);
    expect(analysis.source).toBe("veralux-os");
    expect(analysis.safeToPrepareRun).toBe(true);
  });

  it("extracts Vera work order ID from businessContext.module", () => {
    const description = buildVeraHandoffDescription(VERA_WORK_ORDER_ID);
    expect(extractVeraWorkOrderIdFromDescription(description)).toBe(VERA_WORK_ORDER_ID);
  });

  it("rejects non-Vera tasks", () => {
    const task = seedTask({
      description: "## Regular task\n\nNo Vera markers.",
    });
    const analysis = analyzeVeraHandoffTask(task);
    expect(analysis.isVeraLuxOsHandoffTask).toBe(false);
    expect(analysis.safeToPrepareRun).toBe(false);
  });

  it("blocks readiness when non-execution note is missing", () => {
    const task = seedTask({
      description: buildVeraHandoffDescription().replace(VERA_HANDOFF_NON_EXECUTION_NOTE, ""),
    });
    const analysis = analyzeVeraHandoffTask(task);
    expect(analysis.nonExecutionNotePresent).toBe(false);
    expect(analysis.safeToPrepareRun).toBe(false);
    expect(analysis.blockers.some((b) => b.includes("Non-execution"))).toBe(true);
  });
});
