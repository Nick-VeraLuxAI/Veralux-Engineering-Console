import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, getRunById, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  requestVeraExecutionApproval,
  VeraExecutionApprovalRequestError,
} from "./request-vera-execution-approval";
import {
  VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE,
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task-types";

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
  const tmpDb = `/tmp/engineer-console-vera-approval-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  initializeEngineerConsoleDatabase();
}

function createVeraPreparedRun() {
  const task = createTask({
    title: "[Vera WO] approval request",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: process.cwd(),
  });
  const run = createRun(task.id);
  updateRun(run.id, {
    currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      preparedBy: "operator@test",
      preparedAt: new Date().toISOString(),
    }),
  });
  return { task, run: getRunById(run.id)! };
}

function confirmInput() {
  return { confirmationText: VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE };
}

describe("requestVeraExecutionApproval", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    seedDb();
  });

  it("requests approval without execution", () => {
    const { run } = createVeraPreparedRun();
    const result = requestVeraExecutionApproval({
      runId: run.id,
      ...confirmInput(),
      requestedBy: "operator@test",
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.run.status).toBe("pending");
    expect(result.run.currentStep).toBe(VERA_EXECUTION_APPROVAL_REQUESTED_STEP);
    expect(result.run.startedAt).toBeNull();
    expect(result.run.branchName).toBeNull();
    expect(result.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_EXECUTION_APPROVAL_REQUESTED);
  });

  it("rejects wrong confirmation phrase", () => {
    const { run } = createVeraPreparedRun();
    expect(() =>
      requestVeraExecutionApproval({
        runId: run.id,
        confirmationText: "WRONG",
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraExecutionApprovalRequestError);
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
    expect(() =>
      requestVeraExecutionApproval({
        runId: run.id,
        ...confirmInput(),
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraExecutionApprovalRequestError);
  });

  it("rejects unprepared run", () => {
    const task = createTask({
      title: "[Vera WO] unprepared",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "draft",
      targetRepoPath: process.cwd(),
    });
    const run = createRun(task.id);
    updateRun(run.id, {
      governanceNotes: JSON.stringify({ veraHandoff: true, veraWorkOrderId: VERA_WORK_ORDER_ID }),
    });
    expect(() =>
      requestVeraExecutionApproval({
        runId: run.id,
        ...confirmInput(),
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraExecutionApprovalRequestError);
  });

  it("returns existing approval request idempotently", () => {
    const { run } = createVeraPreparedRun();
    const first = requestVeraExecutionApproval({
      runId: run.id,
      ...confirmInput(),
      requestedBy: "operator@test",
    });
    const eventsAfterFirst = listAuditEventsForRun(run.id).filter(
      (event) => event.eventType === AUDIT_EVENT_TYPES.VERA_EXECUTION_APPROVAL_REQUESTED,
    ).length;
    const second = requestVeraExecutionApproval({
      runId: run.id,
      ...confirmInput(),
      requestedBy: "operator@test",
    });
    const eventsAfterSecond = listAuditEventsForRun(run.id).filter(
      (event) => event.eventType === AUDIT_EVENT_TYPES.VERA_EXECUTION_APPROVAL_REQUESTED,
    ).length;

    expect(second.alreadyExisted).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(eventsAfterSecond).toBe(eventsAfterFirst);
  });
});

describe("Vera execution approval request safety", () => {
  it("does not import execution, worker, shell, worktree, patch, commit, PR, merge, deploy, or test runners", () => {
    const root = process.cwd();
    const files = [
      "src/lib/engineer-console/bridge/request-vera-execution-approval.ts",
      "src/lib/engineer-console/bridge/vera-execution-readiness.ts",
      "src/app/api/engineer-console/runs/[id]/request-vera-execution-approval/route.ts",
    ];
    const forbidden = [
      /executeRun\s*\(/,
      /run-orchestrator/,
      /worker-plan-orchestrator/,
      /prepareAndExportHermesRunForEngineeringRun/,
      /child_process/,
      /\bspawn\s*\(/,
      /createWorktree|worktree/i,
      /applyHermesPatch/,
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /controlled-gh-merge/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
      /runQualityGates/,
      /quality-gate-runner/,
    ];

    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
