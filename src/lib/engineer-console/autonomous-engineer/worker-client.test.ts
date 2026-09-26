import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeAutonomousWorker } from "./worker-client";

describe("autonomous worker client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns test_mock without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeAutonomousWorker(
      { role: "planning", system: "", user: "plan" },
      { generatePlanInjected: true },
    );
    expect(result.route).toBe("test_mock");
    expect(result.mockBypassed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("CONTROL rollback (flag false) sends think-off JSON on the live local route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                runId: "run-1",
                summary: "Add helper",
                allowedFiles: ["src/a.ts"],
                operations: [
                  { type: "create_file", path: "src/a.ts", content: "export {}\n", reason: "helper" },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const previous = { ...process.env };
    process.env.VITEST = "false";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL = "http://127.0.0.1:8081/v1";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
    process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION = "false";
    try {
      const result = await invokeAutonomousWorker({
        role: "planning",
        system: "",
        user: "Run ID: run-1\nReturn worker plan JSON.",
      });
      expect(result.route).toBe("live_default_worker");
      expect(result.providerName).toBe("local_openai_compatible");
      expect(result.modelName).toBe("Nemotron-Nano-30B-A3B-NVFP4");
      expect(result.mockBypassed).toBe(true);
      expect(result.requestPath).toBe("http://127.0.0.1:8081/v1/chat/completions");
      expect(result.schemaValid).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        chat_template_kwargs?: { enable_thinking?: boolean };
        max_tokens?: number;
      };
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(body.max_tokens).toBe(2048);
    } finally {
      process.env = previous;
    }
  });

  it("sends NVIDIA-faithful thinking/sampling when flag enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: {
              reasoning: "thinking",
              content: JSON.stringify({
                runId: "run-1",
                summary: "Add helper",
                allowedFiles: ["src/a.ts"],
                operations: [
                  { type: "create_file", path: "src/a.ts", content: "export {}\n", reason: "helper" },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const previous = { ...process.env };
    process.env.VITEST = "false";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL = "http://127.0.0.1:8082/v1";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
    process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION = "true";
    delete process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET;
    try {
      const result = await invokeAutonomousWorker({
        role: "planning",
        system: "",
        user: "Run ID: run-1\nReturn worker plan JSON.",
      });
      expect(result.schemaValid).toBe(true);
      expect(result.generationBudgetExhausted).toBe(false);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        chat_template_kwargs?: { enable_thinking?: boolean };
        max_tokens?: number;
        temperature?: number;
        top_p?: number;
      };
      expect(body.chat_template_kwargs?.enable_thinking).toBe(true);
      expect(body.max_tokens).toBe(10_000);
      expect(body.temperature).toBe(1.0);
      expect(body.top_p).toBe(1.0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env = previous;
    }
  });

  it("two-phase reasoning budget: phase-1 length then phase-2 final headroom", async () => {
    const planJson = JSON.stringify({
      runId: "run-1",
      summary: "Add helper",
      allowedFiles: ["src/a.ts"],
      operations: [
        { type: "create_file", path: "src/a.ts", content: "export {}\n", reason: "helper" },
      ],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "length",
              message: {
                reasoning_content: "long thinking without final",
                content: "",
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 4000 },
        }),
      })
      .mockResolvedValueOnce({
        // /tokenize
        ok: true,
        json: async () => ({ count: 4000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: planJson },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 80 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const previous = { ...process.env };
    process.env.VITEST = "false";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL = "http://127.0.0.1:8082/v1";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
    process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION = "true";
    process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET = "4000";
    try {
      const result = await invokeAutonomousWorker({
        role: "planning",
        system: "",
        user: "Run ID: run-1\nReturn worker plan JSON.",
      });
      expect(fetchMock).toHaveBeenCalled();
      const chatCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/chat/completions"),
      );
      expect(chatCalls.length).toBe(2);
      const body1 = JSON.parse(String(chatCalls[0]?.[1]?.body)) as {
        max_tokens?: number;
        chat_template_kwargs?: { enable_thinking?: boolean };
      };
      const body2 = JSON.parse(String(chatCalls[1]?.[1]?.body)) as {
        max_tokens?: number;
        chat_template_kwargs?: { enable_thinking?: boolean };
        messages?: Array<{ role: string; content: string }>;
      };
      expect(body1.max_tokens).toBe(4000);
      expect(body1.chat_template_kwargs?.enable_thinking).toBe(true);
      expect(body2.max_tokens).toBe(6000);
      expect(body2.chat_template_kwargs?.enable_thinking).toBe(false);
      expect(body2.messages?.some((m) => m.role === "assistant" && m.content.includes("</think>"))).toBe(
        true,
      );
      expect(result.schemaValid).toBe(true);
      expect(result.generationBudgetExhausted).toBe(false);
      expect(result.telemetry?.twoPhaseReasoning).toBe(true);
      expect(result.telemetry?.reasoningBudget).toBe(4000);
      expect(result.telemetry?.phase1FinishReason).toBe("length");
      expect(result.telemetry?.phase2FinishReason).toBe("stop");
      expect(result.telemetry?.policy).toBe("ALWAYS_TWO_PHASE");
    } finally {
      process.env = previous;
    }
  });

  it("conditional rescue: single-shot length then one two-phase recovery", async () => {
    const planJson = JSON.stringify({
      runId: "run-1",
      summary: "Add helper",
      allowedFiles: ["src/a.ts"],
      operations: [
        { type: "create_file", path: "src/a.ts", content: "export {}\n", reason: "helper" },
      ],
    });
    const fetchMock = vi
      .fn()
      // single-shot GBE
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "length",
              message: { reasoning_content: "thinking forever", content: "" },
            },
          ],
          usage: {
            prompt_tokens: 40,
            completion_tokens: 10000,
            completion_tokens_details: { reasoning_tokens: 10000 },
          },
        }),
      })
      // rescue phase-1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "length",
              message: { reasoning_content: "bounded thinking", content: "" },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 8300 },
        }),
      })
      // tokenize
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 8300 }),
      })
      // rescue phase-2
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: "stop", message: { content: planJson } }],
          usage: { prompt_tokens: 200, completion_tokens: 90 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const previous = { ...process.env };
    process.env.VITEST = "false";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL = "http://127.0.0.1:8082/v1";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
    process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION = "true";
    delete process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET;
    process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE = "true";
    try {
      const result = await invokeAutonomousWorker({
        role: "planning",
        system: "",
        user: "Run ID: run-1\nReturn worker plan JSON.",
      });
      const chatCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/chat/completions"),
      );
      expect(chatCalls.length).toBe(3); // single + p1 + p2
      expect(result.schemaValid).toBe(true);
      expect(result.telemetry?.policy).toBe("FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE");
      expect(result.telemetry?.rescueTriggered).toBe(true);
      expect(result.telemetry?.rescueReasoningBudget).toBe(8300);
      expect(result.telemetry?.singleShotFinishReason).toBe("length");
      expect(result.generationBudgetExhausted).toBe(false);
    } finally {
      process.env = previous;
    }
  });

  it("conditional rescue: stop+valid plan does not invoke two-phase", async () => {
    const planJson = JSON.stringify({
      runId: "run-1",
      summary: "Add helper",
      allowedFiles: ["src/a.ts"],
      operations: [
        { type: "create_file", path: "src/a.ts", content: "export {}\n", reason: "helper" },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            finish_reason: "stop",
            message: { reasoning: "ok", content: planJson },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 200 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const previous = { ...process.env };
    process.env.VITEST = "false";
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
    process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL = "http://127.0.0.1:8082/v1";
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
    process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION = "true";
    delete process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET;
    process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE = "true";
    try {
      const result = await invokeAutonomousWorker({
        role: "planning",
        system: "",
        user: "Run ID: run-1\nReturn worker plan JSON.",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.telemetry?.rescueTriggered).toBe(false);
      expect(result.telemetry?.twoPhaseReasoning).toBe(false);
      expect(result.schemaValid).toBe(true);
    } finally {
      process.env = previous;
    }
  });
});
