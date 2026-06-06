import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationPatchProposalPanel,
  isVeraPatchProposalCreationEnabled,
  resolveVeraPatchProposalUiOutcome,
} from "@/components/engineer-console/vera-implementation-patch-proposal-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
} from "../worker/vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP } from "../worker/vera-implementation-patch-proposal-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      veraImplementationArtifactHash: "f71694e28a07b40def1abd33a77e053b0403d744102eb4f76aefc75c6de500a1",
      veraImplementationArtifactReviewDecision: "approved",
    }),
    ...overrides,
  };
}

const readiness = {
  safeToCreateProposal: true,
  reasons: [],
  checks: [],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  sourceArtifactPath: "/tmp/artifact.json",
  sourceArtifactHash: "f71694e28a07b40def1abd33a77e053b0403d744102eb4f76aefc75c6de500a1",
};

describe("VeraImplementationPatchProposalPanel helpers", () => {
  it("shows panel after artifact approved", () => {
    expect(canShowVeraImplementationPatchProposalPanel(veraRun())).toBe(true);
  });

  it("shows panel when proposal already exists", () => {
    expect(
      canShowVeraImplementationPatchProposalPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchProposalPath: "/tmp/proposal.json",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables creation only when readiness passes and no proposal exists", () => {
    expect(isVeraPatchProposalCreationEnabled(veraRun(), readiness)).toBe(true);
    expect(
      isVeraPatchProposalCreationEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationArtifactReviewDecision: "approved",
            veraImplementationPatchProposalPath: "/tmp/proposal.json",
          }),
          currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
        }),
        readiness,
      ),
    ).toBe(false);
  });

  it("resolves proposal-created state", () => {
    expect(
      resolveVeraPatchProposalUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP }),
      }).success,
    ).toContain("remain gated");
  });
});
