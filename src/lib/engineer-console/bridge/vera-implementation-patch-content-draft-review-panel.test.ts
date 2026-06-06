import { describe, expect, it } from "vitest";
import {
  canShowVeraImplementationPatchContentDraftReviewPanel,
  isVeraPatchContentDraftReviewEnabled,
  resolveVeraPatchContentDraftReviewUiOutcome,
} from "@/components/engineer-console/vera-implementation-patch-content-draft-review-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP,
} from "../worker/vera-implementation-patch-content-draft-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      veraImplementationPatchContentDraftPath: "/tmp/draft.json",
      veraImplementationPatchContentDraftHash: "abc",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToReviewPatchContentDraft: true,
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  draftPath: "/tmp/draft.json",
  draftHash: "abc",
  draftSummary: {
    entryCount: 1,
    filePaths: ["docs/operations/vera-2q-smoke.md"],
    actions: ["create"],
  },
};

describe("VeraImplementationPatchContentDraftReviewPanel helpers", () => {
  it("shows review panel for implementation_patch_content_draft_ready runs", () => {
    expect(canShowVeraImplementationPatchContentDraftReviewPanel(veraRun())).toBe(true);
  });

  it("shows review panel when review decision exists", () => {
    expect(
      canShowVeraImplementationPatchContentDraftReviewPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchContentDraftReviewDecision: "approved",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables review when readiness passes", () => {
    expect(isVeraPatchContentDraftReviewEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables review when decision already recorded", () => {
    expect(
      isVeraPatchContentDraftReviewEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchContentDraftReviewDecision: "approved",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("resolves approved state", () => {
    expect(
      resolveVeraPatchContentDraftReviewUiOutcome({
        apiOk: true,
        decision: "approved",
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP }),
      }).success,
    ).toContain("remain gated");
  });

  it("resolves rejected state", () => {
    expect(
      resolveVeraPatchContentDraftReviewUiOutcome({
        apiOk: true,
        decision: "rejected",
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP }),
      }).success,
    ).toContain("no patch was applied");
  });
});
