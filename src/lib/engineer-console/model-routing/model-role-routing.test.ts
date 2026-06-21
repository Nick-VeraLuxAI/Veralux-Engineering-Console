import { describe, expect, it } from "vitest";
import {
  getModelRoleConfig,
  selectModelRoute,
  validateModelEndpoint,
  type ModelRoleFetch,
} from "./model-role-routing";

function jsonFetch(payload: unknown, ok = true): ModelRoleFetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => payload,
  })) as unknown as ModelRoleFetch;
}

describe("Nemotron-first model role routing", () => {
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
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      env: {
        CONSOLE_DEFAULT_WORKER_BENCHMARK_STATUS: "benchmark_passed",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: jsonFetch({
        data: [
          {
            id: "Nemotron-Nano-30B-A3B",
            owned_by: "local-test",
            meta: { n_ctx_train: 32768, n_params: 30_000_000_000, size: 10 },
          },
        ],
      }),
    });
    expect(decision.status).toBe("selected_primary");
    expect(decision.selectedModelRoleId).toBe("console_default_worker");
    expect(decision.repositoryWriteAllowed).toBe(true);
    expect(decision.contextWindow).toBe(32768);
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
