import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  auditVeraImplementationArtifactApproved,
  auditVeraImplementationArtifactRejected,
  auditVeraImplementationArtifactReviewBlocked,
  auditVeraImplementationArtifactReviewRequested,
} from "./vera-handoff-audit-lifecycle";

const TASK_ID = "163ddfec-7f47-4732-9125-cc21d9c2e3aa";
const RUN_ID = "93c1403c-e39e-4ca9-b21c-f3898521a122";

const EXPECTED_PAYLOAD = {
  noCommitCreated: true,
  noPullRequestCreated: true,
  noMergePerformed: true,
  noDeploymentPerformed: true,
  noReleasePerformed: true,
};

beforeEach(() => {
  const tmpDb = `/tmp/engineer-console-vera-review-audit-${Date.now()}.db`;
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

describe("Vera artifact review audit payloads", () => {
  it("includes release-gated flags on worker review events", () => {
    const events = [
      auditVeraImplementationArtifactReviewRequested(TASK_ID, RUN_ID, {
        reviewer: "operator@test",
        decision: "approved",
        veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      }),
      auditVeraImplementationArtifactApproved(TASK_ID, RUN_ID, {
        reviewer: "operator@test",
        veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      }),
      auditVeraImplementationArtifactRejected(TASK_ID, RUN_ID, {
        reviewer: "operator@test",
        veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      }),
      auditVeraImplementationArtifactReviewBlocked(TASK_ID, RUN_ID, {
        reviewer: "operator@test",
        decision: "approved",
        reasonCode: "READINESS_FAILED",
        message: "blocked",
      }),
    ];

    for (const event of events) {
      expect(JSON.parse(event.payloadJson)).toMatchObject(EXPECTED_PAYLOAD);
    }

    expect(events[0]?.eventType).toBe(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_ARTIFACT_REVIEW_REQUESTED,
    );
  });
});
