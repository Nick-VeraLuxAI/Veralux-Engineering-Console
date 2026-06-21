export type ModelRoleId =
  | "vera_command"
  | "console_default_worker"
  | "console_senior_worker"
  | "fallback_worker";

export type BenchmarkStatus =
  | "missing_model"
  | "endpoint_unreachable"
  | "model_mismatch"
  | "available_unbenchmarked"
  | "benchmark_failed"
  | "benchmark_passed"
  | "proven_fallback";

export type ModelRouteStatus =
  | "selected_primary"
  | "selected_fallback"
  | "blocked_missing_endpoint"
  | "blocked_unreachable"
  | "blocked_model_mismatch"
  | "blocked_unbenchmarked"
  | "senior_model_unavailable";

export interface ModelTransportPolicy {
  toolStreamingSupported: boolean;
  parallelToolCallsSupported: boolean;
  textStreamingSupported: boolean;
  nonstreamingToolTurns: boolean;
}

export interface ModelRoleConfig {
  roleId: ModelRoleId;
  primaryModel: string;
  provider: string;
  endpoint: string;
  enabled: boolean;
  fallbackRoleId: ModelRoleId | null;
  fallbackAllowed: boolean;
  repositoryWriteAllowed: boolean;
  benchmarkStatus: BenchmarkStatus;
  transportPolicy: ModelTransportPolicy;
}

export interface ModelEndpointHealth {
  status: "healthy" | "missing_endpoint" | "unreachable" | "model_mismatch";
  endpoint: string;
  modelMatched: boolean;
  modelId: string | null;
  runtime: string | null;
  contextWindow: number | null;
  parameterCount: number | null;
  sizeBytes: number | null;
  checkedAt: string;
  error: string | null;
}

export interface ModelRoutingDecision {
  routingDecisionId: string;
  requestedModelRoleId: ModelRoleId;
  selectedModelRoleId: ModelRoleId | null;
  requestedModelName: string;
  requestedProvider: string;
  requestedEndpoint: string;
  selectedModelName: string | null;
  selectedProvider: string | null;
  selectedEndpoint: string | null;
  runtime: string | null;
  contextWindow: number | null;
  transportPolicy: ModelTransportPolicy;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  benchmarkStatus: BenchmarkStatus;
  status: ModelRouteStatus;
  repositoryWriteAllowed: boolean;
  health: ModelEndpointHealth;
}

export type ModelRoleFetch = typeof fetch;

const NEMOTRON_TOOL_SAFE_POLICY: ModelTransportPolicy = {
  toolStreamingSupported: false,
  parallelToolCallsSupported: false,
  textStreamingSupported: true,
  nonstreamingToolTurns: true,
};

const FALLBACK_TOOL_SAFE_POLICY: ModelTransportPolicy = {
  toolStreamingSupported: false,
  parallelToolCallsSupported: false,
  textStreamingSupported: true,
  nonstreamingToolTurns: true,
};

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function envValue(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key]?.trim() || fallback;
}

function benchmarkStatus(env: NodeJS.ProcessEnv, key: string, fallback: BenchmarkStatus): BenchmarkStatus {
  const value = env[key]?.trim() as BenchmarkStatus | undefined;
  return value || fallback;
}

