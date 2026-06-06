import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraImplementationPatchApplicationApplied,
  auditVeraImplementationPatchApplicationBlocked,
  auditVeraImplementationPatchApplicationRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-patch-apply-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera patch application audit payloads", () => {
  it("includes gated safety flags on application events", () => {
    const requested = auditVeraImplementationPatchApplicationRequested(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
    });
    expect(JSON.parse(requested.payloadJson)).toMatchObject({
      noPatchApplied: true,
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
    });

    const blocked = auditVeraImplementationPatchApplicationBlocked(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      reasonCode: "NO_APPLICABLE_PATCH_CONTENT",
      message: "blocked",
    });
    expect(JSON.parse(blocked.payloadJson)).toMatchObject({
      noPatchApplied: true,
      reasonCode: "NO_APPLICABLE_PATCH_CONTENT",
    });

    const applied = auditVeraImplementationPatchApplicationApplied(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      appliedFiles: ["src/example.ts"],
    });
    expect(JSON.parse(applied.payloadJson)).toMatchObject({
      patchApplied: true,
      noCommitCreated: true,
      appliedFiles: ["src/example.ts"],
    });

    expect(requested.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED,
    );
  });
});
