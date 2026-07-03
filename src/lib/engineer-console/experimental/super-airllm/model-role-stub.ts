/** Experimental Super/AirLLM proof role stub (from work/autonomous-phase-proof). Not for production routing. */
export type ModelRoleId =
  | "vera_command"
  | "console_default_worker"
  | "console_senior_worker"
  | "console_cold_senior_reviewer";

export type BenchmarkStatus =
  | "missing_model"
  | "endpoint_unreachable"
  | "model_mismatch"
  | "available_unbenchmarked"
  | "benchmark_failed"
  | "benchmark_passed";

export type ModelRouteStatus =
  | "selected_primary"
  | "blocked_missing_endpoint"
  | "blocked_unreachable"
  | "blocked_not_openai_compatible"
  | "blocked_model_mismatch"
  | "blocked_unbenchmarked"
  | "blocked_role_disabled"
  | "senior_model_unavailable";

export type ModelRoleAssignmentStatus =
  | "available"
  | "candidate_unproven"
  | "candidate_proven_import_only"
  | "candidate_proven_boot"
  | "candidate_proven_bounded_review"
  | "candidate_failed"
  | "blocked_unproven"
  | "blocked_unknown_role";

export interface ModelTransportPolicy {
  toolStreamingSupported: boolean;
  parallelToolCallsSupported: boolean;
  textStreamingSupported: boolean;
  nonstreamingToolTurns: boolean;
}

export interface ModelRoleAssignment {
  roleId: ModelRoleId | string;
  roleKind: "command" | "worker" | "senior_worker" | "unknown";
  provider: string | null;
  endpoint: string | null;
  model: string | null;
  status: ModelRoleAssignmentStatus;
  repositoryWriteAllowed: boolean;
  fallbackAllowed: boolean;
  allowedFallbackRoles: ModelRoleId[];
  runtimeRequired: boolean;
  healthcheckRequired: boolean;
  notes: string | null;
}

export interface ModelRoleConfig {
  roleId: ModelRoleId;
  primaryModel: string;
  provider: string;
  endpoint: string;
  enabled: boolean;
  repositoryWriteAllowed: boolean;
  benchmarkStatus: BenchmarkStatus;
  transportPolicy: ModelTransportPolicy;
}

export interface ModelEndpointHealth {
  status: "healthy" | "missing_endpoint" | "unreachable" | "not_openai_compatible" | "model_mismatch";
  endpoint: string;
  modelsUrl: string | null;
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
  blockedReason: string | null;
  benchmarkStatus: BenchmarkStatus;
  status: ModelRouteStatus;
  repositoryWriteAllowed: boolean;
  health: ModelEndpointHealth;
  blockedDetails: {
    role: ModelRoleId;
    expectedEndpoint: string;
    expectedModel: string;
    failureReason: string;
    nextOperatorAction: string;
  } | null;
}

export interface ModelRoleRuntimeRecord {
  roleId: ModelRoleId;
  configuredEndpoint: string;
  actualEndpoint: string | null;
  configuredModelName: string;
  actualModelId: string | null;
  provider: string;
  runtime: string | null;
  contextWindow: number | null;
  parameterCount: number | null;
  sizeBytes: number | null;
  transportPolicy: ModelTransportPolicy;
  healthTimestamp: string;
  healthStatus: ModelEndpointHealth["status"];
}

export type ModelRoleFetch = typeof fetch;

const MODEL_ROLE_IDS = new Set<string>([
  "vera_command",
  "console_default_worker",
  "console_senior_worker",
]);

