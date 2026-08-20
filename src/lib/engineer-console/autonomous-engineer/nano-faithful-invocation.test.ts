import { describe, expect, it } from "vitest";
import {
  extractNanoFinalContent,
  isGenerationBudgetExhausted,
  isNanoFaithfulInvocationEnabled,
  resolveNanoFaithfulProfile,
} from "./nano-faithful-invocation";
import { classifyAutonomousFailure } from "./failure-classification";

describe("nano faithful invocation", () => {
  it("defaults off (CONTROL)", () => {
    expect(isNanoFaithfulInvocationEnabled({})).toBe(false);
    const p = resolveNanoFaithfulProfile("planning", {}, {});
    expect(p.enableThinking).toBe(false);
    expect(p.temperature).toBe(0.1);
    expect(p.maxTokens).toBe(2048);
  });

  it("enables NVIDIA reasoning sampling for planning when flagged", () => {
    const env = { ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "true" };
    const p = resolveNanoFaithfulProfile("planning", {}, env);
    expect(p.enabled).toBe(true);
    expect(p.enableThinking).toBe(true);
    expect(p.temperature).toBe(1.0);
    expect(p.topP).toBe(1.0);
    expect(p.maxTokens).toBe(10_000);
  });

  it("uses tool sampling when toolSelection", () => {
    const env = { ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "true" };
    const p = resolveNanoFaithfulProfile("planning", { toolSelection: true }, env);
    expect(p.temperature).toBe(0.6);
    expect(p.topP).toBe(0.95);
  });

  it("prefers reasoning field over think tags in content", () => {
    const extracted = extractNanoFinalContent({
      content: '{"ok":true}',
      reasoning: "thinking about it",
    });
    expect(extracted.finalContent).toBe('{"ok":true}');
    expect(extracted.reasoningContent).toBe("thinking about it");
  });

  it("strips Nano </think> when reasoning field absent", () => {
    const extracted = extractNanoFinalContent({
      content: "<think>plan</think>\n{\"runId\":\"r1\"}",
    });
    expect(extracted.finalContent).toBe('{"runId":"r1"}');
    expect(extracted.reasoningContent).toContain("plan");
  });

  it("maps finish_reason=length to GENERATION_BUDGET_EXHAUSTED", () => {
    expect(isGenerationBudgetExhausted("length")).toBe(true);
    expect(
      classifyAutonomousFailure({ generationBudgetExhausted: true }),
    ).toBe("GENERATION_BUDGET_EXHAUSTED");
    expect(
      classifyAutonomousFailure({ modelOutputUnusable: true }),
    ).toBe("MODEL_OUTPUT_FAILURE");
  });
});
