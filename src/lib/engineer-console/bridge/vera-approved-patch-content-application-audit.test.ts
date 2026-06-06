import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraImplementationApprovedPatchContentApplied,
  auditVeraImplementationApprovedPatchContentApplicationBlocked,
  auditVeraImplementationApprovedPatchContentApplicationRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-2s-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera approved patch content application audit payloads", () => {
  it("includes gated safety flags on application events", () => {
    const requested = auditVeraImplementationApprovedPatchContentApplicationRequested(
      TASK_ID,
      RUN_ID,
      {
        requestedBy: "operator@test",
        veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
        draftPath: "/tmp/draft.json",
        draftHash: "abc123",
        entryCount: 1,
      },
    );
    expect(JSON.parse(requested.payloadJson)).toMatchObject({
      noPatchApplied: true,
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
      entryCount: 1,
    });

    const applied = auditVeraImplementationApprovedPatchContentApplied(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      draftPath: "/tmp/draft.json",
      draftHash: "abc123",
      applicationReportPath: "/tmp/report.json",
      applicationReportHash: "def456",
      appliedFiles: ["docs/operations/vera-2q-smoke.md"],
    });
    expect(JSON.parse(applied.payloadJson)).toMatchObject({
      patchApplied: true,
      noCommitCreated: true,
      appliedFiles: ["docs/operations/vera-2q-smoke.md"],
    });

    const blocked = auditVeraImplementationApprovedPatchContentApplicationBlocked(
      TASK_ID,
      RUN_ID,
      {
        requestedBy: "operator@test",
        reasonCode: "READINESS_FAILED",
        message: "blocked",
      },
    );
    expect(JSON.parse(blocked.payloadJson)).toMatchObject({
      reasonCode: "READINESS_FAILED",
      noPatchApplied: true,
    });

    expect(requested.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_REQUESTED,
    );
    expect(applied.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLIED,
    );
  });
});
