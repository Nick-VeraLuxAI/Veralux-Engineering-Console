import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationPatchContentDraftPanel,
  isVeraPatchContentDraftCreationEnabled,
  resolveVeraPatchContentDraftUiOutcome,
} from "@/components/engineer-console/vera-implementation-patch-content-draft-panel";
import type { EngineeringRun } from "../types";
import { VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP } from "../worker/vera-implementation-patch-content-draft-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP } from "../worker/vera-implementation-patch-proposal-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToCreatePatchContentDraft: true,
  reasonCodes: [],
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  sourceProposalPath: "/tmp/proposal.json",
  sourceProposalHash: "abc",
  existingDraftPath: null,
  existingDraftHash: null,
  patchAlreadyApplied: false,
};

describe("VeraImplementationPatchContentDraftPanel helpers", () => {
  it("shows panel for implementation_patch_proposal_approved runs", () => {
    expect(canShowVeraImplementationPatchContentDraftPanel(veraRun())).toBe(true);
  });

  it("shows panel when draft ready step is recorded", () => {
    expect(
      canShowVeraImplementationPatchContentDraftPanel(
        veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP }),
      ),
    ).toBe(true);
  });

  it("enables creation when readiness passes", () => {
    expect(isVeraPatchContentDraftCreationEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables creation when draft already exists", () => {
    expect(
      isVeraPatchContentDraftCreationEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchContentDraftPath: "/tmp/draft.json",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("resolves created state", () => {
    expect(
      resolveVeraPatchContentDraftUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP }),
      }).success,
    ).toContain("remain gated");
  });
});