const NEMOTRON_TOOL_SAFE_POLICY: ModelTransportPolicy = {
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

function activeAssignment(input: {
  roleId: ModelRoleId;
  roleKind: ModelRoleAssignment["roleKind"];
  provider: string;
  endpoint: string;
  model: string;
  repositoryWriteAllowed: boolean;
  notes: string;
}): ModelRoleAssignment {
  return {
    roleId: input.roleId,
    roleKind: input.roleKind,
    provider: input.provider,
    endpoint: input.endpoint,
    model: input.model,
    status: "available",
    repositoryWriteAllowed: input.repositoryWriteAllowed,
    fallbackAllowed: false,
    allowedFallbackRoles: [],
    runtimeRequired: true,
    healthcheckRequired: true,
    notes: input.notes,
  };
}

export function resolveModelRole(
  roleId: ModelRoleId | string,
  env: NodeJS.ProcessEnv = process.env,
): ModelRoleAssignment {
  if (roleId === "vera_command") {
    return activeAssignment({
      roleId,
      roleKind: "command",
      provider: envValue(env, "VERA_COMMAND_MODEL_PROVIDER", "local_openai_compatible"),
      endpoint: envValue(env, "VERA_COMMAND_MODEL_ENDPOINT", "http://127.0.0.1:8081/v1"),
      model: envValue(env, "VERA_COMMAND_MODEL_NAME", "Nemotron-Nano-30B-A3B-NVFP4"),
      repositoryWriteAllowed: false,
      notes: "Vera command/orchestration role; repository writes are not allowed.",
    });
  }
  if (roleId === "console_default_worker") {
    return activeAssignment({
      roleId,
      roleKind: "worker",
      provider: envValue(env, "CONSOLE_DEFAULT_WORKER_PROVIDER", "local_openai_compatible"),
      endpoint: envValue(env, "CONSOLE_DEFAULT_WORKER_ENDPOINT", "http://127.0.0.1:8082/v1"),
      model: envValue(env, "CONSOLE_DEFAULT_WORKER_MODEL_NAME", "Nemotron-Nano-30B-A3B-NVFP4"),
      repositoryWriteAllowed: true,
      notes: "Console default worker; writes are allowed only inside governed Console workspaces.",
    });
  }
  if (roleId === "console_senior_worker") {
    return {
      roleId,
      roleKind: "senior_worker",
      provider: envValue(env, "CONSOLE_SENIOR_WORKER_PROVIDER", "airllm-cold"),
      endpoint: envValue(
        env,
        "CONSOLE_SENIOR_WORKER_ENDPOINT",
        "airllm:///mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
      ),
      model: envValue(env, "CONSOLE_SENIOR_WORKER_MODEL_NAME", "Nemotron-Super-120B-A12B-FP8"),
      status: "blocked_unproven",
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      allowedFallbackRoles: [],
      runtimeRequired: false,
      healthcheckRequired: false,
      notes: "Senior role is intentionally blocked in Phase 3; do not start AirLLM/Super.",
    };
  }
  if (roleId === "console_cold_senior_reviewer") {
    return {
      roleId,
      roleKind: "senior_worker",
      provider: "airllm-cold",
      endpoint: envValue(
        env,
        "CONSOLE_COLD_SENIOR_REVIEWER_ENDPOINT",
        "airllm:///mnt/model-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1",
      ),
      model: envValue(env, "CONSOLE_COLD_SENIOR_REVIEWER_MODEL_NAME", "mistralai/Mixtral-8x22B-Instruct-v0.1"),
      status: "candidate_unproven",
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      allowedFallbackRoles: [],
      runtimeRequired: false,
      healthcheckRequired: false,
      notes: "Phase 16 cold senior reviewer candidate; offline review job only, no routing promotion.",
    };
  }
  return {
    roleId,
    roleKind: "unknown",
    provider: null,
    endpoint: null,
    model: null,
    status: "blocked_unknown_role",
    repositoryWriteAllowed: false,
    fallbackAllowed: false,
    allowedFallbackRoles: [],
    runtimeRequired: false,
    healthcheckRequired: false,
    notes: "Unknown model role; fail closed without fallback.",
  };
}

export function listModelRoleAssignments(env: NodeJS.ProcessEnv = process.env): ModelRoleAssignment[] {
  return [
    resolveModelRole("vera_command", env),
    resolveModelRole("console_default_worker", env),
    resolveModelRole("console_senior_worker", env),
  ];
}

export function validateModelRoleAssignment(assignment: ModelRoleAssignment): string[] {
  const diagnostics: string[] = [];
  if (assignment.status === "available") {
    if (!assignment.provider) diagnostics.push(`${assignment.roleId}:ACTIVE_ROLE_PROVIDER_REQUIRED`);
    if (!assignment.model) diagnostics.push(`${assignment.roleId}:ACTIVE_ROLE_MODEL_REQUIRED`);
    if (assignment.runtimeRequired && !assignment.endpoint) {
      diagnostics.push(`${assignment.roleId}:ACTIVE_ROLE_ENDPOINT_REQUIRED`);
    }
  }
  if (assignment.fallbackAllowed && assignment.allowedFallbackRoles.length === 0) {
    diagnostics.push(`${assignment.roleId}:FALLBACK_ROLES_REQUIRED_WHEN_FALLBACK_ALLOWED`);
  }
  if (JSON.stringify(assignment).toLowerCase().includes("qwen")) {
    diagnostics.push(`${assignment.roleId}:QWEN_FALLBACK_FORBIDDEN`);
  }
  if (assignment.roleId === "console_senior_worker" && assignment.status === "available") {
    diagnostics.push(`${assignment.roleId}:SENIOR_ROLE_MUST_REMAIN_BLOCKED_IN_PHASE_3`);
  }
  if (assignment.roleId === "vera_command" && assignment.repositoryWriteAllowed) {
    diagnostics.push(`${assignment.roleId}:VERA_REPOSITORY_WRITE_FORBIDDEN`);
  }
  return diagnostics;
}

function runtimeProviderForAssignment(assignment: ModelRoleAssignment): string {
  if (assignment.provider === "local_openai_compatible") return "custom";
  return assignment.provider ?? "";
}

function blockedDetails(
  config: ModelRoleConfig,
  failureReason: string,
): ModelRoutingDecision["blockedDetails"] {
  const nextOperatorAction =
    config.roleId === "console_senior_worker"
      ? "Run the AirLLM Super cold-escalation compatibility probe and mark the senior role benchmark-passed only after it succeeds."
      : `Start the configured Nemotron Nano NVFP4 service and verify ${config.endpoint}/models returns ${config.primaryModel}.`;
  return {
    role: config.roleId,
    expectedEndpoint: config.endpoint,
    expectedModel: config.primaryModel,
    failureReason,
    nextOperatorAction,
  };
}

export function getModelRoleConfig(
  roleId: ModelRoleId,
  env: NodeJS.ProcessEnv = process.env,
): ModelRoleConfig {
  if (!MODEL_ROLE_IDS.has(roleId)) {
    throw new Error(`NEMOTRON_ROLE_DISABLED:${roleId}`);
  }
  const assignment = resolveModelRole(roleId, env);
  if (roleId === "console_senior_worker") {
    return {
      roleId,
      primaryModel: assignment.model ?? "",
      provider: runtimeProviderForAssignment(assignment),
      endpoint: assignment.endpoint ?? "",
      enabled: envBool(env.CONSOLE_SENIOR_WORKER_ENABLED, true),
      repositoryWriteAllowed: false,
      benchmarkStatus: benchmarkStatus(env, "CONSOLE_SENIOR_WORKER_BENCHMARK_STATUS", "missing_model"),
      transportPolicy: NEMOTRON_TOOL_SAFE_POLICY,
    };
  }

  if (roleId === "vera_command") {
    return {
      roleId,
      primaryModel: assignment.model ?? "",
      provider: runtimeProviderForAssignment(assignment),
      endpoint: assignment.endpoint ?? "",
      enabled: envBool(env.VERA_COMMAND_MODEL_ENABLED, true),
      repositoryWriteAllowed: false,
      benchmarkStatus: benchmarkStatus(env, "VERA_COMMAND_MODEL_BENCHMARK_STATUS", "available_unbenchmarked"),
      transportPolicy: NEMOTRON_TOOL_SAFE_POLICY,
    };
  }

  return {
    roleId,
    primaryModel: assignment.model ?? "",
    provider: runtimeProviderForAssignment(assignment),
    endpoint: assignment.endpoint ?? "",
    enabled: envBool(env.CONSOLE_DEFAULT_WORKER_ENABLED, true),
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

export function normalizeOpenAIModelsUrl(endpoint: string): string {
  const raw = endpoint.trim();
  if (!raw) return "";
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "") {
    url.pathname = "/v1/models";
  } else if (path.endsWith("/v1")) {
    url.pathname = `${path}/models`;
  } else if (path.endsWith("/v1/models")) {
    url.pathname = path;
  } else {
    url.pathname = `${path}/v1/models`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
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
  if (config.provider === "airllm-cold") {
    return {
      status: "missing_endpoint",
      endpoint: config.endpoint,
      modelsUrl: null,
      modelMatched: false,
      modelId: null,
      runtime: "airllm-cold",
      contextWindow: null,
      parameterCount: null,
      sizeBytes: null,
      checkedAt,
      error: "NEMOTRON_SUPER_AIRLLM_UNPROVEN",
    };
  }
  if (!config.endpoint.trim()) {
    return {
      status: "missing_endpoint",
      endpoint: config.endpoint,
      modelsUrl: null,
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
    const modelsUrl = normalizeOpenAIModelsUrl(config.endpoint);
    const response = await fetchFn(modelsUrl, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: response.status === 404 ? "not_openai_compatible" : "unreachable",
        endpoint: config.endpoint,
        modelsUrl,
        modelMatched: false,
        modelId: null,
        runtime: null,
        contextWindow: null,
        parameterCount: null,
        sizeBytes: null,
        checkedAt,
        error: response.status === 404
          ? "NEMOTRON_ENDPOINT_NOT_OPENAI_COMPATIBLE:404"
          : `NEMOTRON_ENDPOINT_UNREACHABLE:${response.status}`,
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
        modelsUrl,
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
      modelsUrl,
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
    let modelsUrl: string | null = null;
    try {
      modelsUrl = config.endpoint.trim() ? normalizeOpenAIModelsUrl(config.endpoint) : null;
    } catch {
      modelsUrl = null;
    }
    return {
      status: "unreachable",
      endpoint: config.endpoint,
      modelsUrl,
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
  if (status === "not_openai_compatible") return "NEMOTRON_ENDPOINT_NOT_OPENAI_COMPATIBLE";
  if (status === "unreachable") return "NEMOTRON_ENDPOINT_UNREACHABLE";
  if (benchmark !== "benchmark_passed") return "NEMOTRON_NOT_BENCHMARKED";
  return "NEMOTRON_ROUTE_BLOCKED";
}

function roleUnavailableReason(roleId: ModelRoleId): string {
  if (roleId === "vera_command") return "NEMOTRON_COMMAND_MODEL_UNAVAILABLE";
  if (roleId === "console_senior_worker") return "NEMOTRON_SENIOR_WORKER_UNAVAILABLE";
  return "NEMOTRON_DEFAULT_WORKER_UNAVAILABLE";
}

export async function selectModelRoute(input: {
  roleId: ModelRoleId;
  repositoryWriteRequested: boolean;
  env?: NodeJS.ProcessEnv;
  fetchFn?: ModelRoleFetch;
}): Promise<ModelRoutingDecision> {
  const env = input.env ?? process.env;
  const requested = getModelRoleConfig(input.roleId, env);
  if (!requested.enabled) {
    const health = await validateModelEndpoint(requested, input.fetchFn ?? fetch);
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
      blockedReason: "NEMOTRON_ROLE_DISABLED",
      benchmarkStatus: requested.benchmarkStatus,
      status: "blocked_role_disabled",
      repositoryWriteAllowed: false,
      health: { ...health, error: "NEMOTRON_ROLE_DISABLED" },
      blockedDetails: blockedDetails(requested, "NEMOTRON_ROLE_DISABLED"),
    };
  }
  const health = await validateModelEndpoint(requested, input.fetchFn ?? fetch);
  const blockedReason =
    health.status !== "healthy"
      ? fallbackReason(health.status, requested.benchmarkStatus)
      : input.repositoryWriteRequested && requested.benchmarkStatus !== "benchmark_passed"
        ? "NEMOTRON_NOT_BENCHMARKED"
        : null;

  if (blockedReason) {
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
      blockedReason: roleUnavailableReason(requested.roleId),
      benchmarkStatus: requested.benchmarkStatus,
      status:
        requested.roleId === "console_senior_worker"
          ? "senior_model_unavailable"
          : blockedReason === "NEMOTRON_NOT_BENCHMARKED"
            ? "blocked_unbenchmarked"
            : health.status === "model_mismatch"
              ? "blocked_model_mismatch"
              : health.status === "not_openai_compatible"
                ? "blocked_not_openai_compatible"
              : health.status === "missing_endpoint"
                ? "blocked_missing_endpoint"
                : "blocked_unreachable",
      repositoryWriteAllowed: false,
      health,
      blockedDetails: blockedDetails(requested, health.error ?? blockedReason),
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
    blockedReason: null,
    benchmarkStatus: requested.benchmarkStatus,
    status: "selected_primary",
    repositoryWriteAllowed: requested.repositoryWriteAllowed,
    health,
    blockedDetails: null,
  };
}

export function roleRuntimeRecordFromHealth(
  config: ModelRoleConfig,
  health: ModelEndpointHealth,
): ModelRoleRuntimeRecord {
  return {
    roleId: config.roleId,
    configuredEndpoint: config.endpoint,
    actualEndpoint: health.status === "healthy" ? health.endpoint : null,
    configuredModelName: config.primaryModel,
    actualModelId: health.status === "healthy" ? health.modelId : null,
    provider: config.provider,
    runtime: health.runtime,
    contextWindow: health.contextWindow,
    parameterCount: health.parameterCount,
    sizeBytes: health.sizeBytes,
    transportPolicy: config.transportPolicy,
    healthTimestamp: health.checkedAt,
    healthStatus: health.status,
  };
}
