import { describe, expect, it } from "vitest";
import {
  canShowVeraExecutionStartPanel,
  isVeraExecutionStartEnabled,
  resolveVeraExecutionStartUiOutcome,
} from "@/components/engineer-console/vera-execution-start-panel";
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
    currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: null,
    completedAt: null,
    agentMessage: null,
    riskLevel: null,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
      veraExecutionApprovalRequested: true,
    }),
    ...overrides,
  };
}

describe("VeraExecutionStartPanel helpers", () => {
  it("renders start panel for approval-requested Vera runs not yet started", () => {
    expect(canShowVeraExecutionStartPanel(veraRun())).toBe(true);
    expect(
      canShowVeraExecutionStartPanel(veraRun({ currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP })),
    ).toBe(true);
    expect(
      canShowVeraExecutionStartPanel(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraExecutionStartRequested: true,
          }),
        }),
      ),
    ).toBe(false);
  });

  it("enables start only when approval requested and readiness passes", () => {
    const readiness = {
      safeToStartVeraExecution: true,
      reasons: [],
      checks: [],
      veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
      repoPath: "/tmp/repo",
    };
    expect(isVeraExecutionStartEnabled(veraRun(), readiness)).toBe(true);
    expect(
      isVeraExecutionStartEnabled(
        veraRun({ currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP }),
        readiness,
      ),
    ).toBe(false);
  });

  it("does not show success without persisted start marker", () => {
    expect(
      resolveVeraExecutionStartUiOutcome({
        apiOk: true,
        run: veraRun(),
      }).error,
    ).toContain("did not persist");
    expect(
      resolveVeraExecutionStartUiOutcome({
        apiOk: true,
        run: veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraExecutionStartRequested: true,
          }),
        }),
      }).success,
    ).toContain("remain gated");
  });
});
