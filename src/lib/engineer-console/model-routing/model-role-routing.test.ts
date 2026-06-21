import { describe, expect, it } from "vitest";
import { runModelRoleBenchmark } from "./model-role-benchmark-harness";
import {
  getModelRoleConfig,
  normalizeOpenAIModelsUrl,
  roleRuntimeRecordFromHealth,
  selectModelRoute,
  validateModelEndpoint,
  type ModelRoleFetch,
} from "./model-role-routing";

function jsonFetch(payload: unknown, ok = true, status = ok ? 200 : 503): ModelRoleFetch {
  return (async () => ({
    ok,
    status,
    json: async () => payload,
  })) as unknown as ModelRoleFetch;
}

describe("Nemotron-first model role routing", () => {
  it("normalizes OpenAI-compatible models URLs", () => {
    expect(normalizeOpenAIModelsUrl("http://host:8082")).toBe("http://host:8082/v1/models");
    expect(normalizeOpenAIModelsUrl("http://host:8082/")).toBe("http://host:8082/v1/models");
    expect(normalizeOpenAIModelsUrl("http://host:8082/v1")).toBe("http://host:8082/v1/models");
    expect(normalizeOpenAIModelsUrl("http://host:8082/v1/")).toBe("http://host:8082/v1/models");
  });

  it("defines Nemotron primary roles and Qwen fallback", () => {
    expect(getModelRoleConfig("vera_command").primaryModel).toBe("Nemotron-Nano-30B-A3B");
    expect(getModelRoleConfig("console_default_worker").primaryModel).toBe("Nemotron-Nano-30B-A3B");
    expect(getModelRoleConfig("console_senior_worker").primaryModel).toBe("Nemotron-Super-120B-A12B");
    expect(getModelRoleConfig("fallback_worker").primaryModel).toBe("Qwen2.5-Coder-32B-Instruct");
    expect(getModelRoleConfig("fallback_worker").benchmarkStatus).toBe("proven_fallback");
  });

  it("blocks a primary route when the endpoint is missing", async () => {
    const health = await validateModelEndpoint({
      ...getModelRoleConfig("console_default_worker"),
      endpoint: "",
    });
    expect(health.status).toBe("missing_endpoint");
    expect(health.error).toBe("NEMOTRON_ENDPOINT_MISSING");
  });

  it("selects a healthy benchmark-passed Nemotron role", async () => {
    let requestedUrl = "";
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      env: {
        CONSOLE_DEFAULT_WORKER_BENCHMARK_STATUS: "benchmark_passed",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: (async (url: RequestInfo | URL) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "Nemotron-Nano-30B-A3B",
                owned_by: "local-test",
                meta: { n_ctx_train: 32768, n_params: 30_000_000_000, size: 10 },
              },
            ],
          }),
        };
      }) as unknown as ModelRoleFetch,
    });
    expect(decision.status).toBe("selected_primary");
    expect(requestedUrl).toBe("http://127.0.0.1:8082/v1/models");
    expect(decision.selectedModelRoleId).toBe("console_default_worker");
    expect(decision.repositoryWriteAllowed).toBe(true);
    expect(decision.contextWindow).toBe(32768);
  });

  it("records actual runtime config from healthy endpoint metadata", async () => {
    const config = getModelRoleConfig("console_default_worker");
    const health = await validateModelEndpoint(config, jsonFetch({
      data: [
        {
          id: "Nemotron-Nano-30B-A3B",
          runtime: "mock-openai-runtime",
          meta: { n_ctx_train: 65536, n_params: 30_000_000_000, size: 1234 },
        },
      ],
    }));
    const record = roleRuntimeRecordFromHealth(config, health);
    expect(record.configuredEndpoint).toBe("http://127.0.0.1:8082/v1");
    expect(record.actualEndpoint).toBe("http://127.0.0.1:8082/v1");
    expect(record.configuredModelName).toBe("Nemotron-Nano-30B-A3B");
    expect(record.actualModelId).toBe("Nemotron-Nano-30B-A3B");
    expect(record.runtime).toBe("mock-openai-runtime");
    expect(record.contextWindow).toBe(65536);
  });

  it("prevents unbenchmarked Nemotron from repository writes", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      fallbackAllowed: false,
      fetchFn: jsonFetch({ data: [{ id: "Nemotron-Nano-30B-A3B" }] }),
    });
    expect(decision.status).toBe("blocked_unbenchmarked");
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.selectedModelRoleId).toBeNull();
  });

  it("classifies /v1/models 404 as not OpenAI-compatible", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      fallbackAllowed: false,
      fetchFn: jsonFetch({ error: "not found" }, false, 404),
    });
    expect(decision.status).toBe("blocked_not_openai_compatible");
    expect(decision.health.modelsUrl).toBe("http://127.0.0.1:8082/v1/models");
    expect(decision.health.error).toBe("NEMOTRON_ENDPOINT_NOT_OPENAI_COMPATIBLE:404");
  });

  it("benchmark harness reports blocked_missing_model for unavailable Nemotron", async () => {
    const result = await runModelRoleBenchmark({
      role: "vera_command",
      dryRun: true,
      noWrites: true,
      fetchFn: jsonFetch({ error: "not found" }, false, 404),
    });
    expect(result.status).toBe("blocked_missing_model");
    expect(result.reason).toBe("NEMOTRON_ENDPOINT_NOT_OPENAI_COMPATIBLE:404");
    expect(result.writesAllowed).toBe(false);
  });

  it("persists fallback reason when fallback policy allows Qwen", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      fallbackAllowed: true,
      fetchFn: jsonFetch({ data: [{ id: "different-model" }] }),
    });
    expect(decision.status).toBe("selected_fallback");
    expect(decision.selectedModelRoleId).toBe("fallback_worker");
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.fallbackReason).toBe("NEMOTRON_MODEL_UNAVAILABLE");
  });

  it("does not claim senior review when Super is unavailable", async () => {
    const decision = await selectModelRoute({
      roleId: "console_senior_worker",
      repositoryWriteRequested: false,
      fetchFn: jsonFetch({ data: [{ id: "Nemotron-Nano-30B-A3B" }] }),
    });
    expect(decision.status).toBe("senior_model_unavailable");
    expect(decision.selectedModelRoleId).toBeNull();
    expect(decision.fallbackUsed).toBe(false);
  });

  it("defaults tool-enabled Nemotron routes to nonstreaming serial tool calls", () => {
    const policy = getModelRoleConfig("console_default_worker").transportPolicy;
    expect(policy.toolStreamingSupported).toBe(false);
    expect(policy.parallelToolCallsSupported).toBe(false);
    expect(policy.nonstreamingToolTurns).toBe(true);
  });
});
