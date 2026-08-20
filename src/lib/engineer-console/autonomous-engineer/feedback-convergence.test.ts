import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPriorAttemptDigest,
  checkDiagnosisConsistency,
  readAuthorizedTestExemplars,
  readRepoTestGroundingFacts,
  recordFailureSignatures,
  repeatedFailureWarningLevel,
  shouldBlockRepeatedHarnessStrategy,
  validatePlanHarnessGuards,
  type FailureSignatureRecord,
} from "./feedback-convergence";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";

let tmp: string | null = null;

afterEach(() => {
  if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe("WP1 — test exemplar grounding", () => {
  it("retrieves 1–3 proximity-ranked known-good tests with ESM/runner facts", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-ex-"));
    write(
      tmp,
      "package.json",
      JSON.stringify({
        type: "module",
        scripts: { test: "node --test src/ledger/ledger.test.js" },
      }),
    );
    write(
      tmp,
      "src/ledger/ledger.test.js",
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { applyPayment } from './ledger.js';",
        "test('happy', () => { assert.equal(1, 1); });",
        "",
      ].join("\n"),
    );
    write(
      tmp,
      "src/ledger/other.test.js",
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('x', () => assert.ok(true));\n",
    );
    write(tmp, "src/ledger/broken.test.js", "const x = require('./ledger');\n");
    write(tmp, "src/other/far.test.js", "import test from 'node:test';\ntest('far', () => {});\n");

    const facts = readRepoTestGroundingFacts(tmp);
    expect(facts.moduleType).toBe("module");
    expect(facts.runner).toBe("node:test");
    expect(facts.assertionLib).toBe("node:assert");
    expect(facts.factsBlock).toMatch(/never use require/);
    expect(facts.factsBlock).toMatch(/assert\.rejects/);

    const exemplars = readAuthorizedTestExemplars(tmp, ["src/ledger/"], {
      maxFiles: 3,
      focusPaths: ["src/ledger/ledger.js"],
    });
    expect(exemplars.length).toBeGreaterThanOrEqual(1);
    expect(exemplars.length).toBeLessThanOrEqual(3);
    expect(exemplars.some((ex) => ex.path.includes("ledger.test.js"))).toBe(true);
    // Broken require exemplar should rank below known-good node:test files.
    const brokenIdx = exemplars.findIndex((ex) => ex.path.includes("broken"));
    const goodIdx = exemplars.findIndex((ex) => ex.path.includes("ledger.test.js"));
    if (brokenIdx >= 0 && goodIdx >= 0) {
      expect(goodIdx).toBeLessThan(brokenIdx);
    }
  });
});

describe("WP2 — prior-attempt / repeated-mistake digest", () => {
  it("emphasizes proven failed approaches and repeated-failure warnings", () => {
    const history: FailureSignatureRecord[] = [
      { signature: "ESM_REQUIRE_USAGE", iterations: [2, 7], count: 2 },
    ];
    const digest = buildPriorAttemptDigest({
      priorAttempts: [
        {
          iteration: 2,
          workerPlanId: "p2",
          strategy: "native tests",
          outcome: "failed",
          failureClass: "ENGINEERING_FAILURE",
          summary: "require is not defined",
          qcSummary: "Failed gates: npm test",
        },
        {
          iteration: 3,
          workerPlanId: "p3",
          strategy: "use assert",
          outcome: "failed",
          failureClass: "ENGINEERING_FAILURE",
          summary: "SyntaxError",
        },
      ],
      failedHypotheses: [
        { iteration: 2, hypothesis: "native tests", whyFailed: "require is not defined in ES module" },
      ],
      qcObservations: [
        {
          iteration: 2,
          at: new Date().toISOString(),
          passed: false,
          failedCommands: ["npm test"],
          summary: "Failed gates: npm test",
        },
      ],
      failureSignatures: history,
    });
    expect(digest).toMatch(/Prior-attempt digest/);
    expect(digest).toMatch(/iter 2/);
    expect(digest).toMatch(/require is not defined/);
    expect(digest).toMatch(/ESM_REQUIRE_USAGE x2/);
    expect(digest).toMatch(/WARNING/);
  });
});

describe("WP4 — diagnosis consistency check", () => {
  it("rejects expect/Vitest diagnosis when QC evidence has no expect", () => {
    const result = checkDiagnosisConsistency(
      {
        whyPreviousFailed: "Tests imported expect from Vitest incorrectly",
        suggestedStrategy: "Replace expect with assert",
      },
      "TypeError: assert.throwsAsync is not a function\n    at src/jobs/jobs.test.js:12",
    );
    expect(result.authoritative).toBe(false);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("accepts diagnosis that matches throwsAsync evidence", () => {
    const result = checkDiagnosisConsistency(
      {
        whyPreviousFailed: "assert.throwsAsync is not a function",
        suggestedStrategy: "Use await assert.rejects",
      },
      "TypeError: assert.throwsAsync is not a function",
    );
    expect(result.authoritative).toBe(true);
  });
});

describe("WP5 — repeated failure recognition", () => {
  it("warns at occurrence 2 and blocks identical strategy at occurrence 3+", () => {
    let history: FailureSignatureRecord[] = [];
    history = recordFailureSignatures(history, ["ESM_REQUIRE_USAGE"], 1);
    expect(repeatedFailureWarningLevel(history, "ESM_REQUIRE_USAGE")).toBe("normal");
    history = recordFailureSignatures(history, ["ESM_REQUIRE_USAGE"], 2);
    expect(repeatedFailureWarningLevel(history, "ESM_REQUIRE_USAGE")).toBe("warning");
    history = recordFailureSignatures(history, ["ESM_REQUIRE_USAGE"], 3);
    expect(repeatedFailureWarningLevel(history, "ESM_REQUIRE_USAGE")).toBe("block");
    const blocked = shouldBlockRepeatedHarnessStrategy(history, ["ESM_REQUIRE_USAGE"]);
    expect(blocked.block).toBe(true);
    expect(blocked.message).toMatch(/3\+/);
  });
});

describe("WP6/WP7 — fast harness guards", () => {
  it("rejects require() in ESM tests and assert.throwsAsync", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-harness-"));
    write(
      tmp,
      "package.json",
      JSON.stringify({ type: "module", scripts: { test: "node --test src/x.test.js" } }),
    );
    const facts = readRepoTestGroundingFacts(tmp);
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "bad harness",
      allowedFiles: ["src/x.test.js"],
      operations: [
        {
          type: "create_file",
          path: "src/x.test.js",
          content: "const mod = require('./x.js');\nassert.throwsAsync(async () => {});\n",
          reason: "test",
        },
      ],
    };
    const findings = validatePlanHarnessGuards(plan, facts);
    expect(findings.some((f) => f.signature === "ESM_REQUIRE_USAGE")).toBe(true);
    expect(findings.some((f) => f.signature === "INVALID_NODE_ASSERT_API")).toBe(true);
  });
});
