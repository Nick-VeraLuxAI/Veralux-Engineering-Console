import { afterEach, describe, expect, it } from "vitest";
import { chooseRetryPolicy } from "./requirement-execution-policy";
import type { FailureClassification, RequirementExecutionAttempt } from "./requirement-execution-types";

function attempt(overrides: Partial<RequirementExecutionAttempt> = {}): RequirementExecutionAttempt {
  return {
    id: overrides.id ?? "attempt",
    projectId: "project",
    requirementId: "requirement",
    taskId: "task",
    runId: "run",
    attemptNumber: 1,
    status: "failed",
    workerRole: "coding_worker",
    modelProvider: "vera",
    modelName: "qwen",
    strategy: "initial_implementation",
    startedAt: null,
    completedAt: null,
    outcome: "tests_failed",
    failureCategory: "test_failure",
    failureFingerprint: overrides.failureFingerprint ?? "fp",
    failureSummary: "failed",
    retryable: true,
    filesChangedSummary: "[]",
    commandsExecutedSummary: "[]",
    testSummary: "{}",
    qualityGateSummary: "{}",
    evidenceBundleId: null,
    supersedesAttemptId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const failure: FailureClassification = {
  category: "test_failure",
  outcome: "tests_failed",
  summary: "npm test failed",
  details: {},
  retryable: true,
  fingerprint: "fp",
};

describe("Vera escalation policy", () => {
  afterEach(() => {
    delete process.env.VERA_ESCALATION_MODEL;
  });

  it("does not escalate on a single ordinary test failure", () => {
    const decision = chooseRetryPolicy({
      attempts: [attempt({ failureFingerprint: "other" })],
      latestFailure: failure,
      maxAttempts: 3,
      modelProvider: "vera",
      modelName: "qwen",
    });
    expect(decision.action).toBe("retry");
    expect(decision.modelName).toBe("qwen");
  });

  it("uses a configured real escalation model instead of appending a senior suffix", () => {
    process.env.VERA_ESCALATION_MODEL = "qwen-72b";
    const decision = chooseRetryPolicy({
      attempts: [attempt({ id: "a1" }), attempt({ id: "a2" })],
      latestFailure: failure,
      maxAttempts: 4,
      modelProvider: "vera",
      modelName: "qwen",
    });
    expect(decision.action).toBe("escalate_model");
    expect(decision.modelName).toBe("qwen-72b");
  });

  it("returns a structured unavailable state when no escalation model is configured", () => {
    const decision = chooseRetryPolicy({
      attempts: [attempt({ id: "a1" }), attempt({ id: "a2" })],
      latestFailure: failure,
      maxAttempts: 4,
      modelProvider: "vera",
      modelName: "qwen",
    });
    expect(decision.action).toBe("escalate_model");
    expect(decision.modelName).toBe("ESCALATION_MODEL_UNAVAILABLE");
    expect(decision.reason).toContain("VERA_ESCALATION_MODEL");
  });
});
