import { describe, expect, it } from "vitest";
import {
  buildVeraPostPatchQualityReportReviewRequestBody,
  canShowVeraPostPatchQualityReportReviewPanel,
  isVeraPostPatchQualityReportReviewEnabled,
  resolveVeraPostPatchQualityReportReviewUiOutcome,
} from "@/components/engineer-console/vera-post-patch-quality-report-review-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
} from "../worker/vera-post-patch-quality-report-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      veraPostPatchQualityStatus: "completed",
      veraPostPatchQualityReportPath: "/tmp/quality-report.json",
      veraPostPatchQualityReportHash: "abc",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToReviewPostPatchQualityReport: true,
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  qualityReportPath: "/tmp/quality-report.json",
  qualityReportHash: "abc",
  reportSummary: {
    overallStatus: "passed",
    validationMode: "deterministic_post_patch_validation",
    gateCount: 8,
    nextGatePhase: "2U",
    nextGateConfirmationRequired: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  },
};

describe("VeraPostPatchQualityReportReviewPanel helpers", () => {
  it("shows panel for quality-gates-completed runs", () => {
    expect(canShowVeraPostPatchQualityReportReviewPanel(veraRun())).toBe(true);
  });

  it("shows panel when prior review decision exists", () => {
    expect(
      canShowVeraPostPatchQualityReportReviewPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraPostPatchQualityReportReviewDecision: "approved",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables review when readiness passes", () => {
    expect(isVeraPostPatchQualityReportReviewEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables review when decision already recorded", () => {
    expect(
      isVeraPostPatchQualityReportReviewEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraPostPatchQualityStatus: "completed",
            veraPostPatchQualityReportReviewDecision: "approved",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("preserves exact confirmation text without trimming", () => {
    const body = buildVeraPostPatchQualityReportReviewRequestBody({
      decision: "approved",
      confirmationText: `${VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION} `,
      note: "  note  ",
    });
    expect(body.confirmationText).toBe(`${VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION} `);
    expect(body.note).toBe("note");
  });

  it("resolves approved UI outcome from persisted step", () => {
    const outcome = resolveVeraPostPatchQualityReportReviewUiOutcome({
      apiOk: true,
      decision: "approved",
      run: veraRun({
        currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
      }),
    });
    expect(outcome.error).toBeNull();
    expect(outcome.success).toContain("No commit");
  });
});
