import { describe, expect, it } from "vitest";
import {
  buildVeraPostPatchQualityGatesRequestBody,
  canShowVeraPostPatchQualityGatesPanel,
  isVeraPostPatchQualityGatesEnabled,
  resolveVeraPostPatchQualityGatesUiOutcome,
} from "@/components/engineer-console/vera-post-patch-quality-gates-panel";
import type { EngineeringRun } from "../types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "../worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP } from "../worker/vera-post-patch-quality-report-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "93c1403c-e39e-4ca9-b21c-f3898521a122",
    taskId: "163ddfec-7f47-4732-9125-cc21d9c2e3aa",
    status: "waiting_for_approval",
    branchName: "engineer/test",
    currentStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
      veraImplementationPatchApplicationStatus: "patch_applied",
      veraImplementationPatchApplicationPath: "/tmp/application-report.json",
      veraImplementationPatchApplicationHash: "abc",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToRunPostPatchQualityGates: true,
  reasonCodes: [],
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "7b966c82-42e2-4fc8-918a-6e66a703a2de",
  applicationReportPath: "/tmp/application-report.json",
  applicationReportHash: "abc",
  appliedFiles: ["docs/operations/vera-2q-smoke.md"],
};

describe("VeraPostPatchQualityGatesPanel helpers", () => {
  it("shows panel for implementation_patch_applied runs", () => {
    expect(canShowVeraPostPatchQualityGatesPanel(veraRun())).toBe(true);
  });

  it("shows panel when quality governance exists", () => {
    expect(
      canShowVeraPostPatchQualityGatesPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraPostPatchQualityStatus: "completed",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables gates when readiness passes", () => {
    expect(isVeraPostPatchQualityGatesEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables gates when quality report already exists", () => {
    expect(
      isVeraPostPatchQualityGatesEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraPostPatchQualityStatus: "completed",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("resolves completed state", () => {
    expect(
      resolveVeraPostPatchQualityGatesUiOutcome({
        apiOk: true,
        run: veraRun({
          currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
        }),
      }).success,
    ).toContain("remain gated");
  });
});

describe("VeraPostPatchQualityGatesPanel request body", () => {
  it("submits the exact confirmation string without trimming", () => {
    expect(
      buildVeraPostPatchQualityGatesRequestBody({
        confirmationText: VERA_POST_PATCH_GATE_CONFIRMATION,
      }).confirmationText,
    ).toBe(VERA_POST_PATCH_GATE_CONFIRMATION);
  });

  it.each([
    ["leading space", " RUN VERA POST-PATCH QUALITY GATES"],
    ["trailing space", "RUN VERA POST-PATCH QUALITY GATES "],
    ["lowercase", "run vera post-patch quality gates"],
  ] as const)("preserves %s in confirmation payload", (_label, confirmationText) => {
    expect(
      buildVeraPostPatchQualityGatesRequestBody({ confirmationText }).confirmationText,
    ).toBe(confirmationText);
  });
});
