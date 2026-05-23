import { afterEach, describe, expect, it, vi } from "vitest";
import { KimiModelProvider } from "./kimi-model-provider";
import { ModelProviderError } from "../model-provider-errors";
import type { ModelProviderConfig } from "../model-provider-config";

const baseConfig: ModelProviderConfig = {
  provider: "kimi",
  kimiApiKey: "test-key",
  kimiBaseUrl: "https://api.moonshot.ai/v1",
  kimiModel: "kimi-k2-0711-preview",
  requestTimeoutMs: 5000,
};

const validPlan = {
  runId: "run-1",
  summary: "Test",
  allowedFiles: ["src/a.ts"],
  operations: [
    {
      type: "create_file",
      path: "src/a.ts",
      content: "export const x = 1;\n",
      reason: "init",
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KimiModelProvider", () => {
  it("builds request correctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validPlan) } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new KimiModelProvider(baseConfig, fetchMock);
    const result = await provider.generateWorkerPlanDraft({
      runId: "run-1",
      taskTitle: "T",
      taskDescription: "D",
      repoPath: "/tmp",
      allowedFiles: ["src/a.ts"],
      repoContextSummary: "ctx",
      packageScripts: {},
      existingChangedFiles: [],
      constraints: [],
      maxOperations: 5,
      prompt: "generate plan",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string) as { model: string; messages: unknown[] };
    expect(body.model).toBe("kimi-k2-0711-preview");
    expect(body.messages).toHaveLength(2);

    expect(result.parsedPlan?.runId).toBe("run-1");
    expect(result.parseErrors).toHaveLength(0);
  });

  it("handles non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
      }),
    );
    const provider = new KimiModelProvider(baseConfig, fetchMock);
    await expect(
      provider.generateWorkerPlanDraft({
        runId: "run-1",
        taskTitle: "T",
        taskDescription: "",
        repoPath: "/tmp",
        allowedFiles: [],
        repoContextSummary: "",
        packageScripts: {},
        existingChangedFiles: [],
        constraints: [],
        maxOperations: 5,
        prompt: "x",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_HTTP_ERROR" });
  });

  it("handles malformed JSON in completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not json at all" } }],
        }),
        { status: 200 },
      ),
    );
    const provider = new KimiModelProvider(baseConfig, fetchMock);
    const result = await provider.generateWorkerPlanDraft({
      runId: "run-1",
      taskTitle: "T",
      taskDescription: "",
      repoPath: "/tmp",
      allowedFiles: [],
      repoContextSummary: "",
      packageScripts: {},
      existingChangedFiles: [],
      constraints: [],
      maxOperations: 5,
      prompt: "x",
    });
    expect(result.parsedPlan).toBeNull();
    expect(result.parseErrors.length).toBeGreaterThan(0);
  });

  it("handles empty completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "" } }] }),
        { status: 200 },
      ),
    );
    const provider = new KimiModelProvider(baseConfig, fetchMock);
    const result = await provider.generateWorkerPlanDraft({
      runId: "run-1",
      taskTitle: "T",
      taskDescription: "",
      repoPath: "/tmp",
      allowedFiles: [],
      repoContextSummary: "",
      packageScripts: {},
      existingChangedFiles: [],
      constraints: [],
      maxOperations: 5,
      prompt: "x",
    });
    expect(result.parsedPlan).toBeNull();
    expect(result.parseErrors[0]).toContain("empty");
  });

  it("parses json fenced response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '```json\n' + JSON.stringify(validPlan) + "\n```",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new KimiModelProvider(baseConfig, fetchMock);
    const result = await provider.generateWorkerPlanDraft({
      runId: "run-1",
      taskTitle: "T",
      taskDescription: "",
      repoPath: "/tmp",
      allowedFiles: ["src/a.ts"],
      repoContextSummary: "",
      packageScripts: {},
      existingChangedFiles: [],
      constraints: [],
      maxOperations: 5,
      prompt: "x",
    });
    expect(result.parsedPlan?.summary).toBe("Test");
  });

  it("requires API key at construction", () => {
    expect(
      () =>
        new KimiModelProvider({
          ...baseConfig,
          kimiApiKey: null,
        }),
    ).toThrow(ModelProviderError);
  });
});
