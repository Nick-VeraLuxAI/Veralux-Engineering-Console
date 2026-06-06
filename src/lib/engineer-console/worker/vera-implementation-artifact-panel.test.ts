import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationArtifactPanel,
  resolveVeraImplementationArtifactHeadline,
} from "@/components/engineer-console/vera-implementation-artifact-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
  type VeraImplementationWorkerArtifact,
} from "./vera-implementation-artifact-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "db68f74f-add8-4065-8c1e-4caa4fcb9705",
    taskId: "6b4bf42a-a24d-4e36-a285-ddc803db9293",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: "artifact ready",
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
      veraImplementationArtifactPath: "/tmp/artifact.json",
    }),
    ...overrides,
  };
}

const artifact: VeraImplementationWorkerArtifact = {
  runId: "db68f74f-add8-4065-8c1e-4caa4fcb9705",
  taskId: "6b4bf42a-a24d-4e36-a285-ddc803db9293",
  veraWorkOrderId: "34d51430-df8c-48ee-a43c-6bb8a2084be8",
  createdAt: new Date().toISOString(),
  workerMode: "deterministic_metadata",
  workerStatus: "artifact_created",
  branchName: "engineer/test",
  repoPath: "/tmp/repo",
  worktreePath: "/tmp/repo",
  taskTitle: "[Vera WO]",
  taskInstructionsExcerpt: "instructions",
  implementationSummary: "summary",
  interpretedObjective: "objective",
  proposedNextActions: ["review"],
  blockers: [],
  warnings: [],
  filesInspected: [],
  filesChanged: [],
  filesProposed: [],
  patchProposalPath: null,
  evidencePath: null,
  noPrCreated: true,
  noMergePerformed: true,
  noDeploymentPerformed: true,
  noReleasePerformed: true,
};

describe("VeraImplementationArtifactPanel helpers", () => {
  it("shows panel for Vera runs with implementation artifact", () => {
    expect(canShowVeraImplementationArtifactPanel(veraRun(), artifact)).toBe(true);
    expect(
      canShowVeraImplementationArtifactPanel(
        veraRun({ currentStep: VERA_IMPLEMENTATION_ARTIFACT_READY_STEP }),
        null,
      ),
    ).toBe(true);
  });

  it("shows blocked headline for blocked worker result", () => {
    expect(
      resolveVeraImplementationArtifactHeadline({
        ...artifact,
        workerStatus: "blocked",
        blockers: ["blocked"],
      }),
    ).toBe("Implementation worker blocked");
  });

  it("does not show panel for non-Vera runs", () => {
    expect(
      canShowVeraImplementationArtifactPanel(
        veraRun({
          governanceNotes: JSON.stringify({}),
          currentStep: VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP,
        }),
        null,
      ),
    ).toBe(false);
  });
});
