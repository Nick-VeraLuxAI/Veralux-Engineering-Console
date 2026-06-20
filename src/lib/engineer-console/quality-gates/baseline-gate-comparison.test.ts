import { describe, expect, it } from "vitest";
import {
  compareGateFindings,
  normalizeGateFindings,
  type BaselineGateResult,
  type CandidateGateResult,
} from "./baseline-gate-comparison";

function result(
  command: string,
  status: "passed" | "failed" | "skipped",
  stdout: string,
  touchedFiles: string[] = [],
): { baseline: BaselineGateResult; candidate: CandidateGateResult } {
  const base = "/tmp/base-worktree";
  const candidate = "/tmp/candidate-worktree";
  const common = {
    gateName: "typecheck",
    command,
    exitCode: status === "passed" ? 0 : 2,
    status,
    stdout,
    stderr: "",
    startedAt: "2026-06-19T00:00:00.000Z",
    completedAt: "2026-06-19T00:00:01.000Z",
  };
  return {
    baseline: {
      ...common,
      commit: "base",
      workspacePath: base,
      normalizedFindings: normalizeGateFindings({ command, stdout, stderr: "", repoPath: base }),
    },
    candidate: {
      ...common,
      commit: "candidate",
      workspacePath: candidate,
      touchedFiles,
      normalizedFindings: normalizeGateFindings({ command, stdout, stderr: "", repoPath: candidate }),
    },
  };
}

describe("baseline gate comparison", () => {
  it("normalizes TypeScript diagnostics independent of workspace prefix and ordering", () => {
    const first = normalizeGateFindings({
      command: "npm run typecheck",
      repoPath: "/tmp/a",
      stdout: [
        "\u001b[31m/tmp/a/src/b.ts(2,3): error TS2322: Type 'string' is not assignable to type 'number'.\u001b[0m",
        "/tmp/a/src/a.ts(1,2): error TS2304: Cannot find name 'missing'.",
      ].join("\n"),
      stderr: "",
    });
    const second = normalizeGateFindings({
      command: "npm run typecheck",
      repoPath: "/tmp/b",
      stdout: [
        "/tmp/b/src/a.ts(1,2): error TS2304: Cannot find name 'missing'.",
        "/tmp/b/src/b.ts(2,3): error TS2322: Type 'string' is not assignable to type 'number'.",
      ].join("\n"),
      stderr: "",
    });

    expect(first.map((finding) => finding.fingerprint)).toEqual(
      second.map((finding) => finding.fingerprint),
    );
    expect(first.map((finding) => finding.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("passes when candidate gate succeeds", () => {
    const { baseline, candidate } = result("npm run typecheck", "passed", "");
    expect(
      compareGateFindings({
        command: "npm run typecheck",
        baseline,
        candidate,
        policyAllowsBaselineDebt: true,
        focusedTestsPassed: true,
      }).verdict,
    ).toBe("PASS");
  });

  it("allows unchanged baseline diagnostics as explicit debt", () => {
    const output = "/tmp/base-worktree/src/a.ts(10,5): error TS2741: Property 'x' is missing.";
    const { baseline } = result("npm run typecheck", "failed", output);
    const { candidate } = result(
      "npm run typecheck",
      "failed",
      "/tmp/candidate-worktree/src/a.ts(10,5): error TS2741: Property 'x' is missing.",
      ["src/new-helper.ts"],
    );

    const comparison = compareGateFindings({
      command: "npm run typecheck",
      baseline,
      candidate,
      policyAllowsBaselineDebt: true,
      focusedTestsPassed: true,
    });

    expect(comparison.verdict).toBe("PASS_WITH_BASELINE_DEBT");
    expect(comparison.warning).toContain("pre-existing baseline findings");
  });

  it("rejects new diagnostics including touched-file diagnostics", () => {
    const { baseline } = result(
      "npm run typecheck",
      "failed",
      "/tmp/base-worktree/src/a.ts(10,5): error TS2741: Property 'x' is missing.",
    );
    const { candidate } = result(
      "npm run typecheck",
      "failed",
      [
        "/tmp/candidate-worktree/src/a.ts(10,5): error TS2741: Property 'x' is missing.",
        "/tmp/candidate-worktree/src/new-helper.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      ].join("\n"),
      ["src/new-helper.ts"],
    );

    const comparison = compareGateFindings({
      command: "npm run typecheck",
      baseline,
      candidate,
      policyAllowsBaselineDebt: true,
      focusedTestsPassed: true,
    });

    expect(comparison.verdict).toBe("FAIL_NEW_REGRESSION");
    expect(comparison.touchedFileFindings).toHaveLength(1);
  });

  it("rejects worsened baseline diagnostics and failed focused tests", () => {
    const { baseline } = result(
      "npm run typecheck",
      "failed",
      "/tmp/base-worktree/src/a.ts(10,5): error TS2741: Property 'x' is missing.",
    );
    const { candidate } = result(
      "npm run typecheck",
      "failed",
      "/tmp/candidate-worktree/src/a.ts(11,5): error TS2741: Property 'x' is missing.",
    );

    expect(
      compareGateFindings({
        command: "npm run typecheck",
        baseline,
        candidate,
        policyAllowsBaselineDebt: true,
        focusedTestsPassed: true,
      }).verdict,
    ).toBe("FAIL_WORSENED_BASELINE");
    expect(
      compareGateFindings({
        command: "npm run typecheck",
        baseline,
        candidate: { ...baseline, commit: "candidate", touchedFiles: [], workspacePath: "/tmp/candidate" },
        policyAllowsBaselineDebt: true,
        focusedTestsPassed: false,
      }).verdict,
    ).toBe("FAIL_COMPARISON_INDETERMINATE");
  });
});
