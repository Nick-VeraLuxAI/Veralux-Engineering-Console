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
    } finally {
      process.env = previous;
    }
  });
});
