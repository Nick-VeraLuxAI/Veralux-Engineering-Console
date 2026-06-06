import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationPatchApplicationPanel,
  formatVeraPatchApplicationBlockedMessage,
  isVeraPatchApplicationEnabled,
  resolveVeraPatchApplicationUiOutcome,
} from "@/components/engineer-console/vera-implementation-patch-application-panel";
import type { EngineeringRun } from "../types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "../worker/vera-implementation-patch-application-types";
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

const blockedReadiness = {
  safeToApplyPatch: false,
  reasonCodes: ["NO_APPLICABLE_PATCH_CONTENT"],
  reasons: ["Patch proposal has no applicable patch content."],
  checks: [],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  proposalPath: "/tmp/proposal.json",
  proposalHash: "abc",
  worktreePath: "/tmp/worktree",
  applicablePatchCount: 0,
};

describe("VeraImplementationPatchApplicationPanel helpers", () => {
  it("shows panel for implementation_patch_proposal_approved runs", () => {
    expect(canShowVeraImplementationPatchApplicationPanel(veraRun())).toBe(true);
  });

  it("disables application when no applicable patch content", () => {
    expect(isVeraPatchApplicationEnabled(veraRun(), blockedReadiness)).toBe(false);
    expect(formatVeraPatchApplicationBlockedMessage(blockedReadiness)).toContain(
      "No applicable patch content",
    );
  });

  it("resolves applied state", () => {
    expect(
      resolveVeraPatchApplicationUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP }),
      }).success,
    ).toContain("remain gated");
  });
});
