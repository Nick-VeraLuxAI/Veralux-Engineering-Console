import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVeraCommitProposalRequestBody,
  canShowVeraCommitProposalPanel,
  isVeraCommitProposalPrepareEnabled,
  resolveVeraCommitProposalUiOutcome,
} from "@/components/engineer-console/vera-commit-proposal-panel";
import type { EngineeringRun } from "../types";
import {
  VERA_COMMIT_PROPOSAL_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
} from "../worker/vera-commit-proposal-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP } from "../worker/vera-post-patch-quality-report-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "de55cd29-f13e-4011-a6cd-b4ddbad23642",
    taskId: "e4962d98-64ab-4fd7-9f06-583bf211a840",
    status: "waiting_for_approval",
    branchName: "engineer/e4962d98/de55cd29-20260718185517",
    currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "b8c59beb-7572-445d-9665-ab66c5c661a3",
      veraPostPatchQualityReportReviewDecision: "approved",
      veraPostPatchQualityReportApprovedHash: "c6625c81",
      veraImplementationPatchApplicationHash: "404c428e",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToPrepareCommitProposal: true,
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "b8c59beb-7572-445d-9665-ab66c5c661a3",
  applicationReportPath: "/tmp/application.json",
  applicationReportHash: "404c428e",
  qualityReportPath: "/tmp/quality.json",
  qualityReportHash: "c6625c81",
  approvedQualityReportHash: "c6625c81",
  proposedFiles: [
    {
      path: "docs/operations/vera-2u-recovery-smoke.md",
      status: "added",
      sha256: "1a06f88d",
    },
  ],
  excludedDirtyFiles: ["docs/operations/noise.md"],
  dirtyWorkingTreeSummary: "Unrelated dirty files are intentionally excluded.",
};

describe("VeraCommitProposalPanel helpers", () => {
  it("shows panel for quality-report-approved runs", () => {
    expect(canShowVeraCommitProposalPanel(veraRun())).toBe(true);
  });

  it("shows panel when proposal already exists", () => {
    expect(
      canShowVeraCommitProposalPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraCommitProposalStatus: "proposal_created",
            veraCommitProposalPath: "/tmp/proposal.json",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables prepare when readiness passes", () => {
    expect(isVeraCommitProposalPrepareEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables prepare when proposal already exists", () => {
    expect(
      isVeraCommitProposalPrepareEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraCommitProposalStatus: "proposal_created",
            veraCommitProposalPath: "/tmp/proposal.json",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("builds request body without trimming confirmation", () => {
    expect(
      buildVeraCommitProposalRequestBody({
        confirmationText: `${VERA_COMMIT_PROPOSAL_CONFIRMATION} `,
        note: "  note  ",
      }),
    ).toEqual({
      confirmationText: `${VERA_COMMIT_PROPOSAL_CONFIRMATION} `,
      note: "note",
    });
  });

  it("resolves success only when step advances", () => {
    expect(
      resolveVeraCommitProposalUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP }),
      }).success,
    ).toContain("Commit proposal ready");
    expect(
      resolveVeraCommitProposalUiOutcome({
        apiOk: true,
        run: veraRun(),
      }).error,
    ).toContain("did not persist");
  });

  it("panel source states proposal-only boundary copy", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/engineer-console/vera-commit-proposal-panel.tsx"),
      "utf8",
    );
    expect(source).toContain("This prepares a commit proposal only.");
    expect(source).toContain("It does not stage.");
    expect(source).toContain("It does not commit.");
    expect(source).toContain("It does not push.");
    expect(source).toContain("It does not create PRs.");
    expect(source).toContain("It does not merge.");
    expect(source).toContain("It does not deploy.");
    expect(source).toContain("It does not release.");
    expect(source).toContain("Exact operator input — no trim.");
  });
});
