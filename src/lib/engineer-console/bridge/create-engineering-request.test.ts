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
