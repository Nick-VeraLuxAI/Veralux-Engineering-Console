import { describe, expect, it } from "vitest";
import {
  canShowVeraHandoffPreparePanel,
  isVeraHandoffPrepareEnabled,
  resolveVeraHandoffPrepareUiOutcome,
} from "@/components/engineer-console/vera-handoff-task-panel";
import type { EngineeringRun, EngineeringTask } from "../types";
import type { VeraHandoffTaskAnalysis } from "./vera-handoff-task-types";

function baseTask(): EngineeringTask {
  return {
    id: "6b4bf42a-a24d-4e36-a285-ddc803db9293",
    title: "[Vera WO] Smoke",
    description: "## Engineering request from VeraLux OS",
    targetRepoPath: "/tmp/repo",
    registeredRepoId: null,
    status: "draft",
    priority: "normal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function baseAnalysis(overrides: Partial<VeraHandoffTaskAnalysis> = {}): VeraHandoffTaskAnalysis {
  return {
    isVeraLuxOsHandoffTask: true,
    source: "veralux-os",
    veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
    nonExecutionNotePresent: true,
    taskIsDraft: true,
    repoBindingPresent: true,
    repoPath: "/tmp/repo",
    safeToPrepareRun: true,
    blockers: [],
    ...overrides,
  };
}

describe("VeraHandoffTaskPanel helpers", () => {
  it("renders panel only for Vera handoff tasks", () => {
    expect(canShowVeraHandoffPreparePanel(baseAnalysis())).toBe(true);
    expect(
      canShowVeraHandoffPreparePanel(baseAnalysis({ isVeraLuxOsHandoffTask: false })),
    ).toBe(false);
  });

  it("disables prepare when run already exists or readiness fails", () => {
    const preparedRun: EngineeringRun = {
      id: "00000000-0000-4000-8000-000000000099",
      taskId: baseTask().id,
      status: "pending",
      branchName: null,
      currentStep: "vera_implementation_prepared",
      modelRole: "engineer",
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      agentMessage: null,
      riskLevel: null,
      governanceNotes: null,
    };
    expect(isVeraHandoffPrepareEnabled(baseAnalysis(), null)).toBe(true);
    expect(isVeraHandoffPrepareEnabled(baseAnalysis(), preparedRun)).toBe(false);
    expect(
      isVeraHandoffPrepareEnabled(baseAnalysis({ safeToPrepareRun: false }), null),
    ).toBe(false);
  });

  it("does not show success without persisted run id", () => {
    expect(
      resolveVeraHandoffPrepareUiOutcome({ apiOk: false, apiMessage: "Rejected" }).success,
    ).toBeNull();
    expect(resolveVeraHandoffPrepareUiOutcome({ apiOk: true }).error).toContain("persisted run");
    expect(
      resolveVeraHandoffPrepareUiOutcome({
        apiOk: true,
        runId: "00000000-0000-4000-8000-0000000000ab",
      }).success,
    ).toContain("execution still gated");
  });
});
