/**
 * Part C — False completion protection (C1–C4) for targeted requalification repair II.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineeringTask } from "../types";
import { buildAuthorityEnvelope } from "./authority";
import {
  evaluateCompletion,
  evaluateMaterialAcceptanceCriteria,
  isMaterialRateLimitCriterion,
} from "./completion-evaluator";
import {
  buildDeterministicDiagnosisFromEvidence,
  detectFailureSignaturesInText,
  detectTestAssertionModeMismatch,
  readSubjectCallModes,
  validatePlanHarnessGuards,
  readRepoTestGroundingFacts,
} from "./feedback-convergence";
import { runAutonomousReviews } from "./reviews";
import type { AutonomousDocument } from "./types";
import { validateWorkerPlan } from "../worker-plan/worker-plan-validation";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ae-fcp-"));
  tmpDirs.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function fakeTask(): EngineeringTask {
  return {
    id: "t1",
    title: "t",
    description: "d",
    targetRepoPath: "/tmp",
    registeredRepoId: null,
    status: "in_progress",
    priority: "normal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function passingReviews() {
  return [
    { review: "requirements" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "diff_quality" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "regression_risk" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "scope" as const, passed: true, findings: [], actionableDefects: [] },
    { review: "engineering_quality" as const, passed: true, findings: [], actionableDefects: [] },
  ];
}

function baseDoc(overrides: Partial<AutonomousDocument> = {}): AutonomousDocument {
  return {
    originalObjective: "cleanup dead helpers/shims",
    acceptanceCriteria: [
      "No HACK/TODO scaffolding, duplicate dead helpers/shims, or circular/self-imports left in the delivery",
    ],
    requirements: ["sanitizeToken works"],
    authorizedPathPrefixes: ["src/normalize/"],
    unresolvedDefects: [],
    authorityEnvelope: buildAuthorityEnvelope(fakeTask(), ["src/normalize/"]),
    reviews: [],
    interpretedObjective: {
      objectiveSummary: "cleanup",
      requirements: ["sanitizeToken works"],
      acceptanceCriteria: [
        "No HACK/TODO scaffolding, duplicate dead helpers/shims, or circular/self-imports left in the delivery",
      ],
      constraints: [],
      assumptions: [],
      unknowns: [],
      clarificationRequired: false,
      clarificationQuestions: [],
      initialInvestigationTargets: [],
    },
    ...overrides,
  } as unknown as AutonomousDocument;
}

describe("C1 — dead residue blocks ready despite QC pass", () => {
  it("material AC is UNSATISFIED and completion is not ready when dead-shim remains", () => {
    const repo = writeTree(tmp(), {
      "src/normalize/token.js":
        "export function sanitizeToken(s) { return String(s).trim().toLowerCase(); }\n",
      "src/normalize/dead-shim.js": "export function unusedNormalizeShim(s) { return s; }\n",
      "src/normalize/token.test.js": "import test from 'node:test';\ntest('x', () => {});\n",
    });
    const evidence = evaluateMaterialAcceptanceCriteria({
      criteria: [
        "No HACK/TODO scaffolding, duplicate dead helpers/shims, or circular/self-imports left in the delivery",
      ],
      repoPath: repo,
      authorizedPathPrefixes: ["src/normalize/"],
      qcPassed: true,
    });
    expect(evidence[0].status).toBe("UNSATISFIED");

    const evaluation = evaluateCompletion({
      document: baseDoc(),
      qcPassed: true,
      changedFiles: ["src/normalize/token.js"],
      reviews: passingReviews(),
      repoPath: repo,
    });
    expect(evaluation.complete).toBe(false);
    expect(evaluation.unmetAcceptanceCriteria.join(" ")).toMatch(/UNSATISFIED|dead/i);
  });
});

describe("C2 — removed dead residue may ready", () => {
  it("material AC SATISFIED and completion may ready when shim removed", () => {
    const repo = writeTree(tmp(), {
      "src/normalize/token.js":
        "export function sanitizeToken(s) { if (typeof s !== 'string') throw new TypeError('x'); return s.trim().toLowerCase(); }\n",
      "src/normalize/token.test.js":
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('x', () => assert.equal(1,1));\n",
    });
    const evidence = evaluateMaterialAcceptanceCriteria({
      criteria: [
        "No HACK/TODO scaffolding, duplicate dead helpers/shims, or circular/self-imports left in the delivery",
      ],
      repoPath: repo,
      authorizedPathPrefixes: ["src/normalize/"],
      qcPassed: true,
    });
    expect(evidence[0].status).toBe("SATISFIED");

    const evaluation = evaluateCompletion({
      document: baseDoc(),
      qcPassed: true,
      changedFiles: ["src/normalize/token.js", "src/normalize/dead-shim.js"],
      reviews: passingReviews(),
      repoPath: repo,
    });
    expect(evaluation.complete).toBe(true);
  });
});

describe("C3 — sync assert.rejects diagnosed as TEST_ASSERTION_MODE_MISMATCH", () => {
  it("detects mismatch from QC evidence and diagnoses sync-vs-async assertion repair", () => {
    const evidence = [
      "not ok 7 - reject non-finite by (Infinity)",
      "failureType: 'testCodeFailure'",
      "error: 'by must be a finite number'",
      "name: 'TypeError'",
      "waitForActual (node:assert:630:21)",
      "Function.rejects (node:assert:767:31)",
    ].join("\n");
    const sigs = detectFailureSignaturesInText(evidence);
    expect(sigs).toContain("TEST_ASSERTION_MODE_MISMATCH");
    const diagnosis = buildDeterministicDiagnosisFromEvidence({
      failureClass: "ENGINEERING_FAILURE",
      evidenceText: evidence,
      signatures: sigs,
    });
    expect(diagnosis.root_cause_hypothesis).toMatch(/assert\.rejects|synchronous|sync/i);
    expect(diagnosis.suggestedStrategy).toMatch(/assert\.throws/);
  });

  it("flags assert.rejects on proven sync subject in plan harness guards", () => {
    const repo = writeTree(tmp(), {
      "package.json": JSON.stringify({
        type: "module",
        scripts: { test: "node --test src/state/counter.test.js" },
      }),
      "src/state/counter.js":
        "export function incrementCounter(store, key, by = 1) { throw new TypeError('x'); }\n",
    });
    const modes = readSubjectCallModes(repo, ["src/state/"]);
    expect(modes.some((m) => m.name === "incrementCounter" && m.mode === "sync")).toBe(true);
    expect(
      detectTestAssertionModeMismatch(
        "assert.rejects(() => incrementCounter({}, 1, 1), TypeError);",
        ["incrementCounter"],
      ),
    ).toBe(true);
    const facts = readRepoTestGroundingFacts(repo);
    const findings = validatePlanHarnessGuards(
      {
        runId: "r1",
        summary: "tests",
        allowedFiles: ["src/state/counter.test.js"],
        operations: [
          {
            type: "update_file",
            path: "src/state/counter.test.js",
            content:
              "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { incrementCounter } from './counter.js';\ntest('x', () => { assert.rejects(() => incrementCounter({}, 1, 1), TypeError); });\n",
            reason: "neg",
          },
        ],
      },
      facts,
      ["incrementCounter"],
    );
    expect(findings.some((f) => f.signature === "TEST_ASSERTION_MODE_MISMATCH")).toBe(true);
  });
});

describe("C4 — review sees unchanged dead residue; delete_file authorized when AC/safe", () => {
  it("engineering_quality review blocks unchanged dead-shim under cleanup AC", () => {
    const reviews = runAutonomousReviews({
      document: baseDoc(),
      changedFiles: ["src/normalize/token.js"],
      diffSummary: "token.js",
      qcPassed: true,
      fileContents: {
        "src/normalize/token.js":
          "export function sanitizeToken(s) { return String(s).trim().toLowerCase(); }\n",
      },
      authorizedTree: ["src/normalize/token.js", "src/normalize/dead-shim.js"],
    });
    const eq = reviews.find((r) => r.review === "engineering_quality");
    expect(eq?.passed).toBe(false);
    expect(eq?.actionableDefects.join(" ")).toMatch(/dead-shim/i);
  });

  it("validates delete_file for existing authorized path with reason", () => {
    const repo = writeTree(tmp(), {
      "src/normalize/dead-shim.js": "export function unusedNormalizeShim(s) { return s; }\n",
    });
    const result = validateWorkerPlan(
      {
        runId: "run-1",
        summary: "remove dead shim",
        allowedFiles: ["src/normalize/dead-shim.js"],
        operations: [
          {
            type: "delete_file",
            path: "src/normalize/dead-shim.js",
            content: "",
            reason: "Remove unused dead shim per acceptance criteria",
          },
        ],
      },
      repo,
      "run-1",
    );
    expect(result.valid).toBe(true);
  });
});

describe("shared-path restoration — rate-limit AC must not substring-match ledger", () => {
  it("does not treat 'swallowed' as material rate-limit allow", () => {
    expect(isMaterialRateLimitCriterion("Failures are recorded, not swallowed")).toBe(false);
    expect(isMaterialRateLimitCriterion("bookPayment is reliable for success and failure cases")).toBe(
      false,
    );
    expect(isMaterialRateLimitCriterion("Allow requests within the rate window; deny over quota")).toBe(
      true,
    );
    expect(isMaterialRateLimitCriterion("lease/attempt/slot grant within ttl")).toBe(true);
  });

  it("does not block ledger completion on swallowed substring when QC green", () => {
    const repo = writeTree(tmp(), {
      "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
      "src/ledger/payments.js":
        "export function bookPayment(id, amount, store) {\n  try {\n    store[id] = amount;\n    return { ok: true };\n  } catch (err) {\n    return { ok: false, error: String(err) };\n  }\n}\n",
      "src/ledger/payments.test.js":
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { bookPayment } from './payments.js';\ntest('ok', () => { assert.equal(bookPayment('a', 1, {}).ok, true); });\n",
    });
    const rows = evaluateMaterialAcceptanceCriteria({
      criteria: [
        "bookPayment is reliable for success and failure cases",
        "Failures are recorded, not swallowed",
        "Unit tests cover success and at least one failure path",
      ],
      repoPath: repo,
      authorizedPathPrefixes: ["src/ledger/"],
      qcPassed: true,
    });
    expect(rows.every((r) => r.status === "SATISFIED")).toBe(true);
    expect(rows.some((r) => /quota|stateful window/i.test(r.detail))).toBe(false);
  });
});
