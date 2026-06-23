import { describe, expect, it } from "vitest";
import { selectModelRoute, type ModelRoleFetch } from "../model-routing/model-role-routing";
import {
  buildMainlineRuntimeContract,
  CONSOLE_NANO_MAINLINE_ENDPOINT,
  MAINLINE_EVIDENCE_EXPECTATIONS,
  MAINLINE_LIFECYCLE_STATES,
  NANO_MAINLINE_MODEL,
  VERA_NANO_MAINLINE_ENDPOINT,
} from "./mainline-runtime-contract";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;

function jsonFetch(payload: unknown, ok = true, status = ok ? 200 : 503): ModelRoleFetch {
  return (async () => ({
    ok,
    status,
    json: async () => payload,
  })) as unknown as ModelRoleFetch;
}

describe("Phase 20 Nano mainline runtime contract", () => {
  it("identifies Vera Nano as the active intent intake role on 8081", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });
    const vera = contract.activeRoles.find((role) => role.roleId === "vera_command");

    expect(vera).toMatchObject({
      responsibility: "intent_intake_approval_broker",
      endpoint: VERA_NANO_MAINLINE_ENDPOINT,
      expectedEndpoint: "http://127.0.0.1:8081/v1",
      model: NANO_MAINLINE_MODEL,
      runtimeRequired: true,
      healthcheckRequired: true,
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      requiredForMainline: true,
    });
  });

  it("identifies Console Nano as the active governed worker role on 8082", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });
    const consoleWorker = contract.activeRoles.find((role) => role.roleId === "console_default_worker");

    expect(consoleWorker).toMatchObject({
      responsibility: "governed_execution",
      endpoint: CONSOLE_NANO_MAINLINE_ENDPOINT,
      expectedEndpoint: "http://127.0.0.1:8082/v1",
      model: NANO_MAINLINE_MODEL,
      runtimeRequired: true,
      healthcheckRequired: true,
      repositoryWriteAllowed: true,
      fallbackAllowed: false,
      requiredForMainline: true,
    });
  });

  it("records no silent fallback when routing selects the primary Nano worker", async () => {
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      env: {
        CONSOLE_DEFAULT_WORKER_BENCHMARK_STATUS: "benchmark_passed",
      } as unknown as NodeJS.ProcessEnv,
      fetchFn: jsonFetch({ data: [{ id: NANO_MAINLINE_MODEL, owned_by: "vllm" }] }),
    });
    const contract = buildMainlineRuntimeContract({
      env: EMPTY_ENV,
      routingDecisions: [decision],
    });

    expect(decision.status).toBe("selected_primary");
    expect(decision.selectedModelRoleId).toBe("console_default_worker");
    expect(decision.fallbackUsed).toBe(false);
    expect(contract.safetyPolicy.fallbackAllowed).toBe(false);
    expect(contract.safetyPolicy.fallbackUsed).toBe(false);
    expect(contract.diagnostics).not.toContain("MAINLINE_FALLBACK_USED");
  });

  it("does not select or record Qwen as fallback even when fallback env vars mention Qwen", async () => {
    const env = {
      CONSOLE_DEFAULT_WORKER_BENCHMARK_STATUS: "benchmark_passed",
      FALLBACK_WORKER_MODEL_NAME: "Qwen-Fallback-Model",
      FALLBACK_WORKER_ENDPOINT: "http://127.0.0.1:8099/v1",
      FALLBACK_WORKER_BENCHMARK_STATUS: "benchmark_passed",
    } as unknown as NodeJS.ProcessEnv;
    const decision = await selectModelRoute({
      roleId: "console_default_worker",
      repositoryWriteRequested: true,
      env,
      fetchFn: jsonFetch({ data: [{ id: NANO_MAINLINE_MODEL, owned_by: "vllm" }] }),
    });
    const contract = buildMainlineRuntimeContract({ env, routingDecisions: [decision] });

    expect(decision.selectedModelName).toBe(NANO_MAINLINE_MODEL);
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.fallbackReason).toBeNull();
    expect(contract.safetyPolicy.qwenUsed).toBe(false);
    expect(contract.safetyPolicy.qwenFallbackUsed).toBe(false);
    expect(contract.diagnostics).not.toContain("MAINLINE_QWEN_USED");
  });

  it("keeps Super senior blocked and unrequired for mainline", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });
    const superRole = contract.parkedRoles.find((role) => role.roleId === "console_senior_worker");

    expect(superRole).toMatchObject({
      runtimeName: "Nemotron Super senior worker",
      status: "blocked_unproven",
      requiredForMainline: false,
      runtimeRequired: false,
      healthcheckRequired: false,
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      promotionStatus: "blocked_unproven",
    });
    expect(contract.safetyPolicy.superRequiredForMainline).toBe(false);
    expect(contract.safetyPolicy.seniorRuntimeRequired).toBe(false);
  });

  it("keeps Mixtral cold reviewer parked offline and unrequired for mainline", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });
    const mixtralRole = contract.parkedRoles.find((role) => role.roleId === "console_cold_senior_reviewer");

    expect(mixtralRole).toMatchObject({
      runtimeName: "Mixtral cold senior reviewer",
      status: "candidate_unproven",
      requiredForMainline: false,
      runtimeRequired: false,
      healthcheckRequired: false,
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      promotionStatus: "parked_experimental_offline_only",
    });
    expect(mixtralRole?.notes).toContain("offline review job only");
    expect(contract.safetyPolicy.mixtralRequiredForMainline).toBe(false);
  });

  it("defines the full mainline lifecycle through awaiting user approval", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });

    expect(contract.lifecycleStates).toEqual([...MAINLINE_LIFECYCLE_STATES]);
    expect(contract.lifecycleStates).toEqual([
      "intent_intake",
      "console_task_requested",
      "governed_execution",
      "evidence_packaged",
      "awaiting_user_approval",
      "blocked",
      "failed",
    ]);
  });

  it("makes evidence expectations explicit and preserves the approval gate", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });

    expect(contract.evidencePolicy.expectations).toEqual([...MAINLINE_EVIDENCE_EXPECTATIONS]);
    expect(contract.evidencePolicy.expectations).toEqual(expect.arrayContaining([
      "runtime_route_decision_recorded",
      "active_role_assignment_recorded",
      "fallback_status_recorded",
      "qwen_usage_recorded",
      "senior_requirement_recorded",
      "approval_required",
      "integration_not_performed_without_approval",
    ]));
    expect(contract.evidencePolicy.approvalRequired).toBe(true);
    expect(contract.evidencePolicy.integrationAllowedBeforeApproval).toBe(false);
    expect(contract.evidencePolicy.integrationPerformed).toBe(false);
    expect(contract.safetyPolicy.approvalRequiredBeforeIntegration).toBe(true);
  });

  it("builds a usable mainline contract without Super or Mixtral runtime health", () => {
    const contract = buildMainlineRuntimeContract({ env: EMPTY_ENV });

    expect(contract.status).toBe("usable_without_senior_runtime");
    expect(contract.statusSummary).toContain("senior runtimes are parked and not required");
    expect(contract.activeRoles.map((role) => role.roleId)).toEqual([
      "vera_command",
      "console_default_worker",
    ]);
    expect(contract.parkedRoles.map((role) => role.roleId)).toEqual([
      "console_senior_worker",
      "console_cold_senior_reviewer",
    ]);
    expect(contract.diagnostics).toEqual([]);
  });
});
