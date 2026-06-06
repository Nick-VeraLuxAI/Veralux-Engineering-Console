import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationPatchProposalReviewPanel,
  isVeraPatchProposalReviewEnabled,
  resolveVeraPatchProposalReviewUiOutcome,
} from "@/components/engineer-console/vera-implementation-patch-proposal-review-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP,
} from "../worker/vera-implementation-patch-proposal-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      veraImplementationPatchProposalPath: "/tmp/proposal.json",
      veraImplementationPatchProposalHash: "2ba8937bee6de59bc3d1613df0330ba1960b7030e02cd37ae50f25c5e94a320d",
    }),
    ...overrides,
  };
}

const readiness = {
  safeToReviewPatchProposal: true,
  reasons: [],
  checks: [],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  proposalPath: "/tmp/proposal.json",
  proposalHash: "2ba8937bee6de59bc3d1613df0330ba1960b7030e02cd37ae50f25c5e94a320d",
  proposalSummary: "Deterministic proposal summary.",
};

describe("VeraImplementationPatchProposalReviewPanel helpers", () => {
  it("shows review panel for implementation_patch_proposal_ready runs", () => {
    expect(canShowVeraImplementationPatchProposalReviewPanel(veraRun())).toBe(true);
  });

  it("enables review only when readiness passes and no decision exists", () => {
    expect(isVeraPatchProposalReviewEnabled(veraRun(), readiness)).toBe(true);
    expect(
      isVeraPatchProposalReviewEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchProposalReviewDecision: "approved",
          }),
          currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
        }),
        readiness,
      ),
    ).toBe(false);
  });

  it("shows approved state without duplicate controls", () => {
    expect(
      canShowVeraImplementationPatchProposalReviewPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchProposalReviewDecision: "approved",
          }),
        }),
      ),
    ).toBe(true);
    expect(
      resolveVeraPatchProposalReviewUiOutcome({
        apiOk: true,
        decision: "approved",
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP }),
      }).success,
    ).toContain("remain gated");
  });

  it("shows rejected state", () => {
    expect(
      resolveVeraPatchProposalReviewUiOutcome({
        apiOk: true,
        decision: "rejected",
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP }),
      }).success,
    ).toContain("rejected");
  });
});
