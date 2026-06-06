import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraImplementationArtifactCreated,
  auditVeraImplementationWorkerBlocked,
  auditVeraImplementationWorkerFailed,
  auditVeraImplementationWorkerStarted,
} from "../bridge/vera-handoff-audit-lifecycle";

const TASK_ID = "6b4bf42a-a24d-4e36-a285-ddc803db9293";
const RUN_ID = "db68f74f-add8-4065-8c1e-4caa4fcb9705";
const VERA_WORK_ORDER_ID = "34d51430-df8c-48ee-a43c-6bb8a2084be8";

const EXPECTED_RELEASE_GATED_PAYLOAD = {
  noPullRequestCreated: true,
  noMergePerformed: true,
  noDeploymentPerformed: true,
  noReleasePerformed: true,
};

function parseAuditPayload(payloadJson: string): Record<string, unknown> {
  return JSON.parse(payloadJson) as Record<string, unknown>;
}

function expectReleaseGatedPayload(payloadJson: string): void {
  expect(parseAuditPayload(payloadJson)).toMatchObject(EXPECTED_RELEASE_GATED_PAYLOAD);
}

describe("Vera implementation worker audit payloads", () => {
  beforeEach(() => {
    const tmpDb = `/tmp/engineer-console-vera-worker-audit-${Date.now()}.db`;
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    resetEngineerConsoleDbForTests();
    initializeEngineerConsoleDatabase();
  });

  it("VERA_IMPLEMENTATION_WORKER_STARTED includes release-gated flags", () => {
    const event = auditVeraImplementationWorkerStarted(TASK_ID, RUN_ID, {
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      branchName: "engineer/test",
      repoPath: "/tmp/repo",
    });

    expect(event.eventType).toBe(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_STARTED);
    expectReleaseGatedPayload(event.payloadJson);
  });

  it("VERA_IMPLEMENTATION_ARTIFACT_CREATED includes release-gated flags", () => {
    const event = auditVeraImplementationArtifactCreated(TASK_ID, RUN_ID, {
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      branchName: "engineer/test",
      artifactPath: "/tmp/artifact.json",
      artifactHash: "abc123",
      workerMode: "deterministic_metadata",
    });

    expect(event.eventType).toBe(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_CREATED);
    expectReleaseGatedPayload(event.payloadJson);
  });

  it("VERA_IMPLEMENTATION_WORKER_BLOCKED includes release-gated flags", () => {
    const event = auditVeraImplementationWorkerBlocked(TASK_ID, RUN_ID, {
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      branchName: "engineer/test",
      artifactPath: "/tmp/artifact.json",
      artifactHash: "abc123",
      workerMode: "deterministic_metadata",
      blockers: ["Repository path is missing or unavailable for implementation worker."],
    });

    expect(event.eventType).toBe(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_BLOCKED);
    expectReleaseGatedPayload(event.payloadJson);
  });

  it("VERA_IMPLEMENTATION_WORKER_FAILED includes release-gated flags", () => {
    const event = auditVeraImplementationWorkerFailed(TASK_ID, RUN_ID, {
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      branchName: "engineer/test",
      message: "Artifact write failed.",
      workerMode: "deterministic_metadata",
    });

    expect(event.eventType).toBe(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_WORKER_FAILED);
    expectReleaseGatedPayload(event.payloadJson);
  });
});
