import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationArtifactReviewPanel,
  isVeraArtifactReviewEnabled,
  resolveVeraArtifactReviewUiOutcome,
} from "@/components/engineer-console/vera-implementation-artifact-review-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP,
} from "../worker/vera-implementation-artifact-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      veraImplementationArtifactPath: "/tmp/artifact.json",
    }),
    ...overrides,
  };
}

const readiness = {
  safeToReviewArtifact: true,
  reasons: [],
  checks: [],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  artifactPath: "/tmp/artifact.json",
  artifactHash: "abc",
};

describe("VeraImplementationArtifactReviewPanel helpers", () => {
  it("shows review panel for implementation_artifact_ready runs", () => {
    expect(canShowVeraImplementationArtifactReviewPanel(veraRun())).toBe(true);
  });

  it("enables review only when readiness passes and no decision exists", () => {
    expect(isVeraArtifactReviewEnabled(veraRun(), readiness)).toBe(true);
    expect(
      isVeraArtifactReviewEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationArtifactReviewDecision: "approved",
          }),
          currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
        }),
        readiness,
      ),
    ).toBe(false);
  });

  it("shows approved state without duplicate controls", () => {
    expect(
      canShowVeraImplementationArtifactReviewPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationArtifactReviewDecision: "approved",
          }),
        }),
      ),
    ).toBe(true);
    expect(
      resolveVeraArtifactReviewUiOutcome({
        apiOk: true,
        decision: "approved",
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP }),
      }).success,
    ).toContain("remain gated");
  });

  it("shows rejected state", () => {
    expect(
      resolveVeraArtifactReviewUiOutcome({
        apiOk: true,
        decision: "rejected",
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP }),
      }).success,
    ).toContain("rejected");
  });
});
