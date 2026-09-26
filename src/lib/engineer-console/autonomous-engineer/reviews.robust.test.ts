import { describe, expect, it } from "vitest";
import { buildAuthorityEnvelope } from "./authority";
import { mergeWorkerAdversarialReview, runAutonomousReviews } from "./reviews";
import type { AutonomousDocument } from "./types";
import type { EngineeringTask } from "../types";

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

function doc(): AutonomousDocument {
  return {
    version: 1,
    mode: "autonomous_engineer",
    currentState: "reviewing",
    originalObjective: "Fix ledger",
    interpretedObjective: {
      objectiveSummary: "Fix ledger",
      requirements: ["idempotent apply"],
      acceptanceCriteria: ["tests cover duplicate"],
      assumptions: [],
      unknowns: [],
      investigationTargets: [],
    },
    requirements: ["idempotent apply"],
    acceptanceCriteria: ["tests cover duplicate"],
    assumptions: [],
    constraints: [],
    authorizedRepoPath: "/tmp/repo",
    authorizedPathPrefixes: ["src/"],
    authorityEnvelope: buildAuthorityEnvelope(fakeTask(), ["src/"]),
    budget: {
      max_iterations: 4,
      max_runtime_ms: 60_000,
      max_model_calls: 8,
      max_plans: 4,
      max_changed_files: 20,
      max_changed_bytes: 200_000,
      max_investigation_reads: 40,
      max_context_bytes: 200_000,
    },
    usage: {
      iterations: 1,
      runtimeMs: 1,
      modelCalls: 1,
      plans: 1,
      changedFiles: 1,
      changedBytes: 10,
      investigationReads: 1,
      contextBytes: 10,
      planRepairs: 0,
      postReviewRepairs: 0,
    },
    iterationNumber: 1,
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
    deliveryCandidateStatus: "pending",
    failureClass: null,
    escalationReason: null,
    pausedAt: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directorAbortReason: null,
  };
}

describe("engineering quality + adversarial review merge", () => {
  it("blocks empty catch and success-fallback catch in changed sources", () => {
    const reviews = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/ledger.ts"],
      diffSummary: "update ledger",
      qcPassed: true,
      fileContents: {
        "src/ledger.ts": "export function apply() { try { return 1; } catch { } }\n",
      },
    });
    const quality = reviews.find((review) => review.review === "engineering_quality");
    expect(quality?.passed).toBe(false);
    expect(quality?.actionableDefects.join(" ")).toMatch(/Empty catch/);
  });

  it("blocks circular/self-imports in changed production sources", () => {
    const reviews = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/normalize/token.js"],
      diffSummary: "cleanup",
      qcPassed: true,
      fileContents: {
        "src/normalize/token.js":
          "import { normalizeToken as _legacy } from './token.js';\nexport function normalizeToken(s) { return String(s).trim().toLowerCase(); }\n",
      },
    });
    const quality = reviews.find((review) => review.review === "engineering_quality");
    expect(quality?.passed).toBe(false);
    expect(quality?.actionableDefects.join(" ")).toMatch(/Circular\/self-import/);
  });

  it("blocks vitest imports in production sources", () => {
    const reviews = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/ledger.ts"],
      diffSummary: "bad import",
      qcPassed: true,
      fileContents: {
        "src/ledger.ts": 'import { describe } from "vitest";\nexport const x = 1;\n',
      },
    });
    expect(reviews.find((r) => r.review === "engineering_quality")?.actionableDefects.join(" ")).toMatch(
      /vitest/,
    );
  });

  it("ignores worktree node_modules symlink in scope and diff reviews", () => {
    const reviews = runAutonomousReviews({
      document: doc(),
      changedFiles: ["node_modules", "src/ledger.ts"],
      diffSummary: "update ledger",
      qcPassed: true,
      fileContents: {
        "src/ledger.ts": "export const ledger = 1;\n",
      },
    });
    const scope = reviews.find((review) => review.review === "scope");
    const diff = reviews.find((review) => review.review === "diff_quality");
    expect(scope?.passed).toBe(true);
    expect(scope?.actionableDefects).toEqual([]);
    expect(diff?.actionableDefects).toEqual([]);
  });

  it("blocks invalid expect imports from node:test in test files", () => {
    const reviews = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/ledger.test.js"],
      diffSummary: "bad test import",
      qcPassed: true,
      fileContents: {
        "src/ledger.test.js": "import { describe, it, expect } from 'node:test';\n",
      },
    });
    expect(
      reviews.find((r) => r.review === "engineering_quality")?.actionableDefects.join(" "),
    ).toMatch(/node:test does not export expect/);
  });

  it("merges worker adversarial defects into authoritative reviews", () => {
    const base = runAutonomousReviews({
      document: doc(),
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
    const adversarial = merged.find((review) => review.review === "worker_adversarial");
    expect(adversarial?.passed).toBe(false);
    expect(adversarial?.actionableDefects[0]).toMatch(/Race/);
  });

  it("does not block delivery on invented non-material product requirements", () => {
    const base = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/a.ts"],
      diffSummary: "ok",
      qcPassed: true,
      fileContents: { "src/a.ts": "export const a = 1;\n" },
    });
    const merged = mergeWorkerAdversarialReview(base, {
      passed: false,
      findings: ["could also add allow-list"],
      actionableDefects: [
        "No validation that the action argument is from an allow-list of known actions",
        "Missing negative tests for empty roles array",
      ],
    });
    const adversarial = merged.find((review) => review.review === "worker_adversarial");
    expect(adversarial?.passed).toBe(true);
    expect(adversarial?.actionableDefects).toEqual([]);
    expect(adversarial?.findings.join(" ")).toMatch(/Advisory/);
  });

  it("does not reopen delivery on keyword-only race advice after QC pass", () => {
    const base = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/a.ts"],
      diffSummary: "ok",
      qcPassed: true,
      fileContents: { "src/a.ts": "export const a = 1;\n" },
    });
    const merged = mergeWorkerAdversarialReview(base, {
      passed: false,
      findings: ["consider concurrent race conditions"],
      actionableDefects: ["Missing race condition tests for concurrent apply"],
    });
    const adversarial = merged.find((review) => review.review === "worker_adversarial");
    expect(adversarial?.passed).toBe(true);
    expect(adversarial?.actionableDefects).toEqual([]);
  });
});
