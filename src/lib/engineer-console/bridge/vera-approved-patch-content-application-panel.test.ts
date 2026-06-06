import { describe, expect, it } from "vitest";
import {
  buildVeraApprovedPatchContentApplicationRequestBody,
  canShowVeraApprovedPatchContentApplicationPanel,
  isVeraApprovedPatchContentApplicationEnabled,
  resolveVeraApprovedPatchContentApplicationUiOutcome,
} from "@/components/engineer-console/vera-approved-patch-content-application-panel";
import { VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE } from "../worker/vera-implementation-patch-content-draft-types";
import type { EngineeringRun } from "../types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "../worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP } from "../worker/vera-implementation-patch-content-draft-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
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
      veraImplementationPatchContentDraftReviewDecision: "approved",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToApplyApprovedPatchContent: true,
  reasonCodes: [],
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  draftPath: "/tmp/draft.json",
  draftHash: "abc",
  entryCount: 1,
  worktreePath: "/tmp/worktree",
  targetFiles: [{ filePath: "docs/operations/vera-2q-smoke.md", action: "create" }],
};

describe("VeraApprovedPatchContentApplicationPanel helpers", () => {
  it("shows panel for implementation_patch_content_draft_approved runs", () => {
    expect(canShowVeraApprovedPatchContentApplicationPanel(veraRun())).toBe(true);
  });

  it("shows panel when patch application governance exists", () => {
    expect(
      canShowVeraApprovedPatchContentApplicationPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchApplicationStatus: "patch_applied",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables application when readiness passes", () => {
    expect(isVeraApprovedPatchContentApplicationEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables application when patch already applied", () => {
    expect(
      isVeraApprovedPatchContentApplicationEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraImplementationPatchApplicationStatus: "patch_applied",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("resolves applied state", () => {
    expect(
      resolveVeraApprovedPatchContentApplicationUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP }),
      }).success,
    ).toContain("remain gated");
  });
});

describe("VeraApprovedPatchContentApplicationPanel request body", () => {
  it("submits the exact confirmation string without trimming", () => {
    const exactPhrase = VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE;
    expect(
      buildVeraApprovedPatchContentApplicationRequestBody({
        confirmationText: exactPhrase,
      }).confirmationText,
    ).toBe(exactPhrase);
  });

  it.each([
    ["leading space", " APPLY APPROVED VERA PATCH CONTENT DRAFT"],
    ["trailing space", "APPLY APPROVED VERA PATCH CONTENT DRAFT "],
    ["double space", "APPLY APPROVED VERA PATCH CONTENT  DRAFT"],
    ["missing space", "APPLY APPROVED VERA PATCH CONTENTDRAFT"],
    ["lowercase", "apply approved vera patch content draft"],
  ] as const)("preserves %s in confirmation payload", (_label, confirmationText) => {
    expect(
      buildVeraApprovedPatchContentApplicationRequestBody({ confirmationText })
        .confirmationText,
    ).toBe(confirmationText);
  });
});
