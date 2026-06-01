import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  createWorkerPlanRecord,
  updateWorkerPlanValidation,
} from "../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../worker-plan/worker-plan-validation";
import { buildHermesRunPacketForRun, HermesRunPacketError } from "./build-hermes-run-packet";
import {
  exportHermesRunPacketToInbox,
  prepareHermesRunForEngineeringRun,
} from "./hermes-dispatch-manager";
import { HERMES_PACKET_LIMITS, HERMES_GLOBAL_FORBIDDEN_PATHS } from "./hermes-policy";
import { HERMES_RUN_PACKET_SCHEMA_VERSION } from "./hermes-run-packet-types";

const HERMES_SOURCE_ROOT = path.join(
  process.cwd(),
  "src/lib/engineer-console/hermes-worker",
);

describe("Hermes worker integration phase 6", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpInbox: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-console-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `hermes-phase6-${Date.now()}.db`);
    tmpInbox = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-inbox-"));
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_INBOX = tmpInbox;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_INBOX;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpInbox, { recursive: true, force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
  });

  function seedValidWorkerPlan(runId: string): WorkerPlan {
    const plan: WorkerPlan = {
      runId,
      summary: "Hermes bounded scope",
      allowedFiles: ["docs/hermes-handoff.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/hermes-handoff.md",
          content: "# handoff\n",
          reason: "phase6 test",
        },
      ],
    };
    const record = createWorkerPlanRecord(runId, plan);
    const validation = validateWorkerPlan(plan, repoRoot, runId);
    expect(validation.valid).toBe(true);
    updateWorkerPlanValidation(record.id, validation);
    return plan;
  }

  it("requires an Engineering Console run and valid worker plan", () => {
    const task = createTask({ title: "Hermes task", targetRepoPath: repoRoot });
    const run = createRun(task.id);

    expect(() => buildHermesRunPacketForRun(run.id)).toThrow(HermesRunPacketError);

    seedValidWorkerPlan(run.id);
    const built = buildHermesRunPacketForRun(run.id);
    expect(built.packet.schemaVersion).toBe(HERMES_RUN_PACKET_SCHEMA_VERSION);
    expect(built.packet.engineeringConsole.runId).toBe(run.id);
    expect(built.packet.governance.sourceOfTruth).toBe("engineering-console");
  });

  it("bounds dispatch payload and enforces path policy", () => {
    const task = createTask({
      title: "Bounded",
      description: "Do bounded work",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    seedValidWorkerPlan(run.id);

    const { packet } = buildHermesRunPacketForRun(run.id);
    const bytes = Buffer.byteLength(JSON.stringify(packet), "utf8");
    expect(bytes).toBeLessThanOrEqual(HERMES_PACKET_LIMITS.maxPacketBytes);
    expect(packet.policy.allowedPaths).toContain("docs/hermes-handoff.md");
    for (const forbidden of HERMES_GLOBAL_FORBIDDEN_PATHS) {
      expect(packet.policy.forbiddenPaths).toContain(forbidden);
    }
    expect(packet.policy.allowedCommands.every((c) => c.startsWith("npm"))).toBe(true);
  });

  it("rejects operations outside allowedFiles scope", () => {
    const task = createTask({ title: "Scope", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "bad scope",
      allowedFiles: ["docs/allowed.md"],
      operations: [
        {
          type: "create_file",
          path: "src/out-of-scope.ts",
          content: "export {}\n",
          reason: "bad",
        },
      ],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    const validation = validateWorkerPlan(plan, repoRoot, run.id);
    expect(validation.valid).toBe(false);
    updateWorkerPlanValidation(record.id, validation);
    expect(() => buildHermesRunPacketForRun(run.id)).toThrow(HermesRunPacketError);
  });

  it("records audit events and evidence placeholder without executing Hermes", () => {
    const task = createTask({ title: "Audit", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    seedValidWorkerPlan(run.id);

    const { dispatch, packet } = prepareHermesRunForEngineeringRun(run.id);
    expect(dispatch.workerBackend).toBe("hermes");
    expect(dispatch.status).toBe("prepared");
    expect(fs.existsSync(dispatch.evidencePlaceholderPath)).toBe(true);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_RUN_PACKET_PREPARED);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_EVIDENCE_PLACEHOLDER_CREATED);

    const exported = exportHermesRunPacketToInbox(dispatch.id);
    expect(exported.dispatch.status).toBe("dispatched");
    expect(fs.existsSync(exported.exportPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(exported.exportPath, "utf8")) as {
      dispatchId: string;
    };
    expect(onDisk.dispatchId).toBe(packet.dispatchId);

    const afterExport = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(afterExport).toContain(AUDIT_EVENT_TYPES.HERMES_RUN_DISPATCHED);
  });

  it("has no VeraLux OS dependency in Hermes worker modules", () => {
    const files = fs
      .readdirSync(HERMES_SOURCE_ROOT)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(HERMES_SOURCE_ROOT, file), "utf8");
      expect(content).not.toMatch(/veralux-system/i);
      expect(content).not.toMatch(/vera-code-work-order-runner/i);
      expect(content).not.toMatch(/executeRun\(/);
    }
  });

  it("treats Hermes output path as evidence placeholder only", () => {
    const task = createTask({ title: "Evidence", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    seedValidWorkerPlan(run.id);
    const { dispatch } = prepareHermesRunForEngineeringRun(run.id);
    const placeholder = JSON.parse(
      fs.readFileSync(dispatch.evidencePlaceholderPath, "utf8"),
    ) as { status: string; source: string };
    expect(placeholder.status).toBe("pending");
    expect(placeholder.source).toBe("engineering-console");
  });
});
