import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraImplementationPatchContentDraftBlocked,
  auditVeraImplementationPatchContentDraftCreated,
  auditVeraImplementationPatchContentDraftRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-draft-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera patch content draft audit payloads", () => {
  it("includes gated safety flags on draft events", () => {
    const requested = auditVeraImplementationPatchContentDraftRequested(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      sourceProposalPath: "/tmp/proposal.json",
      sourceProposalHash: "abc123",
      entryCount: 1,
    });
    expect(JSON.parse(requested.payloadJson)).toMatchObject({
      noPatchApplied: true,
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
      entryCount: 1,
    });

    const created = auditVeraImplementationPatchContentDraftCreated(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      draftPath: "/tmp/draft.json",
      draftHash: "def456",
      entryCount: 1,
    });
    expect(JSON.parse(created.payloadJson)).toMatchObject({
      draftPath: "/tmp/draft.json",
      draftHash: "def456",
      noPatchApplied: true,
    });

    const blocked = auditVeraImplementationPatchContentDraftBlocked(TASK_ID, RUN_ID, {
      requestedBy: "operator@test",
      reasonCode: "PATCH_CONTENT_DRAFT_ALREADY_EXISTS",
      message: "blocked",
    });
    expect(JSON.parse(blocked.payloadJson)).toMatchObject({
      reasonCode: "PATCH_CONTENT_DRAFT_ALREADY_EXISTS",
      noPatchApplied: true,
    });

    expect(requested.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REQUESTED,
    );
    expect(created.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_CREATED,
    );
  });
});
