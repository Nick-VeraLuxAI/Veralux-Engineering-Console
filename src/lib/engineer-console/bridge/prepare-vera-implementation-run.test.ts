import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getRunById } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  findVeraPreparedRunForTask,
  prepareVeraImplementationRun,
  VeraImplementationRunPrepareError,
  VERA_PREPARED_RUN_NON_EXECUTION_NOTE,
} from "./prepare-vera-implementation-run";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task";

const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";

function buildVeraHandoffDescription(): string {
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
  const tmpDb = `/tmp/engineer-console-vera-prepare-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  initializeEngineerConsoleDatabase();
}

function createVeraDraftTask() {
  return createTask({
    title: "[Vera WO] Prepare run smoke",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: process.cwd(),
  });
}

function confirmInput() {
  return { confirmationText: VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE };
}

describe("prepareVeraImplementationRun", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    seedDb();
  });

  it("prepares one safe Vera implementation run", () => {
    const task = createVeraDraftTask();
    const result = prepareVeraImplementationRun({
      taskId: task.id,
      ...confirmInput(),
      preparedBy: "operator@test",
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.run.status).toBe("pending");
    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_RUN_PREPARED_STEP);
    expect(result.run.startedAt).toBeNull();
    expect(result.nonExecutionNote).toBe(VERA_PREPARED_RUN_NON_EXECUTION_NOTE);
    expect(result.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);

    const events = listAuditEventsForRun(result.run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_RUN_PREPARED);
  });

  it("rejects non-Vera tasks", () => {
    const task = createTask({
      title: "Regular task",
      description: "Not a Vera handoff.",
      priority: "normal",
      status: "draft",
      targetRepoPath: process.cwd(),
    });

    expect(() =>
      prepareVeraImplementationRun({
        taskId: task.id,
        ...confirmInput(),
        preparedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationRunPrepareError);
  });

  it("rejects missing confirmation phrase", () => {
    const task = createVeraDraftTask();
    expect(() =>
      prepareVeraImplementationRun({
        taskId: task.id,
        confirmationText: "WRONG PHRASE",
        preparedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationRunPrepareError);
  });

  it("rejects non-draft tasks", () => {
    const queuedTask = createTask({
      title: "[Vera WO] queued",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "queued",
      targetRepoPath: process.cwd(),
    });

    expect(() =>
      prepareVeraImplementationRun({
        taskId: queuedTask.id,
        ...confirmInput(),
        preparedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationRunPrepareError);
  });

  it("returns existing prepared run on duplicate request", () => {
    const task = createVeraDraftTask();
    const first = prepareVeraImplementationRun({
      taskId: task.id,
      ...confirmInput(),
      preparedBy: "operator@test",
    });
    const second = prepareVeraImplementationRun({
      taskId: task.id,
      ...confirmInput(),
      preparedBy: "operator@test",
    });

    expect(second.alreadyExisted).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(findVeraPreparedRunForTask(task.id)?.id).toBe(first.run.id);
  });
});

describe("Vera implementation run preparation safety", () => {
  it("does not import worker dispatch, shell, worktree, patch, commit, PR, merge, or deploy code", () => {
    const root = process.cwd();
    const files = [
      "src/lib/engineer-console/bridge/prepare-vera-implementation-run.ts",
      "src/app/api/engineer-console/tasks/[id]/prepare-vera-implementation-run/route.ts",
    ];
    const forbidden = [
      /executeRun\s*\(/,
      /run-orchestrator/,
      /worker-plan-orchestrator/,
      /prepareAndExportHermesRunForEngineeringRun/,
      /child_process/,
      /\bspawn\s*\(/,
      /\bexec\s*\(/,
      /createWorktree|worktree/i,
      /applyHermesPatch/,
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /controlled-gh-merge/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
    ];

    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
      expect(source).toContain("prepareVeraImplementationRun");
    }
  });

  it("creates metadata-only run without startedAt", () => {
    resetEngineerConsoleDbForTests();
    seedDb();
    const task = createVeraDraftTask();
    const result = prepareVeraImplementationRun({
      taskId: task.id,
      ...confirmInput(),
      preparedBy: "operator@test",
    });
    const persisted = getRunById(result.run.id);
    expect(persisted?.startedAt).toBeNull();
    expect(persisted?.branchName).toBeNull();
  });
});
