import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildAuthorityEnvelope, assertExecutorCannotSelfAuthorize, isPathAuthorized, isInvestigationPathAllowed } from "./authority";
import { checkBudget, emptyBudgetUsage, wouldExceedBudget, BudgetExhaustedError } from "./budget";
import { resolveAutonomousBudgets } from "./policy-budgets";
import { classifyAutonomousFailure, isIterationFailureClass, isTerminalFailureClass } from "./failure-classification";
import { canTransition, assertTransition, autonomousStateToRunStatus } from "./state-machine";
import { classifyUnknown, classifyUnknowns, requiresDirectorClarification } from "./unknown-classifier";
import { evaluateCompletion } from "./completion-evaluator";
import { interpretObjective } from "./objective-interpreter";
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

describe("authority envelope", () => {
  it("never allows executor self-authorization of PR/merge/deploy/approve", () => {
    const envelope = buildAuthorityEnvelope(fakeTask());
    expect(envelope.canSelfApprove).toBe(false);
    expect(envelope.canCreatePr).toBe(false);
    expect(envelope.canMerge).toBe(false);
    expect(envelope.canDeploy).toBe(false);
    expect(envelope.canBypassValidation).toBe(false);
    expect(assertExecutorCannotSelfAuthorize(envelope, "approve_run").allowed).toBe(false);
    expect(assertExecutorCannotSelfAuthorize(envelope, "merge").allowed).toBe(false);
    expect(assertExecutorCannotSelfAuthorize(envelope, "deploy").allowed).toBe(false);
  });

  it("enforces authorized path prefixes", () => {
    const envelope = buildAuthorityEnvelope(fakeTask(), ["src/"]);
    expect(isPathAuthorized(envelope, "src/lib/a.ts")).toBe(true);
    expect(isPathAuthorized(envelope, "docs/secret.md")).toBe(false);
    expect(isInvestigationPathAllowed(envelope, "package.json")).toBe(true);
    expect(isInvestigationPathAllowed(envelope, "docs/secret.md")).toBe(false);
  });
});

describe("budgets", () => {
  it("are policy-configurable and fail closed when exceeded", () => {
    const budget = resolveAutonomousBudgets({ max_iterations: 2 });
    const usage = emptyBudgetUsage();
    expect(wouldExceedBudget(budget, usage, "iterations", 3)).toBe(true);
    expect(() => checkBudget(budget, usage, "iterations", 3)).toThrow(BudgetExhaustedError);
  });
});

describe("failure classification", () => {
  it("does not map every failure to a generic failed class", () => {
    expect(classifyAutonomousFailure({ qualityGatesFailed: true })).toBe("ENGINEERING_FAILURE");
    expect(classifyAutonomousFailure({ workerPlanValidationFailed: true })).toBe("VALIDATION_FAILURE");
    expect(classifyAutonomousFailure({ workerPlanParseFailed: true })).toBe("MODEL_OUTPUT_FAILURE");
    expect(classifyAutonomousFailure({ infrastructureError: true })).toBe("INFRASTRUCTURE_FAILURE");
    expect(classifyAutonomousFailure({ governanceBlocked: true })).toBe("POLICY_BLOCK");
    expect(classifyAutonomousFailure({ budgetExhausted: true })).toBe("BUDGET_EXHAUSTED");
    expect(classifyAutonomousFailure({ directorDecisionRequired: true })).toBe(
      "DIRECTOR_DECISION_REQUIRED",
    );
    expect(classifyAutonomousFailure({ governanceAuthorizationRequired: true })).toBe(
      "GOVERNANCE_AUTHORIZATION_REQUIRED",
    );
    expect(isIterationFailureClass("ENGINEERING_FAILURE")).toBe(true);
    expect(isTerminalFailureClass("BUDGET_EXHAUSTED")).toBe(true);
  });
});

describe("state transitions", () => {
  it("allows iteration diagnose → plan and blocks illegal jumps", () => {
    expect(canTransition("diagnosing", "planning")).toBe(true);
    expect(canTransition("evaluating_completion", "waiting_for_approval")).toBe(true);
    expect(canTransition("waiting_for_approval", "diagnosing")).toBe(true);
    expect(canTransition("waiting_for_approval", "planning")).toBe(true);
    expect(canTransition("waiting_for_approval", "executing")).toBe(false);
    expect(() => assertTransition("failed", "planning")).toThrow(/Illegal/);
    expect(autonomousStateToRunStatus("waiting_for_director")).toBe("waiting_for_director");
    expect(autonomousStateToRunStatus("diagnosing")).toBe("diagnosing");
  });
});

describe("unknown classifier", () => {
  it("classifies discoverable vs director vs governance", () => {
    expect(classifyUnknown("What test scripts exist?").classification).toBe("discoverable");
    expect(classifyUnknown("Should the public export be named foo or bar?").classification).toBe(
      "director",
    );
    expect(classifyUnknown("Please merge this to main after the change.").classification).toBe(
      "governance",
    );
    expect(
      classifyUnknown("Add a helper. Do not open a PR or deploy.").classification,
    ).toBe("engineering");
    const unknowns = classifyUnknowns(["Should we rename the public API?"]);
    expect(requiresDirectorClarification(unknowns)).toBe(true);
  });
});

describe("objective interpreter", () => {
  it("does not ask a human for discoverable uncertainty once investigated", () => {
    const interpretation = interpretObjective({
      objective: "Add a helper. What test scripts exist?",
      investigation: {
        observations: [
          {
            at: new Date().toISOString(),
            operation: "package_scripts",
            summary: "package.json scripts: test, lint",
          },
        ],
        packageScripts: { test: "node test.js" },
        fileTree: ["package.json"],
        fileContents: [],
        gitStatus: "",
        gitLog: "",
        contextSummary: "scripts test",
        usage: emptyBudgetUsage(),
      },
    });
    expect(interpretation.clarificationRequired).toBe(false);
    expect(interpretation.unknowns.some((item) => item.classification === "discoverable" && item.resolved)).toBe(
      true,
    );
  });
});

describe("completion evaluator", () => {
  it("does not treat npm test passed alone as objective completion", () => {
    const document = {
      interpretedObjective: {
        objectiveSummary: "Add helper",
        requirements: [],
        acceptanceCriteria: ["Helper exists"],
        constraints: [],
        assumptions: [],
        unknowns: [],
        clarificationRequired: false,
        clarificationQuestions: [],
        initialInvestigationTargets: [],
      },
      requirements: [],
      acceptanceCriteria: ["Helper exists"],
      unresolvedDefects: [],
      authorityEnvelope: buildAuthorityEnvelope(fakeTask()),
      reviews: [],
    } as unknown as AutonomousDocument;

    const evaluation = evaluateCompletion({
      document,
      qcPassed: true,
      changedFiles: ["src/a.ts"],
      reviews: [],
    });
    expect(evaluation.complete).toBe(false);
    expect(evaluation.qcPassed).toBe(true);
  });
});

describe("director UX contracts", () => {
  it("presents the seven director questions in the autonomous panel", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/engineer-console/autonomous-engineer-panel.tsx"),
      "utf8",
    );
    expect(source).toContain("What is it doing?");
    expect(source).toContain("Does it need me?");
    expect(source).toContain("Did it finish?");
    expect(source).toContain("QC vs baseline?");
    expect(source).toContain("What changed?");
    expect(source).toContain("Risks?");
    expect(source).toContain("What decision?");
  });
});

