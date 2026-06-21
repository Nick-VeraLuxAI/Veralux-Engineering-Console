import { selectModelRoute, type ModelRoleId } from "./model-role-routing";

export interface ModelRoleBenchmarkOptions {
  role: ModelRoleId;
  dryRun?: boolean;
  shadow?: boolean;
  readOnly?: boolean;
  noWrites?: boolean;
  fetchFn?: typeof fetch;
}

export interface ModelRoleBenchmarkResult {
  role: ModelRoleId;
  status: "blocked_missing_model" | "blocked_unbenchmarked" | "ready_for_benchmark";
  mode: "dry_run" | "shadow" | "read_only" | "tool_limited";
  routingDecisionId: string;
  selectedModelRoleId: ModelRoleId | null;
  selectedModelName: string | null;
  fallbackUsed: boolean;
  reason: string | null;
  writesAllowed: boolean;
}

export async function runModelRoleBenchmark(
  options: ModelRoleBenchmarkOptions,
): Promise<ModelRoleBenchmarkResult> {
  const writesRequested = !(options.dryRun || options.shadow || options.readOnly || options.noWrites);
  const decision = await selectModelRoute({
    roleId: options.role,
    repositoryWriteRequested: writesRequested,
    fetchFn: options.fetchFn,
  });
  const mode = options.dryRun
    ? "dry_run"
    : options.shadow
      ? "shadow"
      : options.readOnly || options.noWrites
        ? "read_only"
        : "tool_limited";
  const blockedMissing =
    decision.status === "blocked_missing_endpoint" ||
    decision.status === "blocked_unreachable" ||
    decision.status === "blocked_not_openai_compatible" ||
    decision.status === "blocked_model_mismatch" ||
    decision.status === "senior_model_unavailable";

  return {
    role: options.role,
    status:
      blockedMissing
        ? "blocked_missing_model"
        : decision.benchmarkStatus === "benchmark_passed"
          ? "ready_for_benchmark"
          : "blocked_unbenchmarked",
    mode,
    routingDecisionId: decision.routingDecisionId,
    selectedModelRoleId: decision.selectedModelRoleId,
    selectedModelName: decision.selectedModelName,
    fallbackUsed: decision.fallbackUsed,
    reason: decision.fallbackReason ?? decision.health.error,
    writesAllowed: decision.repositoryWriteAllowed && writesRequested,
  };
}
