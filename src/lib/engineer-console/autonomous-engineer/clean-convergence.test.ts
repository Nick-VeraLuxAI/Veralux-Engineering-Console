/**
 * Clean-convergence regression matrix A–G (WP1–WP6).
 * Focused unit proofs before live Nano replay.
 */
import { describe, expect, it } from "vitest";
import { buildAuthorityEnvelope } from "./authority";
import { emptyBudgetUsage, remainingBudget } from "./budget";
import {
  hasLiteralEscapedNewlineCorruption,
  validatePlanHarnessGuards,
  readRepoTestGroundingFacts,
} from "./feedback-convergence";
import {
  assessAdversarialDefect,
  isMaterialAdversarialDefect,
  mergeWorkerAdversarialReview,
  runAutonomousReviews,
} from "./reviews";
import {
  classifyPreExecutionPlanFailure,
  formatUnauthorizedPathFeedback,
  resolveMaxPlanRepairs,
  wouldExceedPlanRepairs,
} from "./plan-repair";
import type { AutonomousDocument } from "./types";
import type { EngineeringTask } from "../types";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import fs from "fs";
import os from "os";
import path from "path";

function fakeTask(): EngineeringTask {
  return {
    id: "task-1",
    title: "t",
    description: "d",
    targetRepoPath: "/tmp/repo",
    registeredRepoId: null,
    status: "draft",
    priority: "normal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function baseDoc(): AutonomousDocument {
  return {
    version: 1,
    mode: "autonomous_engineer_v1",
    currentState: "reviewing",
    originalObjective: "Fix ledger",
    interpretedObjective: {
      objectiveSummary: "Fix ledger",
      requirements: ["idempotent apply"],
      acceptanceCriteria: ["tests cover duplicate"],
      constraints: [],
      assumptions: [],
      unknowns: [],
      clarificationRequired: false,
      clarificationQuestions: [],
      initialInvestigationTargets: [],
    },
    requirements: ["idempotent apply"],
    acceptanceCriteria: ["tests cover duplicate"],
    assumptions: [],
    constraints: [],
    authorizedRepoPath: "/tmp/repo",
    authorizedPathPrefixes: ["src/ledger/"],
    authorityEnvelope: buildAuthorityEnvelope(fakeTask(), ["src/ledger/"]),
    budget: {
      max_iterations: 8,
      max_runtime_ms: 60_000,
      max_model_calls: 32,
      max_plans: 8,
      max_changed_files: 20,
      max_changed_bytes: 200_000,
      max_investigation_reads: 40,
      max_context_bytes: 200_000,
      max_plan_repairs: 4,
    },
    usage: emptyBudgetUsage(),
    iterationNumber: 0,
    priorAttempts: [],
    failedHypotheses: [],
    observations: [],
    decisions: [],
    qcObservations: [],
    reviews: [],
    unresolvedDefects: [],
    openRisks: [],
    clarification: null,
    completionEvaluation: null,
    diagnosis: null,
    strategy: null,
    currentPlanId: null,
    previousPlanId: null,
    worktreeId: null,
    workerModel: null,
    qcBaseline: null,
    qcDelta: null,
    deliveryCandidateStatus: "not_ready",
    failureClass: null,
    escalationReason: null,
    pausedAt: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directorAbortReason: null,
    planRepairHistory: [],
    lastIterationChargeKind: null,
  };
}

describe("WP6 matrix A — false race is advisory", () => {
  it("does not block on generic consider-race / missing race test claims", () => {
    const falsePositives = [
      "Consider adding race condition tests for concurrent apply",
      "Missing concurrent race condition coverage",
      "Should recommend race testing under load",
      "No race test for concurrent payments",
    ];
    for (const defect of falsePositives) {
      const assessment = assessAdversarialDefect(defect);
      expect(assessment.material, defect).toBe(false);
      expect(assessment.severity, defect).toBe("advisory");
      expect(assessment.requiresRepair, defect).toBe(false);
      expect(isMaterialAdversarialDefect(defect), defect).toBe(false);
    }

    const base = runAutonomousReviews({
      document: baseDoc(),
      changedFiles: ["src/ledger/ledger.js"],
      diffSummary: "ok",
      qcPassed: true,
      fileContents: { "src/ledger/ledger.js": "export function apply() { return false; }\n" },
    });
    const merged = mergeWorkerAdversarialReview(base, {
      passed: false,
      findings: ["consider race testing"],
      actionableDefects: ["Consider race condition tests for concurrent applyPayment"],
    });
    const adversarial = merged.find((r) => r.review === "worker_adversarial");
    expect(adversarial?.passed).toBe(true);
    expect(adversarial?.actionableDefects).toEqual([]);
    expect(adversarial?.findings.join(" ")).toMatch(/Advisory/);
  });
});

describe("WP6 matrix B — real race is material", () => {
  it("blocks on demonstrated race with concrete evidence", () => {
    const real = [
      "Race: shared balances mutated without revision check",
      "Unsafe shared state under concurrent apply; non-atomic mutation of store[id]",
      "Lost update under concurrent apply of the same payment id",
      "Double-apply under concurrent exec because missing lock around ledger mutation",
      "material=true; requires_repair=true; evidence=shared store mutated without revision",
    ];
    for (const defect of real) {
      const assessment = assessAdversarialDefect(defect);
      expect(assessment.material, defect).toBe(true);
      expect(assessment.severity, defect).toBe("blocker");
      expect(assessment.requiresRepair, defect).toBe(true);
    }

    const base = runAutonomousReviews({
      document: baseDoc(),
      changedFiles: ["src/a.ts"],
      diffSummary: "ok",
      qcPassed: true,
      fileContents: { "src/a.ts": "export const a = 1;\n" },
    });
    const merged = mergeWorkerAdversarialReview(base, {
      passed: false,
      findings: ["lost update under concurrent apply"],
      actionableDefects: ["Race: shared balances mutated without revision check"],
    });
    const adversarial = merged.find((r) => r.review === "worker_adversarial");
    expect(adversarial?.passed).toBe(false);
    expect(adversarial?.actionableDefects[0]).toMatch(/Race/);
  });
});

describe("WP6 matrix C — whole-file \\n corruption rejected", () => {
  it("rejects invalid whole-file literal \\n separators", () => {
    const corrupted =
      "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\nimport { applyPayment } from './ledger.js';\\ntest('ok', () => { assert.equal(1, 1); });";
    expect(hasLiteralEscapedNewlineCorruption(corrupted)).toBe(true);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-corr-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node --test src/x.test.js" } }),
    );
    const facts = readRepoTestGroundingFacts(tmp);
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "corrupt",
      allowedFiles: ["src/x.test.js"],
      operations: [
        {
          type: "create_file",
          path: "src/x.test.js",
          content: corrupted,
          reason: "test",
        },
      ],
    };
    const findings = validatePlanHarnessGuards(plan, facts);
    expect(findings.some((f) => f.signature === "LITERAL_ESCAPED_NEWLINES")).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("WP6 matrix D — legitimate string escapes OK", () => {
  it("allows hello\\nworld string escapes without real-newline requirement", () => {
    const ok = 'const msg = "hello\\nworld"; export const x = msg;';
    expect(hasLiteralEscapedNewlineCorruption(ok)).toBe(false);
  });
});

describe("WP6 matrix C2 — mixed literal \\n corruption rejected across ingestion", () => {
  it("rejects mixed real-newline + statement-separating literal \\n (prior slip path)", () => {
    // One real newline previously made the detector return false immediately.
    const mixed =
      "import test from 'node:test';\n" +
      "import assert from 'node:assert/strict';\\nimport { applyPayment } from './ledger.js';\\nconst x = 1;\\ntest('ok', () => { assert.equal(1, 1); });";
    expect(hasLiteralEscapedNewlineCorruption(mixed)).toBe(true);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-corr-mixed-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node --test src/x.test.js" } }),
    );
    const facts = readRepoTestGroundingFacts(tmp);
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "mixed corrupt",
      allowedFiles: ["src/x.js", "src/x.test.js"],
      operations: [
        {
          type: "create_file",
          path: "src/x.js",
          content: mixed,
          reason: "test",
        },
      ],
    };
    const findings = validatePlanHarnessGuards(plan, facts);
    expect(findings.some((f) => f.signature === "LITERAL_ESCAPED_NEWLINES")).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("WP6 matrix C3 — test harness import forbidden in production", () => {
  it("rejects node:assert import into non-test production module", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-prod-assert-"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "node --test src/counter.test.js" } }),
    );
    const facts = readRepoTestGroundingFacts(tmp);
    const plan: WorkerPlan = {
      runId: "r1",
      summary: "assert in prod",
      allowedFiles: ["src/counter.js"],
      operations: [
        {
          type: "create_file",
          path: "src/counter.js",
          content:
            "import assert from 'node:assert/strict';\nexport function incrementCounter(store, key, by = 1) {\n  assert.ok(store);\n  return (store[key] ?? 0) + by;\n}\n",
          reason: "bad",
        },
      ],
    };
    const findings = validatePlanHarnessGuards(plan, facts);
    expect(findings.some((f) => f.signature === "TEST_HARNESS_IMPORT_IN_PRODUCTION")).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("WP6 matrix E — valid real newlines OK", () => {
  it("allows real newlines after JSON decode", () => {
    const ok = [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('ok', () => { assert.equal(1, 1); });",
      "",
    ].join("\n");
    expect(hasLiteralEscapedNewlineCorruption(ok)).toBe(false);
  });
});

describe("WP6 matrix F — unauthorized package.json is PLAN_REPAIR", () => {
  it("classifies unauthorized package.json as PLAN_REPAIR without semantic iteration semantics", () => {
    const classified = classifyPreExecutionPlanFailure({
      failureClass: "VALIDATION_FAILURE",
      message: "Worker plan paths outside authorized prefixes: package.json",
      unauthorizedPaths: ["package.json"],
      authority: buildAuthorityEnvelope(fakeTask(), ["src/ledger/"]),
    });
    expect(classified.chargeKind).toBe("PLAN_REPAIR");
    expect(classified.planRepairKind).toBe("unauthorized_path");
    expect(classified.reason).toMatch(/Rejected unauthorized path/);
    expect(classified.reason).toMatch(/Authorized prefixes: src\/ledger\//);
    expect(classified.reason).toMatch(/Do not modify package metadata/);

    const usage = emptyBudgetUsage();
    expect(usage.iterations).toBe(0);
    expect(usage.planRepairs).toBe(0);
    // Simulating charge: plan repair increments planRepairs only.
    usage.planRepairs += 1;
    expect(usage.iterations).toBe(0);
    expect(usage.planRepairs).toBe(1);
  });

  it("formats precise authority feedback (WP4)", () => {
    const msg = formatUnauthorizedPathFeedback(["package.json", "src/other/x.js"], ["src/jobs/"]);
    expect(msg).toContain("package.json");
    expect(msg).toContain("src/other/x.js");
    expect(msg).toContain("Authorized prefixes: src/jobs/");
    expect(msg).toMatch(/Do not modify package metadata/);
  });
});

describe("WP6 matrix G — semantic fail increments ENGINEERING; plan-repair budget bounded", () => {
  it("keeps QC/resume-style failures as ENGINEERING_ITERATION", () => {
    const classified = classifyPreExecutionPlanFailure({
      failureClass: "ENGINEERING_FAILURE",
      message: "QC vs baseline: new=1. Failed gates: npm test — resume did not skip completed job",
    });
    expect(classified.chargeKind).toBe("ENGINEERING_ITERATION");
  });

  it("bounds plan-repair budget (no infinite free loop)", () => {
    const budget = baseDoc().budget;
    expect(resolveMaxPlanRepairs(budget)).toBe(4);
    const usage = emptyBudgetUsage();
    usage.planRepairs = 4;
    expect(wouldExceedPlanRepairs(budget, usage, 1)).toBe(true);
    usage.planRepairs = 3;
    expect(wouldExceedPlanRepairs(budget, usage, 1)).toBe(false);
    const remaining = remainingBudget(budget, usage);
    expect(remaining.planRepairs).toBe(1);
  });
});
