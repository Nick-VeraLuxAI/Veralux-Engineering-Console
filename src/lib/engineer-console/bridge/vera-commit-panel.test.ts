import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVeraCommitRequestBody,
  canShowVeraCommitPanel,
  isVeraCommitCreateEnabled,
  resolveVeraCommitUiOutcome,
} from "@/components/engineer-console/vera-commit-panel";
import type { EngineeringRun } from "../types";
import { VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP } from "../worker/vera-commit-proposal-types";
import {
  VERA_COMMIT_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
} from "../worker/vera-commit-report-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "de55cd29-f13e-4011-a6cd-b4ddbad23642",
    taskId: "e4962d98-64ab-4fd7-9f06-583bf211a840",
    status: "waiting_for_approval",
    branchName: "engineer/e4962d98/de55cd29-20260718185517",
    currentStep: VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "b8c59beb-7572-445d-9665-ab66c5c661a3",
      veraCommitProposalStatus: "proposal_created",
      veraCommitProposalPath: "/tmp/proposal.json",
      veraCommitProposalHash: "10bbb740",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToCreateCommit: true,
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "b8c59beb-7572-445d-9665-ab66c5c661a3",
  commitProposalPath: "/tmp/proposal.json",
  commitProposalHash: "10bbb740",
  targetRepoPath: "/tmp/repo",
  branchName: "engineer/e4962d98/de55cd29-20260718185517",
  parentHeadSha: "29464cf7b9f2e456aa43f9e32f13c7d20c170018",
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

describe("VeraCommitPanel helpers", () => {
  it("shows panel for commit-proposal-ready runs", () => {
    expect(canShowVeraCommitPanel(veraRun())).toBe(true);
  });

  it("shows panel when commit already exists", () => {
    expect(
      canShowVeraCommitPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraCommitProposalStatus: "proposal_created",
            veraCommitProposalPath: "/tmp/proposal.json",
            veraCommitStatus: "commit_created",
            veraCommitReportPath: "/tmp/report.json",
            veraCommitSha: "abcdef",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables create when readiness passes", () => {
    expect(isVeraCommitCreateEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables create when commit already exists", () => {
    expect(
      isVeraCommitCreateEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraCommitProposalStatus: "proposal_created",
            veraCommitStatus: "commit_created",
            veraCommitReportPath: "/tmp/report.json",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("builds request body without trimming confirmation", () => {
    expect(
      buildVeraCommitRequestBody({
        confirmationText: `${VERA_COMMIT_CONFIRMATION} `,
        note: "  note  ",
      }),
    ).toEqual({
      confirmationText: `${VERA_COMMIT_CONFIRMATION} `,
      note: "note",
    });
  });

  it("resolves success only when step advances", () => {
    expect(
      resolveVeraCommitUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_COMMIT_CREATED_STEP }),
      }).success,
    ).toContain("Vera commit created");
    expect(
      resolveVeraCommitUiOutcome({
        apiOk: true,
        run: veraRun(),
      }).error,
    ).toContain("did not persist");
  });

  it("panel source states local-commit-only boundary copy", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/engineer-console/vera-commit-panel.tsx"),
      "utf8",
    );
    expect(source).toContain("This creates a local commit only.");
    expect(source).toContain("It stages only approved proposal files.");
    expect(source).toContain("It does not push.");
    expect(source).toContain("It does not create PRs.");
    expect(source).toContain("It does not merge.");
    expect(source).toContain("It does not deploy.");
    expect(source).toContain("It does not release.");
    expect(source).toContain("Exact operator input — no trim.");
    expect(source).toContain("VERA_COMMIT_CONFIRMATION");
    expect(source).toContain("VERA_PULL_REQUEST_PREPARE_CONFIRMATION");
  });
});
