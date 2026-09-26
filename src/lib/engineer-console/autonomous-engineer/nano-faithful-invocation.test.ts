import { describe, expect, it } from "vitest";
import {
  assertLiveAeNanoEnvelope,
  extractNanoFinalContent,
  isGenerationBudgetExhausted,
  isNanoFaithfulInvocationEnabled,
  resolveNanoFaithfulProfile,
  resolveNanoReasoningBudget,
  resolveNanoRuntimeMode,
  roleUsesReasoningBudgetGate,
} from "./nano-faithful-invocation";
import { classifyAutonomousFailure } from "./failure-classification";

describe("nano faithful invocation", () => {
  it("defaults ON (promoted); explicit false is CONTROL rollback", () => {
    expect(isNanoFaithfulInvocationEnabled({})).toBe(true);
    expect(resolveNanoRuntimeMode({})).toBe("FAITHFUL");
    const p = resolveNanoFaithfulProfile("planning", {}, {});
    expect(p.enableThinking).toBe(true);
    expect(p.temperature).toBe(1.0);
    expect(p.maxTokens).toBe(10_000);

    const off = { ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "false" };
    expect(isNanoFaithfulInvocationEnabled(off)).toBe(false);
    const control = resolveNanoFaithfulProfile("planning", {}, off);
    expect(control.enableThinking).toBe(false);
    expect(control.temperature).toBe(0.1);
    expect(control.maxTokens).toBe(2048);
    expect(control.runtimeMode).toBe("CONTROL");
  });

  it("enables NVIDIA reasoning sampling for planning when faithful", () => {
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

  it("exposes DEGRADED when max_model_len is undersized", () => {
    const env = {
      ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "true",
      ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN: "8192",
    };
    expect(resolveNanoRuntimeMode(env)).toBe("DEGRADED");
  });

  it("exposes DEGRADED for CONTROL 8081 URL when max_model_len unset", () => {
    const env = {
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
    };
    expect(resolveNanoRuntimeMode(env)).toBe("DEGRADED");
  });

  it("refuses live AE on DEGRADED unless ALLOW_DEGRADED", () => {
    const degraded = {
      ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
      ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN: "8192",
    };
    expect(() => assertLiveAeNanoEnvelope(degraded)).toThrow(/refused DEGRADED/i);
    expect(
      assertLiveAeNanoEnvelope({
        ...degraded,
        ENGINEER_CONSOLE_AE_ALLOW_DEGRADED: "true",
      }),
    ).toBe("DEGRADED");
    expect(
      assertLiveAeNanoEnvelope({
        ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8082/v1",
        ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN: "262144",
      }),
    ).toBe("FAITHFUL");
    expect(
      assertLiveAeNanoEnvelope({
        ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION: "false",
        ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL: "http://127.0.0.1:8081/v1",
      }),
    ).toBe("CONTROL");
  });

  it("resolves optional reasoning budget from env (unset = null)", () => {
    expect(resolveNanoReasoningBudget({})).toBeNull();
    expect(resolveNanoReasoningBudget({ ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET: "" })).toBeNull();
    expect(resolveNanoReasoningBudget({ ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET: "0" })).toBeNull();
    expect(resolveNanoReasoningBudget({ ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET: "4000" })).toBe(4000);
    expect(roleUsesReasoningBudgetGate("planning")).toBe(true);
    expect(roleUsesReasoningBudgetGate("replan")).toBe(true);
    expect(roleUsesReasoningBudgetGate("diagnosis")).toBe(false);
  });
});
