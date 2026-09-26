import { describe, expect, it } from "vitest";
import {
  CONDITIONAL_BUDGET_POLICY,
  FINAL_PLAN_RESERVE,
  RESCUE_REASONING_BUDGET,
  isConditionalBudgetRescueEnabled,
  resolvePlanningPolicy,
  resolveRescueReasoningBudget,
  shouldTriggerBudgetRescue,
} from "./nano-conditional-budget-rescue";

describe("nano conditional budget rescue", () => {
  it("locks evidence-derived FINAL_PLAN_RESERVE and rescue RB", () => {
    expect(FINAL_PLAN_RESERVE).toBe(1700);
    expect(RESCUE_REASONING_BUDGET).toBe(8300);
    expect(resolveRescueReasoningBudget({})).toBe(8300);
  });

  it("defaults conditional rescue ON; explicit false disables", () => {
    expect(isConditionalBudgetRescueEnabled({})).toBe(true);
    expect(
      isConditionalBudgetRescueEnabled({
        ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE: "false",
      }),
    ).toBe(false);
  });

  it("selects policy: conditional by default, always-two-phase when budget set", () => {
    expect(resolvePlanningPolicy({}, null)).toBe(CONDITIONAL_BUDGET_POLICY);
    expect(resolvePlanningPolicy({}, 4000)).toBe("ALWAYS_TWO_PHASE");
    expect(
      resolvePlanningPolicy(
        { ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE: "false" },
        null,
      ),
    ).toBe("SINGLE_SHOT_ONLY");
  });

  it("does not rescue stop + valid usable plan", () => {
    expect(
      shouldTriggerBudgetRescue({
        finishReason: "stop",
        rawResponse: '{"runId":"r","summary":"s","allowedFiles":[],"operations":[]}',
        parsed: { runId: "r", summary: "s", allowedFiles: [], operations: [] },
        parseErrors: [],
        schemaValid: true,
        reasoningContent: "done thinking",
        generationBudgetExhausted: false,
      }),
    ).toBe(false);
  });

  it("rescues length / GBE / empty final", () => {
    expect(
      shouldTriggerBudgetRescue({
        finishReason: "length",
        rawResponse: "",
        parsed: null,
        parseErrors: ["empty"],
        schemaValid: false,
        reasoningContent: "still thinking",
        generationBudgetExhausted: true,
      }),
    ).toBe(true);
  });

  it("does not rescue semantic bad plans that finished naturally", () => {
    expect(
      shouldTriggerBudgetRescue({
        finishReason: "stop",
        rawResponse: '{"runId":"r","summary":"bad","allowedFiles":[],"operations":[{"type":"run_shell"}]}',
        parsed: { runId: "r", summary: "bad", allowedFiles: [], operations: [{ type: "run_shell" }] },
        parseErrors: [],
        schemaValid: false,
        reasoningContent: "finished",
        generationBudgetExhausted: false,
      }),
    ).toBe(false);
  });
});
