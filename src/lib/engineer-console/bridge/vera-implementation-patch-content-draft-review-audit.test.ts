import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraImplementationPatchContentDraftApproved,
  auditVeraImplementationPatchContentDraftReviewBlocked,
  auditVeraImplementationPatchContentDraftReviewRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-draft-review-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera patch content draft review audit payloads", () => {
  it("includes gated safety flags on review events", () => {
    const requested = auditVeraImplementationPatchContentDraftReviewRequested(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      decision: "approved",
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      draftPath: "/tmp/draft.json",
      draftHash: "abc123",
      entryCount: 1,
      reviewerNote: "2R smoke.",
    });
    expect(JSON.parse(requested.payloadJson)).toMatchObject({
      noPatchApplied: true,
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
      entryCount: 1,
      decision: "approved",
    });

    const approved = auditVeraImplementationPatchContentDraftApproved(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      draftPath: "/tmp/draft.json",
      draftHash: "abc123",
      entryCount: 1,
    });
    expect(JSON.parse(approved.payloadJson)).toMatchObject({
      decision: "approved",
      draftHash: "abc123",
      noPatchApplied: true,
    });

    const blocked = auditVeraImplementationPatchContentDraftReviewBlocked(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      decision: "approved",
      reasonCode: "PATCH_CONTENT_DRAFT_REVIEW_ALREADY_RECORDED",
      message: "blocked",
    });
    expect(JSON.parse(blocked.payloadJson)).toMatchObject({
      reasonCode: "PATCH_CONTENT_DRAFT_REVIEW_ALREADY_RECORDED",
      noPatchApplied: true,
    });

    expect(requested.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_REQUESTED,
    );
    expect(approved.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED,
    );
  });
});
