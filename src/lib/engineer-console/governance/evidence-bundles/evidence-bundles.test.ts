import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { saveApprovalReport, createRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { buildApprovalReport } from "../../approval/approval-report";
import { assessChangedFiles } from "../governance-engine";
import { handleApprovalAction } from "../../orchestrator/run-orchestrator";
import { buildRunEvidenceBundle } from "./build-run-evidence-bundle";
import { hashEvidenceBundle } from "./hash-evidence-bundle";
import { redactEvidenceBundle, truncateString } from "./redact-evidence-bundle";
import {
  getEvidenceBundleForRun,
  refreshRunEvidenceBundle,
  toPublicEvidenceBundle,
} from "./evidence-bundle-manager";
import type { RunEvidenceBundleV1 } from "./evidence-bundle-types";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-evidence-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "evidence-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

function seedRunWithApproval() {
  const task = createTask({ title: "Evidence task", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  const report = buildApprovalReport({
    task,
    run: { ...run, status: "waiting_for_approval", branchName: "engineer/test" },
    changedFiles: ["src/a.ts"],
    diffSummary: "1 file changed",
    governance: assessChangedFiles(["src/a.ts"]),
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  return { task, run, report };
}

describe("evidence bundle hashing and redaction", () => {
  it("produces stable hash for canonical bundle", async () => {
    const { run } = seedRunWithApproval();
    const b1 = await buildRunEvidenceBundle({
      runId: run.id,
      changedFiles: ["src/a.ts"],
      diffSummary: "diff",
    });
    const r1 = redactEvidenceBundle(b1);
    b1.timestamps.bundleBuiltAt = "2026-01-01T00:00:00.000Z";
    r1.timestamps.bundleBuiltAt = "2026-01-01T00:00:00.000Z";
    const h1 = hashEvidenceBundle(r1);
    const b2 = { ...r1 };
    expect(hashEvidenceBundle(b2)).toBe(h1);
  });

  it("truncates long strings", () => {
    const long = "x".repeat(1000);
    expect(truncateString(long).length).toBeLessThan(600);
  });

  it("stores model draft as hashes only", async () => {
    const { run } = seedRunWithApproval();
    const db = (await import("../../db/client")).getEngineerConsoleDb();
    db.prepare(
      `INSERT INTO engineer_worker_plan_drafts
        (id, run_id, provider, model, prompt, raw_response, parsed_plan_json,
         validation_status, validation_errors_json, created_at)
       VALUES (@id, @run_id, @provider, @model, @prompt, @raw_response, NULL,
         'valid', '[]', @created_at)`,
    ).run({
      id: "draft-1",
      run_id: run.id,
      provider: "mock",
      model: "mock-model",
      prompt: "secret prompt with api_key=abc",
      raw_response: '{"runId":"x"}',
      created_at: new Date().toISOString(),
    });

    const record = await refreshRunEvidenceBundle({ runId: run.id });
    expect(record.bundleJson).not.toContain("secret prompt");
    expect(record.bundleJson).toContain("promptHash");
  });
});

describe("evidence bundle persistence", () => {
  it("creates bundle for run with approval report", async () => {
    const { run } = seedRunWithApproval();
    const record = await refreshRunEvidenceBundle({
      runId: run.id,
      changedFiles: ["src/a.ts"],
      diffSummary: "1 file changed",
    });

    expect(record.bundleHash).toMatch(/^[a-f0-9]{64}$/);
    const parsed = JSON.parse(record.bundleJson) as RunEvidenceBundleV1;
    expect(parsed.changedFileCount).toBe(1);
    expect(parsed.qualityGates).toEqual([]);
    expect(parsed.approval?.canApprove).toBe(true);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.EVIDENCE_BUNDLE_CREATED);
  });

  it("updates bundle on refresh", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    await refreshRunEvidenceBundle({ runId: run.id, changedFiles: ["src/a.ts", "src/b.ts"] });

    const record = getEvidenceBundleForRun(run.id)!;
    const parsed = JSON.parse(record.bundleJson) as RunEvidenceBundleV1;
    expect(parsed.changedFileCount).toBe(2);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.EVIDENCE_BUNDLE_UPDATED);
  });

  it("public API shape excludes raw prompts", async () => {
    const { run } = seedRunWithApproval();
    const record = await refreshRunEvidenceBundle({ runId: run.id });
    const pub = toPublicEvidenceBundle(record);
    expect(pub.bundle).toBeDefined();
    expect(JSON.stringify(pub)).not.toContain("rawResponse");
    expect(JSON.stringify(pub)).not.toContain("stdout");
  });

  it("refreshes after human approval", async () => {
    const { run } = seedRunWithApproval();
    await refreshRunEvidenceBundle({ runId: run.id });
    await handleApprovalAction(run.id, "approve", { rationale: "evidence bundle test approve" });

    const record = getEvidenceBundleForRun(run.id)!;
    const parsed = JSON.parse(record.bundleJson) as RunEvidenceBundleV1;
    expect(parsed.runStatus).toBe("completed");
  });
});
