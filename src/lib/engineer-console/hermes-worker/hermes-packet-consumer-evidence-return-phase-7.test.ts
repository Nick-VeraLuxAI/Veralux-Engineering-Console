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
import { prepareHermesRunForEngineeringRun } from "./hermes-dispatch-manager";
import { ingestHermesWorkerEvidenceForRun } from "./hermes-evidence-ingest";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "./hermes-evidence-types";
import { resolveHermesEvidenceReportPath } from "./read-hermes-worker-evidence";

const HERMES_CONSUMER = path.join(
  os.homedir(),
  ".hermes",
  "scripts",
  "consume-engineering-packet.mjs",
);

describe("Hermes packet consumer evidence return phase 7", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;
  let envRoots: string | undefined;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p7-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `hermes-p7-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p7-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    envRoots = process.env.HERMES_ENGINEERING_REPO_ROOTS;
    process.env.HERMES_ENGINEERING_REPO_ROOTS = repoRoot;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    if (envRoots === undefined) delete process.env.HERMES_ENGINEERING_REPO_ROOTS;
    else process.env.HERMES_ENGINEERING_REPO_ROOTS = envRoots;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
  });

  function seedRunWithValidPlan() {
    const task = createTask({
      title: "Hermes P7",
      description: "Return evidence",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Handoff doc",
      allowedFiles: ["docs/p7.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p7.md",
          content: "# p7\n",
          reason: "test",
        },
      ],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    updateWorkerPlanValidation(record.id, validateWorkerPlan(plan, repoRoot, run.id));
    return { task, run };
  }

  it("ingests Hermes evidence and records audit without granting sign-off", () => {
    const { run } = seedRunWithValidPlan();
    const { dispatch, packet } = prepareHermesRunForEngineeringRun(run.id);

    if (!fs.existsSync(HERMES_CONSUMER)) {
      const reportPath = resolveHermesEvidenceReportPath(dispatch);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(
        reportPath,
        JSON.stringify(
          {
            schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
            status: "inspected",
            dispatchId: packet.dispatchId,
            runId: run.id,
            taskId: run.taskId,
            timestamp: new Date().toISOString(),
            governance: {
              evidenceOnly: true,
              notSignOff: true,
              sourceOfTruth: "engineering-console",
            },
            boundaryValidation: { valid: true, checks: [] },
          },
          null,
          2,
        ),
      );
    } else {
      const inbox = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p7-inbox-"));
      const packetFile = path.join(inbox, `${run.id}-${dispatch.id}.json`);
      fs.writeFileSync(packetFile, JSON.stringify(packet, null, 2));
      execFileSync("node", [HERMES_CONSUMER, "--file", packetFile], {
        env: { ...process.env, HERMES_ENGINEERING_REPO_ROOTS: repoRoot },
      });
      fs.rmSync(inbox, { recursive: true, force: true });
    }

    const first = ingestHermesWorkerEvidenceForRun(run.id);
    expect(first.summary.available).toBe(true);
    expect(first.summary.evidenceOnlyNotSignOff).toBe(true);
    expect(first.summary.status).toBe("inspected");
    expect(first.auditRecorded).toBe(true);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.HERMES_EVIDENCE_RECEIVED);

    const second = ingestHermesWorkerEvidenceForRun(run.id);
    expect(second.auditRecorded).toBe(false);
  });

  it("Console remains source-of-truth when evidence is present", () => {
    const { run } = seedRunWithValidPlan();
    const { dispatch } = prepareHermesRunForEngineeringRun(run.id);
    const reportPath = resolveHermesEvidenceReportPath(dispatch);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
        status: "inspected",
        dispatchId: dispatch.id,
        runId: run.id,
        taskId: run.taskId,
        timestamp: new Date().toISOString(),
        governance: {
          evidenceOnly: true,
          notSignOff: true,
          notApproval: true,
          sourceOfTruth: "engineering-console",
        },
      }),
    );

    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(ingested.evidence?.governance.sourceOfTruth).toBe("engineering-console");
    expect(ingested.evidence?.governance.notSignOff).toBe(true);
    expect(run.status).not.toBe("completed");
  });
});
