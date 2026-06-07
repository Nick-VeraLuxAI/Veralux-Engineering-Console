import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraPostPatchQualityGatesBlocked,
  auditVeraPostPatchQualityGatesCompleted,
  auditVeraPostPatchQualityGatesRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-2t-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera post-patch quality gates audit payloads", () => {
  it("includes gated safety flags on quality gate events", () => {
    const requested = auditVeraPostPatchQualityGatesRequested(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      applicationReportPath: "/tmp/application-report.json",
      applicationReportHash: "abc123",
    });
    expect(JSON.parse(requested.payloadJson)).toMatchObject({
      noPatchAppliedBeyondApprovedDraft: true,
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
    });

    const completed = auditVeraPostPatchQualityGatesCompleted(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      applicationReportPath: "/tmp/application-report.json",
      applicationReportHash: "abc123",
      qualityReportPath: "/tmp/quality-report.json",
      qualityReportHash: "def456",
      gateSummary: "passed:6/6",
    });
    expect(JSON.parse(completed.payloadJson)).toMatchObject({
      noPatchAppliedBeyondApprovedDraft: true,
      noCommitCreated: true,
      gateSummary: "passed:6/6",
    });

    const blocked = auditVeraPostPatchQualityGatesBlocked(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      reasonCode: "READINESS_FAILED",
      message: "blocked",
    });
    expect(JSON.parse(blocked.payloadJson)).toMatchObject({
      reasonCode: "READINESS_FAILED",
      noPatchAppliedBeyondApprovedDraft: true,
    });

    expect(requested.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_GATES_REQUESTED,
    );
    expect(completed.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_GATES_COMPLETED,
    );
  });
});