export function getModelRoleConfig(
  roleId: ModelRoleId,
  env: NodeJS.ProcessEnv = process.env,
): ModelRoleConfig {
  if (roleId === "fallback_worker") {
    return {
      roleId,
      primaryModel: envValue(env, "FALLBACK_WORKER_MODEL_NAME", "Qwen2.5-Coder-32B-Instruct"),
      provider: envValue(env, "FALLBACK_WORKER_PROVIDER", "custom"),
      endpoint: envValue(env, "FALLBACK_WORKER_ENDPOINT", "http://127.0.0.1:8080/v1"),
      enabled: envBool(env.FALLBACK_WORKER_ENABLED, true),
      fallbackRoleId: null,
      fallbackAllowed: false,
      repositoryWriteAllowed: true,
      benchmarkStatus: benchmarkStatus(env, "FALLBACK_WORKER_BENCHMARK_STATUS", "proven_fallback"),
      transportPolicy: FALLBACK_TOOL_SAFE_POLICY,
    };
  }

  if (roleId === "console_senior_worker") {
    return {
      roleId,
      primaryModel: envValue(env, "CONSOLE_SENIOR_WORKER_MODEL_NAME", "Nemotron-Super-120B-A12B"),
      provider: envValue(env, "CONSOLE_SENIOR_WORKER_PROVIDER", "custom"),
      endpoint: envValue(env, "CONSOLE_SENIOR_WORKER_ENDPOINT", "http://127.0.0.1:8083/v1"),
      enabled: envBool(env.CONSOLE_SENIOR_WORKER_ENABLED, true),
      fallbackRoleId: null,
      fallbackAllowed: false,
      repositoryWriteAllowed: false,
      benchmarkStatus: benchmarkStatus(env, "CONSOLE_SENIOR_WORKER_BENCHMARK_STATUS", "available_unbenchmarked"),
      transportPolicy: NEMOTRON_TOOL_SAFE_POLICY,
    };
  }

  if (roleId === "vera_command") {
    return {
      roleId,
      primaryModel: envValue(env, "VERA_COMMAND_MODEL_NAME", "Nemotron-Nano-30B-A3B"),
      provider: envValue(env, "VERA_COMMAND_MODEL_PROVIDER", "custom"),
      endpoint: envValue(env, "VERA_COMMAND_MODEL_ENDPOINT", "http://127.0.0.1:8081/v1"),
      enabled: envBool(env.VERA_COMMAND_MODEL_ENABLED, true),
      fallbackRoleId: "fallback_worker",
      fallbackAllowed: true,
      repositoryWriteAllowed: false,
      benchmarkStatus: benchmarkStatus(env, "VERA_COMMAND_MODEL_BENCHMARK_STATUS", "available_unbenchmarked"),
      transportPolicy: NEMOTRON_TOOL_SAFE_POLICY,
    };
  }

  return {
    roleId,
    primaryModel: envValue(env, "CONSOLE_DEFAULT_WORKER_MODEL_NAME", "Nemotron-Nano-30B-A3B"),
    provider: envValue(env, "CONSOLE_DEFAULT_WORKER_PROVIDER", "custom"),
    endpoint: envValue(env, "CONSOLE_DEFAULT_WORKER_ENDPOINT", "http://127.0.0.1:8082/v1"),
    enabled: envBool(env.CONSOLE_DEFAULT_WORKER_ENABLED, true),
    fallbackRoleId: "fallback_worker",
    fallbackAllowed: envBool(env.CONSOLE_ALLOW_QWEN_FALLBACK, false),
    repositoryWriteAllowed: true,
    benchmarkStatus: benchmarkStatus(env, "CONSOLE_DEFAULT_WORKER_BENCHMARK_STATUS", "available_unbenchmarked"),
    transportPolicy: NEMOTRON_TOOL_SAFE_POLICY,
  };
}

