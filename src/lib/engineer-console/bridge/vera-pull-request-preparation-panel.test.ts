import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildVeraPullRequestPreparationRequestBody,
  canShowVeraPullRequestPreparationPanel,
  isVeraPullRequestPreparationEnabled,
  resolveVeraPullRequestPreparationUiOutcome,
} from "@/components/engineer-console/vera-pull-request-preparation-panel";
import type { EngineeringRun } from "../types";
import { VERA_IMPLEMENTATION_COMMIT_CREATED_STEP } from "../worker/vera-commit-report-types";
import {
  VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
} from "../worker/vera-pull-request-preparation-types";

function veraRun(overrides: Partial<EngineeringRun> = {}): EngineeringRun {
  return {
    id: "de55cd29-f13e-4011-a6cd-b4ddbad23642",
    taskId: "e4962d98-64ab-4fd7-9f06-583bf211a840",
    status: "waiting_for_approval",
    branchName: "engineer/e4962d98/de55cd29-20260718185517",
    currentStep: VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
    modelRole: "engineer",
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentMessage: null,
    riskLevel: "low",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: "b8c59beb-7572-445d-9665-ab66c5c661a3",
      veraCommitStatus: "commit_created",
      veraCommitReportPath: "/tmp/report.json",
      veraCommitReportHash: "2ff5b4ae",
      veraCommitSha: "7e56ef5686811e7a0bf45c1ca6a2c0a60c45742f",
    }),
    ...overrides,
  };
}

const readyReadiness = {
  safeToPreparePullRequest: true,
  reasons: [],
  checks: [{ id: "ok", ok: true, message: "Ready." }],
  veraWorkOrderId: "b8c59beb-7572-445d-9665-ab66c5c661a3",
  commitReportPath: "/tmp/report.json",
  commitReportHash: "2ff5b4ae",
  commitSha: "7e56ef5686811e7a0bf45c1ca6a2c0a60c45742f",
  parentHeadSha: "29464cf7b9f2e456aa43f9e32f13c7d20c170018",
  baseBranch: "main",
  headBranch: "engineer/e4962d98/de55cd29-20260718185517",
  proposedPrFiles: [
    {
      path: "docs/operations/vera-2u-recovery-smoke.md",
      sha256: "1a06f88d",
    },
  ],
  excludedDirtyFiles: ["docs/operations/noise.md"],
  dirtyWorkingTreeSummary: "Unrelated dirty files are intentionally excluded.",
};

describe("VeraPullRequestPreparationPanel helpers", () => {
  it("shows panel for commit-created runs", () => {
    expect(canShowVeraPullRequestPreparationPanel(veraRun())).toBe(true);
  });

  it("shows panel when preparation already exists", () => {
    expect(
      canShowVeraPullRequestPreparationPanel(
        veraRun({
          currentStep: VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraCommitStatus: "commit_created",
            veraPullRequestPreparationStatus: "preparation_created",
            veraPullRequestPreparationPath: "/tmp/pr-prep.json",
          }),
        }),
      ),
    ).toBe(true);
  });

  it("enables prepare when readiness passes", () => {
    expect(isVeraPullRequestPreparationEnabled(veraRun(), readyReadiness)).toBe(true);
  });

  it("disables prepare when preparation already exists", () => {
    expect(
      isVeraPullRequestPreparationEnabled(
        veraRun({
          governanceNotes: JSON.stringify({
            veraHandoff: true,
            veraCommitStatus: "commit_created",
            veraPullRequestPreparationStatus: "preparation_created",
            veraPullRequestPreparationPath: "/tmp/pr-prep.json",
          }),
        }),
        readyReadiness,
      ),
    ).toBe(false);
  });

  it("builds request body without trimming confirmation", () => {
    expect(
      buildVeraPullRequestPreparationRequestBody({
        confirmationText: `${VERA_PULL_REQUEST_PREPARATION_CONFIRMATION} `,
        note: "  note  ",
      }),
    ).toEqual({
      confirmationText: `${VERA_PULL_REQUEST_PREPARATION_CONFIRMATION} `,
      note: "note",
    });
  });

  it("resolves success only when step advances", () => {
    expect(
      resolveVeraPullRequestPreparationUiOutcome({
        apiOk: true,
        run: veraRun({ currentStep: VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP }),
      }).success,
    ).toContain("PR preparation ready");
    expect(
      resolveVeraPullRequestPreparationUiOutcome({
        apiOk: true,
        run: veraRun(),
      }).error,
    ).toContain("did not persist");
  });

  it("panel source states metadata-only boundary copy", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/components/engineer-console/vera-pull-request-preparation-panel.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("This prepares pull request metadata only.");
    expect(source).toContain("It does not push.");
    expect(source).toContain("It does not call GitHub.");
    expect(source).toContain("It does not create PRs.");
    expect(source).toContain("It does not merge.");
    expect(source).toContain("It does not deploy.");
    expect(source).toContain("It does not release.");
    expect(source).toContain("Exact operator input — no trim.");
    expect(source).toContain("VERA_PULL_REQUEST_PREPARATION_CONFIRMATION");
    expect(source).toContain("VERA_PULL_REQUEST_CREATE_CONFIRMATION");
  });
});
