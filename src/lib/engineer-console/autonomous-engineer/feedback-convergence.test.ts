import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authoritativeDiagnosisHint,
  buildDeterministicDiagnosisFromEvidence,
  buildPriorAttemptDigest,
  checkDiagnosisConsistency,
  detectFailureSignaturesInText,
  findSymbolDependencyNeighborhood,
  parseUnboundIdentifierFindings,
  readAuthorizedTestExemplars,
  readRepoTestGroundingFacts,
  recordFailureSignatures,
  repeatedFailureWarningLevel,
  shouldBlockRepeatedHarnessStrategy,
  shouldBlockTestThrashWhileProductionUnbound,
  validatePlanHarnessGuards,
} from "./feedback-convergence";
import type { FailureSignatureRecord } from "./types";
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
    expect(facts.factsBlock).toMatch(/assert\.throws/);
    expect(facts.factsBlock).toMatch(/assert\.rejects/);
    expect(facts.factsBlock).toMatch(/synchronous subjects|sync subjects/i);

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

describe("Q1 — unbound identifier / dependency neighborhood / test thrash", () => {
  it("attributes ReferenceError store to production stack and finds sibling module", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-unbound-"));
    write(tmp, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test src/ratelimit/rate.test.js" } }));
    write(
      tmp,
      "src/ratelimit/rate.js",
      "export function isAllowed(key) { return store.get(key); }\n",
    );
    write(
      tmp,
      "src/ratelimit/store.js",
      "const store = new Map();\nexport default { get(k){return store.get(k);} set(k,v){store.set(k,v);} };\n",
    );

    const evidence = [
      "node --test src/ratelimit/rate.test.js",
      "error: 'store is not defined'",
      "name: 'ReferenceError'",
      "stack: |-",
      "  isAllowed (file:///tmp/x/src/ratelimit/rate.js:14:18)",
      "  TestContext.<anonymous> (file:///tmp/x/src/ratelimit/rate.test.js:11:18)",
    ].join("\n");

    const unbound = parseUnboundIdentifierFindings(evidence);
    expect(unbound.some((u) => u.symbol === "store" && !u.isHookGlobal)).toBe(true);
    expect(unbound[0].productionFiles.some((f) => f.includes("rate.js"))).toBe(true);

    const sigs = detectFailureSignaturesInText(evidence);
    expect(sigs[0]).toBe("UNBOUND_IDENTIFIER");

    const neighborhood = findSymbolDependencyNeighborhood(tmp, ["src/ratelimit/"], "store");
    expect(neighborhood.candidateModules.some((c) => c.includes("store.js"))).toBe(true);

    const diagnosis = buildDeterministicDiagnosisFromEvidence({
      failureClass: "ENGINEERING_FAILURE",
      evidenceText: evidence,
      dependencyNeighborhood: neighborhood,
    });
    expect(diagnosis.affected_file_or_gate).toMatch(/rate\.js/);
    expect(diagnosis.suggestedStrategy).toMatch(/import|Wire/i);
    expect(diagnosis.suggestedStrategy).toMatch(/Do not only add a test fixture/i);
    expect(diagnosis.filesToInspect.some((f) => f.includes("rate.js"))).toBe(true);
  });

  it("blocks test-hook thrash while production unbound ReferenceError remains", () => {
    const evidence = [
      "ReferenceError: cache is not defined",
      "isAllowed (file:///x/src/quota/quota.js:10:5)",
      "TestContext (file:///x/src/quota/quota.test.js:4:1)",
    ].join("\n");
    const unbound = parseUnboundIdentifierFindings(evidence);
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "rewrite beforeEach",
      allowedFiles: ["src/quota/quota.test.js"],
      operations: [
        {
          type: "update_file",
          path: "src/quota/quota.test.js",
          content:
            "import test from 'node:test';\ntest.beforeEach(() => {});\ntest('x', () => {});\n",
          reason: "hooks",
        },
      ],
    };
    const blocked = shouldBlockTestThrashWhileProductionUnbound({
      plan,
      unbound,
      productionFilesStillUnbound: ["src/quota/quota.js"],
    });
    expect(blocked.block).toBe(true);
    expect(blocked.message).toMatch(/TEST_THRASH_GUARD/);
  });

  it("does not block when production file imports the unbound symbol", () => {
    const evidence = "ReferenceError: cache is not defined\nisAllowed (file:///x/src/quota/quota.js:10:5)";
    const unbound = parseUnboundIdentifierFindings(evidence);
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "wire import",
      allowedFiles: ["src/quota/quota.js", "src/quota/quota.test.js"],
      operations: [
        {
          type: "update_file",
          path: "src/quota/quota.js",
          content: "import cache from './cache.js';\nexport function isAllowed(k){ return cache.get(k); }\n",
          reason: "import",
        },
      ],
    };
    const blocked = shouldBlockTestThrashWhileProductionUnbound({
      plan,
      unbound,
      productionFilesStillUnbound: ["src/quota/quota.js"],
    });
    expect(blocked.block).toBe(false);
  });

  it("prefers production UNBOUND_IDENTIFIER over VITEST_HOOK when both present", () => {
    const evidence = [
      "node --test src/ratelimit/rate.test.js",
      "ReferenceError: beforeEach is not defined",
      "ReferenceError: store is not defined",
      "isAllowed (file:///x/src/ratelimit/rate.js:14:18)",
    ].join("\n");
    const sigs = detectFailureSignaturesInText(evidence);
    expect(sigs[0]).toBe("UNBOUND_IDENTIFIER");
  });
});

describe("senior hard constraint in planning hints", () => {
  it("surfaces mandatory senior mission in authoritativeDiagnosisHint", () => {
    const hints = authoritativeDiagnosisHint({
      scaffoldGuard: {
        contractsFrozen: true,
        seniorHardConstraint: {
          nextWorkerMission: "Add write-pipeline.ts only; do not touch contracts.ts",
          rootCause: "Contract rewrite",
          issuedAt: "2026-08-26T00:00:00.000Z",
        },
      },
      diagnosis: {
        advisory: true,
        failureClass: "ENGINEERING_FAILURE",
        summary: "failed",
        failedHypothesis: "bad plan",
        whyPreviousFailed: "QC failed",
        suggestedStrategy: "retry",
        filesToInspect: [],
        doNotMutate: true,
        authoritative: true,
      },
    } as unknown as import("./types").AutonomousDocument);
    expect(hints[0]).toMatch(/HARD CONSTRAINT/);
    expect(hints.join("\n")).toContain("write-pipeline.ts only");
    expect(hints.join("\n")).toContain("FROZEN");
  });
});
