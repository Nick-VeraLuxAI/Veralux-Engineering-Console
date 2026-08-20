/**
 * Isolated package C1–C7: post-QC review lifecycle + faithful promotion contracts.
 * Run before live ledger replay.
 */
import { describe, expect, it } from "vitest";
import { remainingBudget } from "./budget";
import {
  FAITHFUL_MIN_MODEL_LEN,
  isNanoFaithfulInvocationEnabled,
  resolveNanoFaithfulProfile,
  resolveNanoRuntimeMode,
} from "./nano-faithful-invocation";
import {
  findingIdFromSummary,
  markFindingsRepairAttempted,
  resolveMaxPostReviewRepairs,
  trackPostReviewFindings,
  wouldExceedPostReviewRepairs,
} from "./post-review-repair";
import { resolveAutonomousBudgets } from "./policy-budgets";
import {
  assessAdversarialDefect,
  mergeWorkerAdversarialReview,
  runAutonomousReviews,
} from "./reviews";
import type { AutonomousDocument } from "./types";
import { buildAuthorityEnvelope } from "./authority";
import type { EngineeringTask } from "../types";

const FB5_DEFECT =
  "Missing negative tests for failure scenarios caused by store mutation errors, leading to potential silent success.";

const LEDGER_RETHROW = `
export function applyPayment(id, amount, store) {
  try {
    store[id] = 'paid';
    return true;
  } catch (origErr) {
    lastFailure = { id, amount, error: new Error(origErr.message) };
    throw origErr;
  }
}
`;

function fakeTask(): EngineeringTask {
  return {
    id: "task-c",
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
    originalObjective:
      "Improve the existing ledger so production can trust applyPayment, and add tests that cover success and failure cases.",
    interpretedObjective: {
      objectiveSummary: "Fix ledger",
      requirements: [
        "apply payments correctly",
        "record outcomes",
        "never silently treat failures as success",
        "tests cover success and failure cases",
      ],
      acceptanceCriteria: ["tests cover success and failure"],
      assumptions: [],
      unknowns: [],
      clarificationRequired: false,
      clarificationQuestions: [],
      initialInvestigationTargets: [],
    },
    requirements: ["never silently treat failures as success"],
    acceptanceCriteria: ["tests cover success and failure"],
    assumptions: [],
    constraints: [],
    authorizedRepoPath: "/tmp/repo",
    authorizedPathPrefixes: ["src/"],
    authorityEnvelope: buildAuthorityEnvelope(fakeTask(), ["src/"]),
    budget: resolveAutonomousBudgets({ max_iterations: 8, max_post_review_repairs: 2 }),
    usage: {
      iterations: 8,
      runtimeMs: 1,
      modelCalls: 1,
      plans: 8,
      changedFiles: 2,
      changedBytes: 10,
      investigationReads: 1,
      contextBytes: 10,
      planRepairs: 1,
      postReviewRepairs: 0,
    },
    iterationNumber: 8,
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
    qcDelta: { new: 0, preExisting: 0, changed: 0, owned: 0, objectiveQcPassed: true } as never,
    deliveryCandidateStatus: "not_ready",
    failureClass: null,
    escalationReason: null,
    pausedAt: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directorAbortReason: null,
  };
}

describe("C1 — reconstruct fb5eab66 blocker classification", () => {
  it("classifies ledger silent-success claim as MISREAD when catch rethrows", () => {
    const assessment = assessAdversarialDefect(FB5_DEFECT, {
      fileContents: { "src/ledger/ledger.js": LEDGER_RETHROW },
      requirements: [
        "never silently treat failures as success",
        "tests cover success and failure cases",
      ],
      acceptanceCriteria: ["tests cover success and failure"],
      qcPassed: true,
    });
    expect(assessment.material).toBe(false);
    expect(assessment.verdict).toBe("ADVISORY");
    expect(assessment.classification).toBe("MISREAD");
  });
});

describe("C2 — requirement anchoring + current-state grounding", () => {
  it("demotes invented silent-success without source smell", () => {
    const assessment = assessAdversarialDefect(
      "Error paths rely on thrown exceptions but callers may swallow them, risking silent success.",
      {
        fileContents: { "src/ledger/ledger.js": LEDGER_RETHROW },
        requirements: ["record outcomes"],
        acceptanceCriteria: ["tests cover failure"],
      },
    );
    expect(assessment.material).toBe(false);
    expect(["INVENTED", "MISREAD", "ADVISORY"]).toContain(assessment.classification);
  });
});

describe("C3 — POST_REVIEW_REPAIR budget separate from primary iterations", () => {
  it("allows post-review repair when semantic iterations are exhausted", () => {
    const budget = resolveAutonomousBudgets({
      max_iterations: 8,
      max_post_review_repairs: 2,
    });
    const usage = {
      iterations: 8,
      plans: 8,
      modelCalls: 10,
      changedFiles: 2,
      changedBytes: 100,
      runtimeMs: 1000,
      investigationReads: 2,
      contextBytes: 100,
      planRepairs: 1,
      postReviewRepairs: 0,
    };
    expect(usage.iterations).toBe(budget.max_iterations);
    expect(wouldExceedPostReviewRepairs(budget, usage, 1)).toBe(false);
    usage.postReviewRepairs = 2;
    expect(wouldExceedPostReviewRepairs(budget, usage, 1)).toBe(true);
    expect(resolveMaxPostReviewRepairs(budget)).toBe(2);
    const rem = remainingBudget(budget, { ...usage, postReviewRepairs: 0 });
    expect(rem.iterations).toBe(0);
    expect(rem.postReviewRepairs).toBe(2);
  });
});