function routeId(): string {
  return `route_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeModel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractModels(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { data?: unknown; models?: unknown };
  const data = Array.isArray(body.data) ? body.data : [];
  const models = Array.isArray(body.models) ? body.models : [];
  return [...data, ...models].filter((entry): entry is Record<string, unknown> => {
    return !!entry && typeof entry === "object";
  });
}

export async function validateModelEndpoint(
  config: ModelRoleConfig,
  fetchFn: ModelRoleFetch = fetch,
): Promise<ModelEndpointHealth> {
  const checkedAt = new Date().toISOString();
  if (!config.endpoint.trim()) {
    return {
      status: "missing_endpoint",
      endpoint: config.endpoint,
      modelMatched: false,
      modelId: null,
      runtime: null,
      contextWindow: null,
      parameterCount: null,
      sizeBytes: null,
      checkedAt,
      error: "NEMOTRON_ENDPOINT_MISSING",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetchFn(`${config.endpoint.replace(/\/+$/, "")}/models`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "unreachable",
        endpoint: config.endpoint,
        modelMatched: false,
        modelId: null,
        runtime: null,
        contextWindow: null,
        parameterCount: null,
        sizeBytes: null,
        checkedAt,
        error: `NEMOTRON_ENDPOINT_UNREACHABLE:${response.status}`,
      };
    }
    const payload = await response.json();
    const models = extractModels(payload);
    const requested = normalizeModel(config.primaryModel);
    const matched = models.find((model) => {
      const id = String(model.id ?? model.model ?? model.name ?? "");
      return normalizeModel(id).includes(requested) || requested.includes(normalizeModel(id));
    });
    const first = matched ?? models[0] ?? null;
    const meta = first && typeof first.meta === "object" && first.meta ? first.meta as Record<string, unknown> : {};
    if (!matched) {
      return {
        status: "model_mismatch",
        endpoint: config.endpoint,
        modelMatched: false,
        modelId: first ? String(first.id ?? first.model ?? first.name ?? "") : null,
        runtime: first ? String(first.owned_by ?? first.runtime ?? "") || null : null,
        contextWindow: typeof meta.n_ctx_train === "number" ? meta.n_ctx_train : null,
        parameterCount: typeof meta.n_params === "number" ? meta.n_params : null,
        sizeBytes: typeof meta.size === "number" ? meta.size : null,
        checkedAt,
        error: "NEMOTRON_MODEL_UNAVAILABLE",
      };
    }
    return {
      status: "healthy",
      endpoint: config.endpoint,
      modelMatched: true,
      modelId: String(matched.id ?? matched.model ?? matched.name ?? config.primaryModel),
      runtime: String(matched.owned_by ?? matched.runtime ?? config.provider) || null,
      contextWindow: typeof meta.n_ctx_train === "number" ? meta.n_ctx_train : null,
      parameterCount: typeof meta.n_params === "number" ? meta.n_params : null,
      sizeBytes: typeof meta.size === "number" ? meta.size : null,
      checkedAt,
      error: null,
    };
  } catch (error) {
    return {
      status: "unreachable",
      endpoint: config.endpoint,
      modelMatched: false,
      modelId: null,
      runtime: null,
      contextWindow: null,
      parameterCount: null,
      sizeBytes: null,
      checkedAt,
      error: error instanceof Error ? `NEMOTRON_ENDPOINT_UNREACHABLE:${error.message}` : "NEMOTRON_ENDPOINT_UNREACHABLE",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackReason(status: ModelEndpointHealth["status"], benchmark: BenchmarkStatus): string {
  if (status === "missing_endpoint") return "NEMOTRON_ENDPOINT_MISSING";
  if (status === "model_mismatch") return "NEMOTRON_MODEL_UNAVAILABLE";
  if (status === "unreachable") return "NEMOTRON_ENDPOINT_UNREACHABLE";
  if (benchmark !== "benchmark_passed") return "NEMOTRON_NOT_BENCHMARKED";
  return "NEMOTRON_ROUTE_BLOCKED";
}

export async function selectModelRoute(input: {
  roleId: ModelRoleId;
  repositoryWriteRequested: boolean;
  fallbackAllowed?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchFn?: ModelRoleFetch;
}): Promise<ModelRoutingDecision> {
  const env = input.env ?? process.env;
  const requested = getModelRoleConfig(input.roleId, env);
  const health = await validateModelEndpoint(requested, input.fetchFn ?? fetch);
  const fallback = requested.fallbackRoleId ? getModelRoleConfig(requested.fallbackRoleId, env) : null;
  const allowFallback = Boolean(input.fallbackAllowed ?? requested.fallbackAllowed);
  const blockedReason =
    health.status !== "healthy"
      ? fallbackReason(health.status, requested.benchmarkStatus)
      : input.repositoryWriteRequested && requested.benchmarkStatus !== "benchmark_passed"
        ? "NEMOTRON_NOT_BENCHMARKED"
        : null;

  if (blockedReason) {
    if (fallback && allowFallback && fallback.benchmarkStatus === "proven_fallback") {
      return {
        routingDecisionId: routeId(),
        requestedModelRoleId: requested.roleId,
        selectedModelRoleId: fallback.roleId,
        requestedModelName: requested.primaryModel,
        requestedProvider: requested.provider,
        requestedEndpoint: requested.endpoint,
        selectedModelName: fallback.primaryModel,
        selectedProvider: fallback.provider,
        selectedEndpoint: fallback.endpoint,
        runtime: "fallback",
        contextWindow: null,
        transportPolicy: fallback.transportPolicy,
        fallbackUsed: true,
        fallbackReason: blockedReason,
        benchmarkStatus: fallback.benchmarkStatus,
        status: "selected_fallback",
        repositoryWriteAllowed: fallback.repositoryWriteAllowed,
        health,
      };
    }
    return {
      routingDecisionId: routeId(),
      requestedModelRoleId: requested.roleId,
      selectedModelRoleId: null,
      requestedModelName: requested.primaryModel,
      requestedProvider: requested.provider,
      requestedEndpoint: requested.endpoint,
      selectedModelName: null,
      selectedProvider: null,
      selectedEndpoint: null,
      runtime: health.runtime,
      contextWindow: health.contextWindow,
      transportPolicy: requested.transportPolicy,
      fallbackUsed: false,
      fallbackReason: null,
      benchmarkStatus: requested.benchmarkStatus,
      status:
        requested.roleId === "console_senior_worker"
          ? "senior_model_unavailable"
          : blockedReason === "NEMOTRON_NOT_BENCHMARKED"
            ? "blocked_unbenchmarked"
            : health.status === "model_mismatch"
              ? "blocked_model_mismatch"
              : health.status === "missing_endpoint"
                ? "blocked_missing_endpoint"
                : "blocked_unreachable",
      repositoryWriteAllowed: false,
      health,
    };
  }

  return {
    routingDecisionId: routeId(),
    requestedModelRoleId: requested.roleId,
    selectedModelRoleId: requested.roleId,
    requestedModelName: requested.primaryModel,
    requestedProvider: requested.provider,
    requestedEndpoint: requested.endpoint,
    selectedModelName: requested.primaryModel,
    selectedProvider: requested.provider,
    selectedEndpoint: requested.endpoint,
    runtime: health.runtime,
    contextWindow: health.contextWindow,
    transportPolicy: requested.transportPolicy,
    fallbackUsed: false,
    fallbackReason: null,
    benchmarkStatus: requested.benchmarkStatus,
    status: "selected_primary",
    repositoryWriteAllowed: requested.repositoryWriteAllowed,
    health,
  };
}
