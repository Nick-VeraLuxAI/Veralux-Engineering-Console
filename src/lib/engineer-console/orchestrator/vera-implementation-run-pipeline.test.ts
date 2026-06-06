import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_PLACEHOLDER_MESSAGE } from "../agent-worker/agent-worker";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
  getRunById,
  updateRun,
} from "../run-manager/run-manager";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
} from "../bridge/vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_READY_STEP } from "../worker/vera-implementation-artifact-types";
import { readVeraImplementationArtifact } from "../worker/vera-implementation-artifact-storage";
import { executeRun } from "./run-orchestrator";

const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";

function buildVeraHandoffDescription(): string {
  return [
    VERA_HANDOFF_DESCRIPTION_HEADING,
    "",
    "- **Source:** veralux-os",
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

let tmpDb = "";
let repoRoot = "";

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-vera-pipeline-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();

  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-pipeline-repo-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "vera-pipeline-test", scripts: { test: "node -e \"process.exit(1)\"" } }),
  );
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
});

afterEach(() => {
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_MODEL_PROVIDER;
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (fs.existsSync(repoRoot)) fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("executeRun Vera implementation pipeline", () => {
  it("uses governed worker instead of placeholder failure for Vera-started runs", async () => {
    const task = createTask({
      title: "[Vera WO] pipeline",
      description: buildVeraHandoffDescription(),
      priority: "normal",
      status: "draft",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    updateRun(run.id, {
      currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
      governanceNotes: JSON.stringify({
        veraHandoff: true,
        veraWorkOrderId: VERA_WORK_ORDER_ID,
        veraExecutionApprovalRequested: true,
        veraExecutionStartRequested: true,
        executionStartedBy: "operator@test",
      }),
    });

    await executeRun(run.id);

    const finalRun = getRunById(run.id);
    expect(finalRun?.status).toBe("waiting_for_approval");
    expect(finalRun?.currentStep).toBe(VERA_IMPLEMENTATION_ARTIFACT_READY_STEP);
    expect(finalRun?.completedAt).toBeNull();
    expect(finalRun?.agentMessage).not.toBe(AGENT_PLACEHOLDER_MESSAGE);
    expect(finalRun?.agentMessage).toContain("Deterministic Vera implementation artifact");

    const gates = getQualityGateResultsForRun(run.id);
    expect(gates).toHaveLength(1);
    expect(gates[0]?.status).toBe("skipped");
    expect(gates[0]?.stderr).toContain("Source quality gates skipped");

    const reportJson = getApprovalReportJson(run.id);
    expect(reportJson).toBeTruthy();

    const artifact = readVeraImplementationArtifact(run.id);
    expect(artifact).not.toBeNull();
    expect(artifact?.noPrCreated).toBe(true);

    const events = listAuditEventsForRun(run.id);
    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_STARTED);
    expect(eventTypes).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_CREATED);
    expect(eventTypes.some((event) => event.includes("PULL_REQUEST"))).toBe(false);
    expect(eventTypes.some((event) => event.includes("MERGE"))).toBe(false);
    expect(eventTypes.some((event) => event.includes("DEPLOY"))).toBe(false);

    for (const eventType of [
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_STARTED,
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_CREATED,
    ] as const) {
      const payloadJson = events.find((event) => event.eventType === eventType)?.payloadJson;
      expect(JSON.parse(payloadJson ?? "{}")).toMatchObject({
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      });
    }
  });
});