describe("C4 — finding_id tracking NEW/DUPLICATE/RESOLVED/REGRESSION", () => {
  it("tracks finding lifecycle without ping-pong id drift", () => {
    const id = findingIdFromSummary(FB5_DEFECT);
    let tracked = trackPostReviewFindings({
      ledger: [],
      actionableDefects: [FB5_DEFECT],
      iteration: 8,
    });
    expect(tracked.newIds).toEqual([id]);
    expect(tracked.ledger[0].status).toBe("NEW");

    tracked = trackPostReviewFindings({
      ledger: markFindingsRepairAttempted(tracked.ledger, [FB5_DEFECT]),
      actionableDefects: [FB5_DEFECT],
      iteration: 9,
    });
    expect(tracked.duplicateIds).toContain(id);
    expect(tracked.ledger.find((r) => r.findingId === id)?.repairAttempts).toBe(1);

    tracked = trackPostReviewFindings({
      ledger: tracked.ledger,
      actionableDefects: [],
      iteration: 10,
    });
    expect(tracked.resolvedIds).toContain(id);

    tracked = trackPostReviewFindings({
      ledger: tracked.ledger,
      actionableDefects: [FB5_DEFECT],
      iteration: 11,
    });
    expect(tracked.regressionIds).toContain(id);
  });
});

describe("C5 — materiality strict PASS/BLOCKING/ADVISORY with evidence", () => {
  it("keeps real empty-catch material and race-keyword advisory", () => {
    expect(assessAdversarialDefect("Empty catch swallows payment errors").material).toBe(true);
    expect(
      assessAdversarialDefect("Missing race condition tests for concurrent apply").material,
    ).toBe(false);
    expect(
      assessAdversarialDefect("Race: shared balances mutated without revision check").material,
    ).toBe(true);
  });
});

describe("C6 — merge path uses grounding so fb5 class does not block", () => {
  it("merges fb5eab66 defect as advisory when ledger rethrows", () => {
    const base = runAutonomousReviews({
      document: doc(),
      changedFiles: ["src/ledger/ledger.js", "src/ledger/ledger.test.js"],
      diffSummary: "ledger fix",
      qcPassed: true,
      fileContents: {
        "src/ledger/ledger.js": LEDGER_RETHROW,
        "src/ledger/ledger.test.js": "import test from 'node:test';\n",
      },
    });
    const merged = mergeWorkerAdversarialReview(
      base,
      {
        passed: false,
        findings: ["Runtime validation added but concurrency safety not addressed."],
        actionableDefects: [FB5_DEFECT],
      },
      {
        fileContents: { "src/ledger/ledger.js": LEDGER_RETHROW },
        requirements: doc().interpretedObjective!.requirements,
        acceptanceCriteria: doc().interpretedObjective!.acceptanceCriteria,
        qcPassed: true,
      },
    );
    const adversarial = merged.find((r) => r.review === "worker_adversarial");
    expect(adversarial?.passed).toBe(true);
    expect(adversarial?.actionableDefects).toEqual([]);
    expect(adversarial?.findings.join(" ")).toMatch(/Advisory|misread/i);
  });
});

describe("C7 — faithful default ON with CONTROL rollback + DEGRADED detection", () => {
  it("defaults faithful for hard roles; false rolls back; small ctx is DEGRADED", () => {
    expect(isNanoFaithfulInvocationEnabled({})).toBe(true);
    expect(resolveNanoRuntimeMode({})).toBe("FAITHFUL");
    const planning = resolveNanoFaithfulProfile("planning", {}, {});
    expect(planning.enableThinking).toBe(true);
    expect(planning.temperature).toBe(1.0);
    expect(planning.maxTokens).toBe(10_000);
    expect(planning.runtimeMode).toBe("FAITHFUL");

    const review = resolveNanoFaithfulProfile("review", {}, {});
    expect(review.enableThinking).toBe(true);

    const controlEnv = { ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "false" };
    expect(isNanoFaithfulInvocationEnabled(controlEnv)).toBe(false);
    expect(resolveNanoRuntimeMode(controlEnv)).toBe("CONTROL");
    expect(resolveNanoFaithfulProfile("planning", {}, controlEnv).enableThinking).toBe(false);

    const degradedEnv = {
      ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "true",
      ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN: "8192",
    };
    expect(resolveNanoRuntimeMode(degradedEnv)).toBe("DEGRADED");
    expect(Number(degradedEnv.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN)).toBeLessThan(
      FAITHFUL_MIN_MODEL_LEN,
    );
    const degradedProfile = resolveNanoFaithfulProfile("planning", {}, degradedEnv);
    expect(degradedProfile.runtimeMode).toBe("DEGRADED");
    expect(degradedProfile.enableThinking).toBe(false);
    expect(degradedProfile.maxTokens).toBe(2048);
  });
});
