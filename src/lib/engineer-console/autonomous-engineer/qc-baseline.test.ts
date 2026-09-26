import { describe, expect, it } from "vitest";
import {
  compareQcToBaseline,
  extractFailureIdentities,
  formatQcDeltaRepairBlock,
  qcIterationShouldFail,
  snapshotQcResults,
  type QcGateSnapshot,
} from "./qc-baseline";

function gate(partial: Partial<QcGateSnapshot> & Pick<QcGateSnapshot, "command" | "status">): QcGateSnapshot {
  return {
    exitCode: partial.status === "failed" ? 1 : 0,
    stdout: "",
    stderr: "",
    durationMs: 10,
    ...partial,
  };
}

describe("baseline-aware QC classification", () => {
  it("Case 1: NEW_FAILURE from a green baseline", () => {
    const baseline = snapshotQcResults(
      [gate({ command: "npm test", status: "passed", stdout: "ok" })],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({
        command: "npm test",
        status: "failed",
        stdout: "FAIL src/a.test.ts > adds helper",
        stderr: "AssertionError: expected 1 to be 2",
      }),
    ]);
    expect(delta.newFailures.length).toBeGreaterThan(0);
    expect(delta.newFailures[0]?.classification).toBe("NEW_FAILURE");
    expect(qcIterationShouldFail(delta)).toBe(true);
    expect(delta.objectiveQcPassed).toBe(false);
  });

  it("Case 2: unchanged TypeScript failure is PRE_EXISTING_FAILURE", () => {
    const tsLine = "src/lib/legacy.ts(12,4): error TS2322: Type 'string' is not assignable to type 'number'.";
    const baseline = snapshotQcResults(
      [gate({ command: "npm run typecheck", status: "failed", stdout: tsLine })],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({ command: "npm run typecheck", status: "failed", stdout: tsLine }),
    ]);
    expect(delta.preExistingFailures).toHaveLength(1);
    expect(delta.preExistingFailures[0]?.classification).toBe("PRE_EXISTING_FAILURE");
    expect(delta.newFailures).toHaveLength(0);
    expect(qcIterationShouldFail(delta)).toBe(false);
    expect(delta.objectiveQcPassed).toBe(true);
  });

  it("Case 3: baseline failure that disappears is RESOLVED_BASELINE_FAILURE", () => {
    const baseline = snapshotQcResults(
      [
        gate({
          command: "npm test",
          status: "failed",
          stdout: "FAIL src/ready.test.ts > ready flag",
        }),
      ],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({ command: "npm test", status: "passed", stdout: "ok" }),
    ]);
    expect(delta.resolvedBaselineFailures).toHaveLength(1);
    expect(delta.resolvedBaselineFailures[0]?.classification).toBe("RESOLVED_BASELINE_FAILURE");
    expect(qcIterationShouldFail(delta)).toBe(false);
    expect(delta.objectiveQcPassed).toBe(true);
  });

  it("Case 4: same identity with different evidence is CHANGED_FAILURE", () => {
    const baseline = snapshotQcResults(
      [
        gate({
          command: "npm run typecheck",
          status: "failed",
          stdout: "src/lib/a.ts(10,1): error TS2322: Type 'string' is not assignable to type 'number'.",
        }),
      ],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({
        command: "npm run typecheck",
        status: "failed",
        stdout: "src/lib/a.ts(10,1): error TS2322: Type 'boolean' is not assignable to type 'number'.",
      }),
    ]);
    expect(delta.changedFailures).toHaveLength(1);
    expect(delta.changedFailures[0]?.classification).toBe("CHANGED_FAILURE");
    expect(qcIterationShouldFail(delta)).toBe(true);
  });

  it("Case 5: repo-wide pre-existing failure + objective QC pass + no new regression is a delivery candidate", () => {
    const tsLine = "src/experimental/super.ts(1,1): error TS2307: Cannot find module 'airllm'.";
    const baseline = snapshotQcResults(
      [
        gate({ command: "npm test", status: "failed", stdout: "missing ready.txt" }),
        gate({ command: "npm run typecheck", status: "failed", stdout: tsLine }),
      ],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({ command: "npm test", status: "passed", stdout: "ok" }),
      gate({ command: "npm run typecheck", status: "failed", stdout: tsLine }),
    ]);
    expect(delta.preExistingFailures.some((item) => item.identity.kind === "typescript")).toBe(true);
    expect(delta.newFailures).toHaveLength(0);
    expect(delta.changedFailures).toHaveLength(0);
    expect(qcIterationShouldFail(delta)).toBe(false);
    expect(delta.objectiveQcPassed).toBe(true);
  });

  it("does not treat vitest duration suffixes as new test failures", () => {
    const baseline = snapshotQcResults(
      [
        gate({
          command: "npm test",
          status: "failed",
          stdout:
            "FAIL  src/components/create-task-form.test.tsx > UX-6 setup guidance > create task form shows the staging preset only when enabled",
        }),
      ],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({
        command: "npm test",
        status: "failed",
        stdout: [
          "FAIL  src/components/create-task-form.test.tsx > UX-6 setup guidance > create task form shows the staging preset only when enabled",
          "× UX-6 setup guidance > create task form shows the staging preset only when enabled 10ms",
        ].join("\n"),
      }),
    ]);
    expect(delta.newFailures).toHaveLength(0);
    expect(delta.changedFailures).toHaveLength(0);
    expect(delta.preExistingFailures).toHaveLength(1);
    expect(qcIterationShouldFail(delta)).toBe(false);
  });

  it("treats unparsed build/lint gate failures with stdout churn as pre-existing", () => {
    const baseline = snapshotQcResults(
      [gate({ command: "npm run lint", status: "failed", stdout: "eslint noise 1" })],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({ command: "npm run lint", status: "failed", stdout: "eslint noise 2 with different hashes" }),
    ]);
    expect(delta.preExistingFailures).toHaveLength(1);
    expect(delta.newFailures).toHaveLength(0);
    expect(delta.changedFailures).toHaveLength(0);
    expect(qcIterationShouldFail(delta)).toBe(false);
  });

  it("keeps generic npm test blobs owned after a mutation so objective tests can iterate", () => {
    const baseline = snapshotQcResults(
      [gate({ command: "npm test", status: "failed", stdout: "suite failed" })],
      "/repo",
    );
    const delta = compareQcToBaseline(
      baseline,
      [gate({ command: "npm test", status: "failed", stdout: "suite still failed" })],
      () => new Date(),
      { mutatedThisIteration: true },
    );
    expect(delta.changedFailures).toHaveLength(1);
    expect(qcIterationShouldFail(delta)).toBe(true);
  });

  it("does not mark baseline identities resolved when the same gate still failed", () => {
    const tsLine = "src/experimental/super.ts(1,1): error TS2307: Cannot find module 'airllm'.";
    const baseline = snapshotQcResults(
      [gate({ command: "npm run typecheck", status: "failed", stdout: tsLine })],
      "/repo",
    );
    const delta = compareQcToBaseline(baseline, [
      gate({
        command: "npm run typecheck",
        status: "failed",
        stdout: "Cannot find module './loop' imported from qc-baseline.test.ts",
      }),
    ]);
    expect(delta.resolvedBaselineFailures).toHaveLength(0);
    expect(delta.preExistingFailures.length + delta.newFailures.length).toBeGreaterThan(0);
    expect(qcIterationShouldFail(delta)).toBe(true);
  });

  it("normalizes TypeScript identities as file+code+location", () => {
    const identities = extractFailureIdentities(
      gate({
        command: "npm run typecheck",
        status: "failed",
        stdout: "src/a.ts(3,2): error TS2304: Cannot find name 'foo'.",
      }),
    );
    expect(identities[0]?.key).toBe("typescript:src/a.ts:TS2304:3:2");
    expect(identities[0]?.location).toBe("src/a.ts:3:2");
  });

  it("extracts multiline Vitest failure with error message and stack", () => {
    const vitestOutput = `
 FAIL  src/memory-service.test.ts > MemoryService end‑to‑end > creates, commits, recalls and explains a record
Error: Record dummy-id not found
 ❯ Module.explainMemory src/explain.ts:24:11
 ❯ MemoryService.explain src/memory-service.ts:41:12
 ❯ src/memory-service.test.ts:56:43

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
`;
    const identities = extractFailureIdentities(
      gate({
        command: "npm test",
        status: "failed",
        stdout: vitestOutput,
      }),
    );
    expect(identities).toHaveLength(1);
    expect(identities[0]?.key).toBe("test:src/memory-service.test.ts:creates, commits, recalls and explains a record");
    expect(identities[0]?.rawEvidence).toContain("Error: Record dummy-id not found");
    expect(identities[0]?.rawEvidence).toContain("src/explain.ts:24:11");
  });
});

describe("formatQcDeltaRepairBlock", () => {
  it("formats actionable QC failures for planning prompts", () => {
    const block = formatQcDeltaRepairBlock({
      capturedAt: new Date().toISOString(),
      findings: [],
      newFailures: [
        {
          identity: {
            key: "typescript:src/a.ts:TS2345:1:2",
            kind: "typescript",
            command: "npm run typecheck",
            name: "src/a.ts TS2345",
            location: "src/a.ts:1:2",
            fingerprint: "fp",
            rawEvidence: "src/a.ts(1,2): error TS2345: bad arg",
          },
          classification: "NEW_FAILURE",
          baselineFingerprint: null,
          currentFingerprint: "fp",
        },
      ],
      preExistingFailures: [],
      changedFailures: [],
      resolvedBaselineFailures: [],
      infrastructureFailures: [],
      skipped: [],
      objectiveQcPassed: false,
      ownedIterationFailures: [],
    });
    expect(block).toMatch(/Active QC failures/);
    expect(block).toMatch(/TS2345/);
    expect(block).toMatch(/TypeScript repair rules/);
  });
});
