import { describe, expect, it } from "vitest";
import {
  canShowVeraExecutionApprovalPanel,
  isVeraExecutionApprovalRequestEnabled,
  resolveVeraExecutionApprovalUiOutcome,
} from "@/components/engineer-console/vera-execution-approval-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "db68f74f-add8-4065-8c1e-4caa4fcb9705",
    taskId: "6b4bf42a-a24d-4e36-a285-ddc803db9293",
    status: "pending",
    branchName: null,
    currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: null,
    completedAt: null,
    agentMessage: null,
    riskLevel: null,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
    }),
    ...overrides,
  };
}

describe("VeraExecutionApprovalPanel helpers", () => {
  it("renders panel for Vera prepared and approval-requested runs", () => {
    expect(canShowVeraExecutionApprovalPanel(veraRun())).toBe(true);
    expect(
      canShowVeraExecutionApprovalPanel(
        veraRun({ currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP }),
      ),
    ).toBe(true);
    expect(canShowVeraExecutionApprovalPanel(veraRun({ governanceNotes: null }))).toBe(false);
  });

  it("enables request only when readiness passes and approval not yet requested", () => {
    const readiness = {
      safeToRequestExecutionApproval: true,
      reasons: [],
      checks: [],
      veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
      repoPath: "/tmp/repo",
    };
    expect(isVeraExecutionApprovalRequestEnabled(veraRun(), readiness)).toBe(true);
    expect(
      isVeraExecutionApprovalRequestEnabled(
        veraRun({ currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP }),
        readiness,
      ),
    ).toBe(false);
  });

  it("shows success only when approval-requested step persisted", () => {
    expect(
      resolveVeraExecutionApprovalUiOutcome({
        apiOk: true,
        run: veraRun(),
      }).error,
    ).toContain("did not persist");
    expect(
      resolveVeraExecutionApprovalUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP }),
      }).success,
    ).toContain("no code executed");
  });
});
