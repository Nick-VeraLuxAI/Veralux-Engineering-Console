import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { createTask } from "../../task-manager/task-manager";
import { createRun, saveApprovalReport } from "../../run-manager/run-manager";
import { buildApprovalReport } from "../../approval/approval-report";
import { assessChangedFiles } from "../governance-engine";
import { refreshRunEvidenceBundle } from "../evidence-bundles/evidence-bundle-manager";
import { handleApprovalAction } from "../../orchestrator/run-orchestrator";
import { appendAuditEvent } from "./append-audit-event";
import { computeChainHash } from "./compute-chain-hash";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "./audit-event-types";
import { AUDIT_CHAIN_GENESIS } from "./audit-ledger-types";
import {
  listAuditEventsForChainScope,
  listAuditEventsForRun,
  verifyAuditChainForScope,
} from "./audit-ledger-manager";
import { stablePayloadCanonical, stablePayloadHash, verifyAuditChain } from "./verify-audit-chain";
import { canonicalJson } from "./canonical-json";

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-audit-test-${Date.now()}-${Math.random()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "test-scope";
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

describe("canonical JSON and payload hashing", () => {
  it("produces stable canonical JSON regardless of key order", () => {
    const a = canonicalJson({ z: 1, a: 2, m: { b: 1, a: 2 } });
    const b = canonicalJson({ a: 2, m: { a: 2, b: 1 }, z: 1 });
    expect(a).toBe(b);
  });

  it("produces stable payload hashes", () => {
    const h1 = stablePayloadHash({ b: 2, a: 1 });
    const h2 = stablePayloadHash({ a: 1, b: 2 });
    expect(h1).toBe(h2);
    expect(stablePayloadCanonical({ a: 1, b: 2 })).toContain('"a"');
  });
});

describe("chain hash computation", () => {
  it("is deterministic for the same inputs", () => {
    const input = {
      previousChainHash: AUDIT_CHAIN_GENESIS,
      eventType: "TASK_CREATED",
      entityType: "task",
      entityId: "task-1",
      payloadHash: stablePayloadHash({ title: "x" }),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(computeChainHash(input)).toBe(computeChainHash(input));
  });
});

describe("append and verify audit chain", () => {
  it("maintains sequential continuity", () => {
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.TASK_CREATED,
      entityType: AUDIT_ENTITY_TYPES.TASK,
      entityId: "t1",
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      payload: { title: "One" },
    });
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.RUN_CREATED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: "r1",
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: "t1",
      runId: "r1",
      payload: {},
    });

    const events = listAuditEventsForChainScope("test-scope");
    expect(events).toHaveLength(2);
    expect(events[0]!.previousEventHash).toBeNull();
    expect(events[1]!.previousEventHash).toBe(events[0]!.chainHash);

    const verification = verifyAuditChainForScope("test-scope");
    expect(verification.ok).toBe(true);
    expect(verification.checkedCount).toBe(2);
  });

  it("detects payload tampering", () => {
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.TASK_CREATED,
      entityType: AUDIT_ENTITY_TYPES.TASK,
      entityId: "t-tamper",
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      payload: { safe: true },
    });

    const events = listAuditEventsForChainScope("test-scope");
    const tampered = {
      ...events[0]!,
      payloadJson: JSON.stringify({ safe: false }),
    };

    const result = verifyAuditChain([tampered]);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("payload_hash_mismatch"))).toBe(true);
  });

  it("detects chain hash tampering", () => {
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.TASK_CREATED,
      entityType: AUDIT_ENTITY_TYPES.TASK,
      entityId: "t-chain",
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      payload: {},
    });

    const events = listAuditEventsForChainScope("test-scope");
    const tampered = { ...events[0]!, chainHash: "0".repeat(64) };
    const result = verifyAuditChain([tampered]);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("chain_hash_mismatch"))).toBe(true);
  });

  it("detects broken previous hash continuity", () => {
    const first = appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.TASK_CREATED,
      entityType: AUDIT_ENTITY_TYPES.TASK,
      entityId: "t-break",
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      payload: {},
    });
    const second = appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.RUN_CREATED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: "r-break",
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      payload: {},
    });

    const broken = { ...second, previousEventHash: first.chainHash.slice(0, -1) + "x" };
    const result = verifyAuditChain([first, broken]);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("continuity_break"))).toBe(true);
  });

  it("avoids duplicate previous hash under concurrent appends", async () => {
    const appends = Array.from({ length: 12 }, (_, i) =>
      Promise.resolve().then(() =>
        appendAuditEvent({
          eventType: AUDIT_EVENT_TYPES.TASK_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.TASK,
          entityId: `concurrent-${i}`,
          actorType: AUDIT_ACTOR_TYPES.SYSTEM,
          payload: { index: i },
        }),
      ),
    );

    await Promise.all(appends);

    const events = listAuditEventsForChainScope("test-scope");
    const previousHashes = events
      .map((e) => e.previousEventHash)
      .filter((h): h is string => h !== null);

    expect(new Set(previousHashes).size).toBe(previousHashes.length);

    const verification = verifyAuditChainForScope("test-scope");
    expect(verification.ok).toBe(true);
  });
});

describe("lifecycle integration emits audit events", () => {
  it("records task, run, and human approval events", async () => {
    const task = createTask({
      title: "Audit integration task",
      targetRepoPath: "/tmp/audit-repo",
    });
    const run = createRun(task.id);

    const runEvents = listAuditEventsForRun(run.id);
    const eventTypes = runEvents.map((e) => e.eventType);
    expect(eventTypes).toContain(AUDIT_EVENT_TYPES.RUN_CREATED);

    const scopeEvents = listAuditEventsForChainScope("test-scope");
    expect(scopeEvents.some((e) => e.eventType === AUDIT_EVENT_TYPES.TASK_CREATED)).toBe(true);

    const report = buildApprovalReport({
      task,
      run: { ...run, status: "waiting_for_approval", branchName: "engineer/test" },
      changedFiles: [],
      diffSummary: "",
      governance: assessChangedFiles([]),
      qualityGateResults: [],
    });
    saveApprovalReport(run.id, JSON.stringify(report));

    await refreshRunEvidenceBundle({ runId: run.id });
    await handleApprovalAction(run.id, "approve", { rationale: "audit ledger approve" });
    const afterApproval = listAuditEventsForRun(run.id);
    expect(afterApproval.map((e) => e.eventType)).toContain(AUDIT_EVENT_TYPES.HUMAN_APPROVED);
    expect(afterApproval.map((e) => e.eventType)).toContain(AUDIT_EVENT_TYPES.RUN_COMPLETED);
  });
});
