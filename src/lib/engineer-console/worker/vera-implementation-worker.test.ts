import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createTask } from "../task-manager/task-manager";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
} from "../bridge/vera-handoff-task-types";
import { readVeraImplementationArtifact } from "./vera-implementation-artifact-storage";
import { runVeraImplementationWorker } from "./vera-implementation-worker";

const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";
const RUN_ID = "db68f74f-add8-4065-8c1e-4caa4fcb9705";

function buildVeraHandoffDescription(): string {
  return [
    VERA_HANDOFF_DESCRIPTION_HEADING,
    "",
    "- **Source:** veralux-os",
    "",
    "### Instructions",
    "",
    VERA_HANDOFF_NON_EXECUTION_NOTE,
    "Implement pricing summary module updates.",
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

let repoRoot = "";
let artifactRoot = "";

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-artifacts-"));
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(artifactRoot, "test.db");
  process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();

  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-worker-repo-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
});

afterEach(() => {
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_MODEL_PROVIDER;
  if (artifactRoot && fs.existsSync(artifactRoot)) {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
  if (repoRoot && fs.existsSync(repoRoot)) {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

describe("runVeraImplementationWorker", () => {
  it("creates deterministic implementation artifact for a Vera run", () => {
    const task = createTask({
      title: "[Vera WO] implementation worker",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "running",
      targetRepoPath: repoRoot,
    });

    const result = runVeraImplementationWorker({
      runId: RUN_ID,
      task,
      repoPath: repoRoot,
      branchName: "engineer/test-branch",
      governanceNotes: JSON.stringify({
        veraHandoff: true,
        veraWorkOrderId: VERA_WORK_ORDER_ID,
        veraExecutionStartRequested: true,
      }),
    });

    expect(result.status).toBe("artifact_created");
    expect(result.artifactPath).toBeTruthy();
    expect(result.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifact?.runId).toBe(RUN_ID);
    expect(result.artifact?.taskId).toBe(task.id);
    expect(result.artifact?.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);
    expect(result.artifact?.noPrCreated).toBe(true);
    expect(result.artifact?.noMergePerformed).toBe(true);
    expect(result.artifact?.noDeploymentPerformed).toBe(true);
    expect(result.artifact?.noReleasePerformed).toBe(true);

    const loaded = readVeraImplementationArtifact(RUN_ID);
    expect(loaded?.implementationSummary).toContain("Deterministic Vera implementation artifact");
  });

  it("blocks safely when task is not Vera handoff", () => {
    const task = createTask({
      title: "Regular task",
      description: "Not a Vera handoff",
      priority: "normal",
      status: "running",
      targetRepoPath: repoRoot,
    });

    const result = runVeraImplementationWorker({
      runId: RUN_ID,
      task,
      repoPath: repoRoot,
      branchName: "engineer/test-branch",
    });

    expect(result.status).toBe("blocked");
    expect(result.artifact?.blockers).toContain("Task is not a VeraLux OS handoff.");
  });

  it("blocks safely when repo path is missing", () => {
    const task = createTask({
      title: "[Vera WO] missing repo",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "running",
      targetRepoPath: repoRoot,
    });

    const result = runVeraImplementationWorker({
      runId: RUN_ID,
      task,
      repoPath: path.join(repoRoot, "missing"),
      branchName: "engineer/test-branch",
    });

    expect(result.status).toBe("blocked");
    expect(result.artifact?.blockers.join(" ")).toContain("Repository path is missing");
  });
});
