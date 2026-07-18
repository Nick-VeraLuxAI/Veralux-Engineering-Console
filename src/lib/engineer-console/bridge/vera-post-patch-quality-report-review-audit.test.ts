import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraPostPatchQualityReportApproved,
  auditVeraPostPatchQualityReportRejected,
  auditVeraPostPatchQualityReportReviewBlocked,
  auditVeraPostPatchQualityReportReviewRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-2u-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera post-patch quality report review audit payloads", () => {
  it("includes gated safety flags and no commit proposal on review events", () => {
    const requested = auditVeraPostPatchQualityReportReviewRequested(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      decision: "approved",
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      qualityReportPath: "/tmp/quality-report.json",
      qualityReportHash: "abc123",
      gateCount: 8,
      overallStatus: "passed",
    });
    expect(JSON.parse(requested.payloadJson)).toMatchObject({
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
      noCommitProposalCreated: true,
      gateCount: 8,
    });

    const approved = auditVeraPostPatchQualityReportApproved(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      qualityReportPath: "/tmp/quality-report.json",
      qualityReportHash: "abc123",
      gateCount: 8,
      overallStatus: "passed",
    });
    expect(JSON.parse(approved.payloadJson)).toMatchObject({
      decision: "approved",
      noCommitProposalCreated: true,
      noCommitCreated: true,
    });

    const rejected = auditVeraPostPatchQualityReportRejected(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      qualityReportPath: "/tmp/quality-report.json",
      qualityReportHash: "abc123",
    });
    expect(JSON.parse(rejected.payloadJson)).toMatchObject({
      decision: "rejected",
      noCommitCreated: true,
    });

    const blocked = auditVeraPostPatchQualityReportReviewBlocked(TASK_ID, RUN_ID, {
      reviewer: "operator@test",
      decision: "approved",
      reasonCode: "CONFIRMATION_INVALID",
      message: "blocked",
    });
    expect(JSON.parse(blocked.payloadJson)).toMatchObject({
      reasonCode: "CONFIRMATION_INVALID",
      noCommitProposalCreated: true,
    });

    expect(requested.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_REVIEW_REQUESTED,
    );
    expect(approved.eventType).toBe(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_APPROVED);
    expect(rejected.eventType).toBe(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_REJECTED);
    expect(blocked.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_REVIEW_BLOCKED,
    );
  });
});
