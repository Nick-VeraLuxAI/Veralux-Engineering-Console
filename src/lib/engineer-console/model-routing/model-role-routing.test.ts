import { describe, expect, it } from "vitest";
import { runModelRoleBenchmark } from "./model-role-benchmark-harness";
import {
  getModelRoleConfig,
  listModelRoleAssignments,
  normalizeOpenAIModelsUrl,
  roleRuntimeRecordFromHealth,
  resolveModelRole,
  selectModelRoute,
  validateModelRoleAssignment,
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

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

describe("Nemotron-only model role routing", () => {
  it("normalizes OpenAI-compatible models URLs", () => {
    expect(normalizeOpenAIModelsUrl("http://host:8082")).toBe("http://host:8082/v1/models");
    expect(normalizeOpenAIModelsUrl("http://host:8082/")).toBe("http://host:8082/v1/models");
    expect(normalizeOpenAIModelsUrl("http://host:8082/v1")).toBe("http://host:8082/v1/models");
    expect(normalizeOpenAIModelsUrl("http://host:8082/v1/")).toBe("http://host:8082/v1/models");
  });

  it("defines only Nemotron production roles", () => {
    expect(getModelRoleConfig("vera_command").primaryModel).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(getModelRoleConfig("vera_command").provider).toBe("custom");
    expect(getModelRoleConfig("console_default_worker").primaryModel).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(getModelRoleConfig("console_default_worker").provider).toBe("custom");
    expect(getModelRoleConfig("console_senior_worker").primaryModel).toBe("Nemotron-Super-120B-A12B-FP8");
    expect(getModelRoleConfig("console_senior_worker").provider).toBe("airllm-cold");
  });

  it("resolves Phase 3 explicit role assignments", () => {
    const vera = resolveModelRole("vera_command", EMPTY_ENV);
    const worker = resolveModelRole("console_default_worker", EMPTY_ENV);
    const senior = resolveModelRole("console_senior_worker", EMPTY_ENV);
    const coldSenior = resolveModelRole("console_cold_senior_reviewer", EMPTY_ENV);

    expect(vera).toMatchObject({
      roleId: "vera_command",
      roleKind: "command",
      provider: "local_openai_compatible",
      endpoint: "http://127.0.0.1:8081/v1",
      model: "Nemotron-Nano-30B-A3B-NVFP4",
      status: "available",
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      allowedFallbackRoles: [],
      runtimeRequired: true,
      healthcheckRequired: true,
    });
    expect(worker).toMatchObject({
      roleId: "console_default_worker",
      roleKind: "worker",
      provider: "local_openai_compatible",
      endpoint: "http://127.0.0.1:8082/v1",
      model: "Nemotron-Nano-30B-A3B-NVFP4",
      status: "available",
      repositoryWriteAllowed: true,
      fallbackAllowed: false,
      allowedFallbackRoles: [],
    });
    expect(senior).toMatchObject({
      roleId: "console_senior_worker",
      roleKind: "senior_worker",
      status: "blocked_unproven",
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      runtimeRequired: false,
      healthcheckRequired: false,
    });
    expect(senior.notes).toContain("do not start AirLLM/Super");
    expect(coldSenior).toMatchObject({
      roleId: "console_cold_senior_reviewer",
      roleKind: "senior_worker",
      provider: "airllm-cold",
      endpoint: "airllm:///mnt/model-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1",
      model: "mistralai/Mixtral-8x22B-Instruct-v0.1",
      status: "candidate_unproven",
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      runtimeRequired: false,
      healthcheckRequired: false,
    });
    expect(coldSenior.notes).toContain("no routing promotion");
  });

  it("fails closed for missing roles without selecting fallback", () => {
    const missing = resolveModelRole("fallback_worker", EMPTY_ENV);

    expect(missing.status).toBe("blocked_unknown_role");
    expect(missing.provider).toBeNull();
    expect(missing.model).toBeNull();
    expect(missing.fallbackAllowed).toBe(false);
    expect(missing.allowedFallbackRoles).toEqual([]);
  });

  it("validates role assignments and blocks uncontrolled fallback policy", () => {
    expect(validateModelRoleAssignment(resolveModelRole("vera_command", EMPTY_ENV))).toEqual([]);
    expect(validateModelRoleAssignment(resolveModelRole("console_default_worker", EMPTY_ENV))).toEqual([]);
    expect(validateModelRoleAssignment(resolveModelRole("console_senior_worker", EMPTY_ENV))).toEqual([]);
    expect(validateModelRoleAssignment(resolveModelRole("console_cold_senior_reviewer", EMPTY_ENV))).toEqual([]);

    expect(validateModelRoleAssignment({
      ...resolveModelRole("console_default_worker", EMPTY_ENV),
      model: "qwen-local",
    })).toContain("console_default_worker:QWEN_FALLBACK_FORBIDDEN");
    expect(validateModelRoleAssignment({
      ...resolveModelRole("vera_command", EMPTY_ENV),
      repositoryWriteAllowed: true,
    })).toContain("vera_command:VERA_REPOSITORY_WRITE_FORBIDDEN");
    expect(validateModelRoleAssignment({
      ...resolveModelRole("console_senior_worker", EMPTY_ENV),
      status: "available",
    })).toContain("console_senior_worker:SENIOR_ROLE_MUST_REMAIN_BLOCKED_IN_PHASE_3");
  });

  it("lists only normal mainline Phase 3 role assignments", () => {
    expect(listModelRoleAssignments(EMPTY_ENV).map((role) => role.roleId)).toEqual([
      "vera_command",
      "console_default_worker",
      "console_senior_worker",
    ]);
    expect(listModelRoleAssignments(EMPTY_ENV).map((role) => role.roleId)).not.toContain("console_cold_senior_reviewer");
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
                id: "Nemotron-Nano-30B-A3B-NVFP4",
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
          id: "Nemotron-Nano-30B-A3B-NVFP4",
          runtime: "mock-openai-runtime",
          meta: { n_ctx_train: 65536, n_params: 30_000_000_000, size: 1234 },
        },
      ],
    }));
    const record = roleRuntimeRecordFromHealth(config, health);
    expect(record.configuredEndpoint).toBe("http://127.0.0.1:8082/v1");
    expect(record.actualEndpoint).toBe("http://127.0.0.1:8082/v1");
    expect(record.configuredModelName).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(record.actualModelId).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(record.runtime).toBe("mock-openai-runtime");
    expect(record.contextWindow).toBe(65536);
  });

  it("prevents unbenchmarked Nemotron from repository writes", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      env: {
        CONSOLE_DEFAULT_WORKER_BENCHMARK_STATUS: "available_unbenchmarked",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: jsonFetch({ data: [{ id: "Nemotron-Nano-30B-A3B-NVFP4" }] }),
    });
    expect(decision.status).toBe("blocked_unbenchmarked");
    expect(decision.blockedReason).toBe("NEMOTRON_DEFAULT_WORKER_UNAVAILABLE");
    expect(decision.blockedDetails?.expectedModel).toBe("Nemotron-Nano-30B-A3B-NVFP4");
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.selectedModelRoleId).toBeNull();
  });

  it("classifies /v1/models 404 as not OpenAI-compatible", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
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

  it("does not select a disabled fallback even when fallback environment variables are present", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      env: {
        CONSOLE_ALLOW_LEGACY_FALLBACK: "true",
        FALLBACK_WORKER_MODEL_NAME: "Legacy-Fallback-Model",
        FALLBACK_WORKER_ENDPOINT: "http://127.0.0.1:8080/v1",
        FALLBACK_WORKER_BENCHMARK_STATUS: "benchmark_passed",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: jsonFetch({ data: [{ id: "different-model" }] }),
    });
    expect(decision.status).toBe("blocked_model_mismatch");
    expect(decision.blockedReason).toBe("NEMOTRON_DEFAULT_WORKER_UNAVAILABLE");
    expect(decision.selectedModelRoleId).toBeNull();
    expect(decision.selectedModelName).toBeNull();
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.fallbackReason).toBeNull();
  });

  it("non-Nemotron endpoint health does not matter for Nemotron-only policy", async () => {
    const decision = await selectModelRoute({
      roleId: "vera_command",
      repositoryWriteRequested: false,
      env: {
        VERA_COMMAND_MODEL_ENDPOINT: "http://127.0.0.1:8081/v1",
        FALLBACK_WORKER_ENDPOINT: "http://127.0.0.1:8080/v1",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: jsonFetch({ data: [{ id: "Legacy-Fallback-Model" }] }),
    });
    expect(decision.status).toBe("blocked_model_mismatch");
    expect(decision.blockedReason).toBe("NEMOTRON_COMMAND_MODEL_UNAVAILABLE");
    expect(decision.selectedModelRoleId).toBeNull();
    expect(decision.fallbackUsed).toBe(false);
  });

  it("fallback_worker cannot be selected", async () => {
    await expect(selectModelRoute({
      roleId: "fallback_worker" as never,
      repositoryWriteRequested: false,
      fetchFn: jsonFetch({ data: [{ id: "Legacy-Fallback-Model" }] }),
    })).rejects.toThrow("NEMOTRON_ROLE_DISABLED:fallback_worker");
  });

  it("blocks disabled Nemotron roles with NEMOTRON_ROLE_DISABLED", async () => {
    const decision = await selectModelRoute({
      roleId: "vera_command",
      repositoryWriteRequested: false,
      env: {
        VERA_COMMAND_MODEL_ENABLED: "false",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: jsonFetch({ data: [{ id: "Nemotron-Nano-30B-A3B-NVFP4" }] }),
    });
    expect(decision.status).toBe("blocked_role_disabled");
    expect(decision.blockedReason).toBe("NEMOTRON_ROLE_DISABLED");
    expect(decision.health.error).toBe("NEMOTRON_ROLE_DISABLED");
    expect(decision.selectedModelRoleId).toBeNull();
  });

  it("does not claim senior review when Super is unavailable", async () => {
    const decision = await selectModelRoute({
      roleId: "console_senior_worker",
      repositoryWriteRequested: false,
      fetchFn: jsonFetch({ data: [{ id: "Nemotron-Nano-30B-A3B-NVFP4" }] }),
    });
    expect(decision.status).toBe("senior_model_unavailable");
    expect(decision.blockedReason).toBe("NEMOTRON_SENIOR_WORKER_UNAVAILABLE");
    expect(decision.health.error).toBe("NEMOTRON_SUPER_AIRLLM_UNPROVEN");
    expect(decision.blockedDetails?.nextOperatorAction).toContain("AirLLM Super");
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
