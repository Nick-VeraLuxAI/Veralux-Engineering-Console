import { beforeEach, describe, expect, it } from "vitest";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getTaskById } from "../task-manager/task-manager";
import {
  BridgeRepoResolutionError,
  BridgeRequestValidationError,
  createEngineeringRequestFromVeraluxOsBridge,
  parseVeraluxOsBridgeCreateRequestBody,
} from "./create-engineering-request";
import {
  prepareVeraImplementationRun,
  VERA_PREPARED_RUN_NON_EXECUTION_NOTE,
} from "./prepare-vera-implementation-run";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task-types";

const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";

function seedBridgeDb(): void {
  const tmpDb = `/tmp/engineer-console-bridge-request-${Date.now()}-${Math.random()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  delete process.env.ENGINEER_CONSOLE_BRIDGE_DEFAULT_REGISTERED_REPO_ID;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
}

function validBridgePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Bridge Vera handoff",
    priority: "normal",
    requestType: "code",
    instructions: "Implement pricing summary updates.",
    source: "veralux-os",
    requestedBy: "operator@test",
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    nonExecutionNote: VERA_HANDOFF_NON_EXECUTION_NOTE,
    ...overrides,
  };
}

describe("parseVeraluxOsBridgeCreateRequestBody", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
  });
  it("accepts a valid high-level payload", () => {
    const body = parseVeraluxOsBridgeCreateRequestBody({
      title: "Fix billing export",
      priority: "high",
      requestType: "code",
      instructions: "Investigate CSV export timeout for enterprise builds.",
      source: "veralux-os",
      businessContext: { buildId: "build-42", module: "billing" },
      requestedBy: "operator",
    });

    expect(body.title).toBe("Fix billing export");
    expect(body.priority).toBe("high");
    expect(body.businessContext?.buildId).toBe("build-42");
  });

  it("rejects execution-oriented fields", () => {
    expect(() =>
      parseVeraluxOsBridgeCreateRequestBody({
        title: "Bad",
        priority: "normal",
        requestType: "code",
        instructions: "Do thing",
        source: "veralux-os",
        requestedBy: "operator",
        shell: "rm -rf /",
      }),
    ).toThrow(BridgeRequestValidationError);
  });

  it("rejects repo binding from VeraLux OS", () => {
    expect(() =>
      parseVeraluxOsBridgeCreateRequestBody({
        title: "Bad",
        priority: "normal",
        requestType: "code",
        instructions: "Do thing",
        source: "veralux-os",
        requestedBy: "operator",
        targetRepoPath: "/tmp/evil",
      }),
    ).toThrow(BridgeRequestValidationError);

    expect(() =>
      parseVeraluxOsBridgeCreateRequestBody({
        ...validBridgePayload(),
        repoPath: "/tmp/evil",
      }),
    ).toThrow(BridgeRequestValidationError);
  });

  it("rejects missing requestType, priority, and requestedBy", () => {
    expect(() =>
      parseVeraluxOsBridgeCreateRequestBody({
        ...validBridgePayload(),
        requestType: "deploy",
      }),
    ).toThrow(BridgeRequestValidationError);

    expect(() =>
      parseVeraluxOsBridgeCreateRequestBody({
        ...validBridgePayload(),
        priority: "critical",
      }),
    ).toThrow(BridgeRequestValidationError);

    expect(() =>
      parseVeraluxOsBridgeCreateRequestBody({
        ...validBridgePayload(),
        requestedBy: "",
      }),
    ).toThrow(BridgeRequestValidationError);
  });

  it("accepts veraWorkOrderId and nonExecutionNote", () => {
    const body = parseVeraluxOsBridgeCreateRequestBody(validBridgePayload());
    expect(body.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);
    expect(body.nonExecutionNote).toBe(VERA_HANDOFF_NON_EXECUTION_NOTE);
  });
});

describe("createEngineeringRequestFromVeraluxOsBridge", () => {
  beforeEach(() => {
    resetEngineerConsoleDbForTests();
  });

  it("creates a draft task as Engineering Console source-of-truth", () => {
    const tmpDb = `/tmp/engineer-console-bridge-request-${Date.now()}.db`;
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
    delete process.env.ENGINEER_CONSOLE_BRIDGE_DEFAULT_REGISTERED_REPO_ID;
    initializeEngineerConsoleDatabase();

    const body = parseVeraluxOsBridgeCreateRequestBody({
      title: "Bridge task",
      priority: "normal",
      requestType: "code",
      instructions: "Read-only bridge phase 3.",
      source: "veralux-os",
      requestedBy: "operator",
    });

    const result = createEngineeringRequestFromVeraluxOsBridge(body, {
      consoleOrigin: "http://127.0.0.1:3004",
    });

    expect(result.engineeringRunId).toBeNull();
    expect(result.status).toBe("draft");
    expect(result.consoleUrl).toContain(`/engineer/tasks/${result.engineeringTaskId}`);

    const task = getTaskById(result.engineeringTaskId);
    expect(task).not.toBeNull();
    expect(task?.title).toBe("Bridge task");
    expect(task?.description).toContain("VeraLux OS");
    expect(task?.description).toContain("Read-only bridge phase 3.");
  });

  it("persists Vera handoff metadata for analyzeVeraHandoffTask and prepare run", () => {
    seedBridgeDb();

    const body = parseVeraluxOsBridgeCreateRequestBody(validBridgePayload());
    const result = createEngineeringRequestFromVeraluxOsBridge(body, {
      consoleOrigin: "http://127.0.0.1:3004",
    });

    expect(result.engineeringRunId).toBeNull();
    expect(result.status).toBe("draft");

    const task = getTaskById(result.engineeringTaskId);
    expect(task).not.toBeNull();
    expect(task?.description).toContain(VERA_HANDOFF_NON_EXECUTION_NOTE);
    expect(task?.description).toContain(`Source work order ID: ${VERA_WORK_ORDER_ID}`);
    expect(task?.description).toContain(`vera-work-order:${VERA_WORK_ORDER_ID}`);

    const analysis = analyzeVeraHandoffTask(task!);
    expect(analysis.safeToPrepareRun).toBe(true);
    expect(analysis.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);
    expect(analysis.nonExecutionNotePresent).toBe(true);

    const prepared = prepareVeraImplementationRun({
      taskId: task!.id,
      confirmationText: VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE,
      preparedBy: "operator@test",
    });

    expect(prepared.run.currentStep).toBe(VERA_IMPLEMENTATION_RUN_PREPARED_STEP);
    expect(prepared.run.startedAt).toBeNull();
    expect(prepared.run.branchName).toBeNull();
    expect(prepared.run.governanceNotes).toContain(VERA_PREPARED_RUN_NON_EXECUTION_NOTE);
  });

  it("does not start execution when bridge request creates a task", () => {
    seedBridgeDb();

    const body = parseVeraluxOsBridgeCreateRequestBody(validBridgePayload());
    const result = createEngineeringRequestFromVeraluxOsBridge(body);

    expect(result.engineeringRunId).toBeNull();
    expect(result.status).toBe("draft");
  });

  it("fails when no repo binding can be resolved", () => {
    const tmpDb = `/tmp/engineer-console-bridge-request-${Date.now()}-2.db`;
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_BRIDGE_DEFAULT_REGISTERED_REPO_ID;
    initializeEngineerConsoleDatabase();

    const body = parseVeraluxOsBridgeCreateRequestBody({
      title: "No repo",
      priority: "low",
      requestType: "code",
      instructions: "Should fail repo resolution.",
      source: "veralux-os",
      requestedBy: "operator",
    });

    expect(() => createEngineeringRequestFromVeraluxOsBridge(body)).toThrow(BridgeRepoResolutionError);
  });
});
