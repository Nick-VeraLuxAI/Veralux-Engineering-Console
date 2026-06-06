import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getRunById, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  startVeraExecution,
  VeraExecutionStartError,
} from "./start-vera-execution";
import {
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_EXECUTION_START_CONFIRMATION_PHRASE,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
} from "./vera-handoff-task-types";
import { createRun } from "../run-manager/run-manager";

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
  const tmpDb = `/tmp/engineer-console-vera-start-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  initializeEngineerConsoleDatabase();
}

function createApprovedVeraRun() {
  const task = createTask({
    title: "[Vera WO] start execution",
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
  return { task, run: getRunById(run.id)! };
}

function confirmInput() {
  return { confirmationText: VERA_EXECUTION_START_CONFIRMATION_PHRASE };
}

describe("startVeraExecution", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    seedDb();
  });

  it("calls central executeRun exactly once for a valid run", async () => {
    const executeRunFn = vi.fn().mockResolvedValue(undefined);
    const { run } = createApprovedVeraRun();

    const result = await startVeraExecution(
      { runId: run.id, ...confirmInput(), startedBy: "operator@test" },
      { executeRunFn },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeRunFn).toHaveBeenCalledTimes(1);
    expect(executeRunFn).toHaveBeenCalledWith(run.id);
    expect(result.executionStartAccepted).toBe(true);
    expect(result.alreadyExisted).toBe(false);

    const persisted = getRunById(run.id);
    expect(persisted?.governanceNotes).toContain("veraExecutionStartRequested");
    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_EXECUTION_START_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_EXECUTION_START_ACCEPTED);
  });

  it("rejects wrong confirmation phrase", async () => {
    const { run } = createApprovedVeraRun();
    await expect(
      startVeraExecution({
        runId: run.id,
        confirmationText: "WRONG",
        startedBy: "operator@test",
      }),
    ).rejects.toThrow(VeraExecutionStartError);
  });

  it("rejects unapproved Vera run", async () => {
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
    await expect(
      startVeraExecution({
        runId: run.id,
        ...confirmInput(),
        startedBy: "operator@test",
      }),
    ).rejects.toThrow(VeraExecutionStartError);
  });

  it("returns idempotent result when already started", async () => {
    const executeRunFn = vi.fn().mockResolvedValue(undefined);
    const { run } = createApprovedVeraRun();
    await startVeraExecution(
      { runId: run.id, ...confirmInput(), startedBy: "operator@test" },
      { executeRunFn },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await startVeraExecution(
      { runId: run.id, ...confirmInput(), startedBy: "operator@test" },
      { executeRunFn },
    );

    expect(second.alreadyExisted).toBe(true);
    expect(executeRunFn).toHaveBeenCalledTimes(1);
  });

  it("writes rejected audit on readiness failure", async () => {
    const { run } = createApprovedVeraRun();
    updateRun(run.id, { branchName: "feature/already-branched" });
    await expect(
      startVeraExecution({
        runId: run.id,
        ...confirmInput(),
        startedBy: "operator@test",
      }),
    ).rejects.toThrow(VeraExecutionStartError);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_EXECUTION_START_REJECTED);
  });
});

describe("Vera execution start safety", () => {
  it("only imports central executeRun, not forbidden execution helpers", () => {
    const root = process.cwd();
    const forbidden = [
      /from\s+["'].*git-workspace["']/,
      /from\s+["'].*worker-plan-orchestrator["']/,
      /prepareAndExportHermesRunForEngineeringRun/,
      /child_process/,
      /applyHermesPatch/,
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /controlled-gh-merge/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
      /runQualityGates/,
    ];

    const serviceSource = readFileSync(
      path.join(root, "src/lib/engineer-console/bridge/start-vera-execution.ts"),
      "utf8",
    );
    for (const pattern of forbidden) {
      expect(serviceSource, `start-vera-execution.ts must not match ${pattern}`).not.toMatch(
        pattern,
      );
    }
    expect(serviceSource).toContain("executeRun");

    const routeSource = readFileSync(
      path.join(root, "src/app/api/engineer-console/runs/[id]/start-vera-execution/route.ts"),
      "utf8",
    );
    for (const pattern of forbidden) {
      expect(routeSource, `start-vera-execution route must not match ${pattern}`).not.toMatch(
        pattern,
      );
    }
    expect(routeSource).toContain("startVeraExecution");
    expect(routeSource).not.toContain("executeRun");
  });
});
