import { execFile } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import {
  listModelRoleAssignments,
  normalizeOpenAIModelsUrl,
  resolveModelRole,
  validateModelRoleAssignment,
  type ModelRoleAssignment,
  type ModelRoleFetch,
} from "../model-role-stub";

const execFileAsync = promisify(execFile);

export type RuntimeRoleHealthStatus = "healthy" | "unhealthy" | "missing" | "blocked" | "unknown";
export type RuntimeSupervisorStatus = "healthy" | "degraded" | "blocked";
export type RuntimeCheckStatus = "passed" | "failed" | "skipped";
export type RuntimeRecoveryStatus =
  | "not_attempted"
  | "unsupported"
  | "blocked"
  | "attempted"
  | "recovered"
  | "failed";

export interface RuntimeRecoveryTarget {
  kind: "docker_container";
  name: string;
}

export interface RuntimeRecoveryPlan {
  role_id: string;
  supported: boolean;
  target: RuntimeRecoveryTarget | null;
  reason: string | null;
}

export interface RuntimeRecoveryResult {
  status: RuntimeRecoveryStatus;
  attempted: boolean;
  target: RuntimeRecoveryTarget | null;
  command: string | null;
  diagnostics: string[];
  post_recovery_health: RuntimeRoleHealth | null;
}

export interface RuntimeSmokeCheck {
  status: RuntimeCheckStatus;
  expected_content: string | null;
  actual_content: string | null;
  error: string | null;
}

export interface RuntimeRoleHealth {
  role_id: string;
  endpoint: string | null;
  expected_model: string | null;
  status: RuntimeRoleHealthStatus;
  models_endpoint_ok: boolean;
  expected_model_present: boolean;
  smoke_check_ok: boolean | null;
  smoke_check: RuntimeSmokeCheck;
  latency_ms: number | null;
  runtime_required: boolean;
  recovery_supported: boolean;
  recovery_attempted: boolean;
  recovery_result: RuntimeRecoveryResult | null;
  model_names_returned: string[];
  diagnostics: string[];
  evidence_path: string | null;
}

export interface RuntimeSupervisorReport {
  report_schema: "runtime_supervisor.phase_6.v1";
  generated_at: string;
  status: RuntimeSupervisorStatus;
  check_only: boolean;
  recovery_enabled: boolean;
  roles_checked: string[];
  required_roles: string[];
  role_assignments: ModelRoleAssignment[];
  role_health: RuntimeRoleHealth[];
  recovery_plans: RuntimeRecoveryPlan[];
  blocked_reasons: string[];
  safety_notes: string[];
  fallback_used: false;
  airllm_super_used: false;
  qwen_used: false;
  integration_performed: false;
  evidence_path: string;
}

export interface RuntimeSupervisorOptions {
  env?: NodeJS.ProcessEnv;
  fetchFn?: ModelRoleFetch;
  smokeChecks?: boolean;
  recover?: boolean;
  evidenceRoot?: string;
  now?: () => Date;
  recoveryRunner?: RuntimeRecoveryRunner;
}

export type RuntimeRecoveryRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export const PHASE_6_ALLOWED_NANO_RECOVERY_TARGETS: Record<string, RuntimeRecoveryTarget> = {
  vera_command: {
    kind: "docker_container",
    name: "nemotron-nano-vera-8081",
  },
  console_default_worker: {
    kind: "docker_container",
    name: "nemotron-nano-console-8082",
  },
};

function normalizeModel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { data?: unknown; models?: unknown };
  const data = Array.isArray(body.data) ? body.data : [];
  const models = Array.isArray(body.models) ? body.models : [];
  return [...data, ...models]
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const model = entry as Record<string, unknown>;
      return String(model.id ?? model.model ?? model.name ?? "");
    })
    .filter(Boolean);
}

function normalizeOpenAIChatUrl(endpoint: string): string {
  const modelsUrl = new URL(normalizeOpenAIModelsUrl(endpoint));
  modelsUrl.pathname = modelsUrl.pathname.replace(/\/models$/, "/chat/completions");
  return modelsUrl.toString();
}

function expectedSmokeContent(roleId: string): string | null {
  if (roleId === "vera_command") return "Vera route ready";
  if (roleId === "console_default_worker") return "Console route ready";
  return null;
}

async function fetchWithTimeout(
  fetchFn: ModelRoleFetch,
  url: string,
  init: RequestInit,
  timeoutMs = 5_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function roleStatusForBlockedAssignment(assignment: ModelRoleAssignment): RuntimeRoleHealthStatus {
  if (assignment.status === "blocked_unknown_role") return "unknown";
  if (assignment.status === "blocked_unproven") return "blocked";
  return assignment.runtimeRequired ? "missing" : "blocked";
}

function recoveryPlanForRole(roleId: string): RuntimeRecoveryPlan {
  const target = PHASE_6_ALLOWED_NANO_RECOVERY_TARGETS[roleId] ?? null;
  if (!target) {
    return {
      role_id: roleId,
      supported: false,
      target: null,
      reason: "PHASE_6_RECOVERY_TARGET_NOT_ALLOWLISTED",
    };
  }
  return {
    role_id: roleId,
    supported: true,
    target,
    reason: null,
  };
}

async function defaultRecoveryRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, args, { maxBuffer: 2 * 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function runSmokeCheck(input: {
  assignment: ModelRoleAssignment;
  fetchFn: ModelRoleFetch;
  expectedContent: string | null;
}): Promise<RuntimeSmokeCheck> {
  if (!input.expectedContent) {
    return {
      status: "skipped",
      expected_content: null,
      actual_content: null,
      error: "PHASE_6_SMOKE_CHECK_NOT_DEFINED_FOR_ROLE",
    };
  }
  if (!input.assignment.endpoint || !input.assignment.model) {
    return {
      status: "failed",
      expected_content: input.expectedContent,
      actual_content: null,
      error: "PHASE_6_SMOKE_CHECK_ENDPOINT_OR_MODEL_MISSING",
    };
  }

  try {
    const response = await fetchWithTimeout(input.fetchFn, normalizeOpenAIChatUrl(input.assignment.endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.assignment.model,
        messages: [
          {
            role: "user",
            content: `Reply with exactly: ${input.expectedContent}`,
          },
        ],
        max_tokens: 24,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!response.ok) {
      return {
        status: "failed",
        expected_content: input.expectedContent,
        actual_content: null,
        error: `PHASE_6_SMOKE_CHECK_HTTP_${response.status}`,
      };
    }
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
    };
    const actualContent = String(
      body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? "",
    ).trim();
    return {
      status: actualContent.includes(input.expectedContent) ? "passed" : "failed",
      expected_content: input.expectedContent,
      actual_content: actualContent,
      error: actualContent.includes(input.expectedContent) ? null : "PHASE_6_SMOKE_CHECK_CONTENT_MISMATCH",
    };
  } catch (error) {
    return {
      status: "failed",
      expected_content: input.expectedContent,
      actual_content: null,
      error: error instanceof Error ? `PHASE_6_SMOKE_CHECK_FAILED:${error.message}` : "PHASE_6_SMOKE_CHECK_FAILED",
    };
  }
}

export async function checkRuntimeRoleHealth(input: {
  roleId: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: ModelRoleFetch;
  smokeChecks?: boolean;
  evidencePath?: string | null;
}): Promise<RuntimeRoleHealth> {
  const startedAt = Date.now();
  const assignment = resolveModelRole(input.roleId, input.env);
  const fetchFn = input.fetchFn ?? fetch;
  const diagnostics = validateModelRoleAssignment(assignment);
  const plan = recoveryPlanForRole(input.roleId);
  const base = {
    role_id: assignment.roleId,
    endpoint: assignment.endpoint,
    expected_model: assignment.model,
    runtime_required: assignment.runtimeRequired,
    recovery_supported: plan.supported && assignment.runtimeRequired,
    recovery_attempted: false,
    recovery_result: null,
    diagnostics,
    evidence_path: input.evidencePath ?? null,
  };

  if (assignment.status !== "available") {
    return {
      ...base,
      status: roleStatusForBlockedAssignment(assignment),
      models_endpoint_ok: false,
      expected_model_present: false,
      smoke_check_ok: null,
      smoke_check: {
        status: "skipped",
        expected_content: null,
        actual_content: null,
        error: assignment.status === "blocked_unproven"
          ? "PHASE_6_BLOCKED_ROLE_NOT_RUNTIME_REQUIRED"
          : "PHASE_6_UNKNOWN_ROLE_FAIL_CLOSED",
      },
      latency_ms: Date.now() - startedAt,
      recovery_supported: false,
      model_names_returned: [],
    };
  }

  if (!assignment.endpoint || !assignment.model) {
    return {
      ...base,
      status: "missing",
      models_endpoint_ok: false,
      expected_model_present: false,
      smoke_check_ok: null,
      smoke_check: {
        status: "skipped",
        expected_content: expectedSmokeContent(assignment.roleId),
        actual_content: null,
        error: "PHASE_6_ENDPOINT_OR_MODEL_MISSING",
      },
      latency_ms: Date.now() - startedAt,
      model_names_returned: [],
    };
  }

  let modelNames: string[] = [];
  try {
    const response = await fetchWithTimeout(fetchFn, normalizeOpenAIModelsUrl(assignment.endpoint), { method: "GET" });
    if (!response.ok) {
      return {
        ...base,
        status: response.status === 404 ? "missing" : "unhealthy",
        models_endpoint_ok: false,
        expected_model_present: false,
        smoke_check_ok: null,
        smoke_check: {
          status: "skipped",
          expected_content: expectedSmokeContent(assignment.roleId),
          actual_content: null,
          error: `PHASE_6_MODELS_ENDPOINT_HTTP_${response.status}`,
        },
        latency_ms: Date.now() - startedAt,
        model_names_returned: [],
      };
    }
    modelNames = extractModelNames(await response.json());
  } catch (error) {
    return {
      ...base,
      status: "missing",
      models_endpoint_ok: false,
      expected_model_present: false,
      smoke_check_ok: null,
      smoke_check: {
        status: "skipped",
        expected_content: expectedSmokeContent(assignment.roleId),
        actual_content: null,
        error: error instanceof Error ? `PHASE_6_MODELS_ENDPOINT_UNREACHABLE:${error.message}` : "PHASE_6_MODELS_ENDPOINT_UNREACHABLE",
      },
      latency_ms: Date.now() - startedAt,
      model_names_returned: [],
    };
  }

  const expected = normalizeModel(assignment.model);
  const expectedPresent = modelNames.some((modelName) => {
    const actual = normalizeModel(modelName);
    return actual.includes(expected) || expected.includes(actual);
  });
  const smokeCheck = input.smokeChecks === false
    ? {
      status: "skipped" as const,
      expected_content: expectedSmokeContent(assignment.roleId),
      actual_content: null,
      error: "PHASE_6_SMOKE_CHECK_DISABLED",
    }
    : await runSmokeCheck({
      assignment,
      fetchFn,
      expectedContent: expectedSmokeContent(assignment.roleId),
    });
  const smokeOk = smokeCheck.status === "passed"
    ? true
    : smokeCheck.status === "skipped"
      ? null
      : false;

  return {
    ...base,
    status: expectedPresent && smokeOk !== false ? "healthy" : "unhealthy",
    models_endpoint_ok: true,
    expected_model_present: expectedPresent,
    smoke_check_ok: smokeOk,
    smoke_check: smokeCheck,
    latency_ms: Date.now() - startedAt,
    model_names_returned: modelNames,
  };
}

export async function recoverRuntimeRole(input: {
  health: RuntimeRoleHealth;
  env?: NodeJS.ProcessEnv;
  fetchFn?: ModelRoleFetch;
  smokeChecks?: boolean;
  recover: boolean;
  recoveryRunner?: RuntimeRecoveryRunner;
}): Promise<RuntimeRecoveryResult> {
  const plan = recoveryPlanForRole(input.health.role_id);
  if (!input.recover) {
    return {
      status: "not_attempted",
      attempted: false,
      target: plan.target,
      command: null,
      diagnostics: ["PHASE_6_CHECK_ONLY_RECOVERY_NOT_ATTEMPTED"],
      post_recovery_health: null,
    };
  }
  if (!plan.supported || !plan.target) {
    return {
      status: "unsupported",
      attempted: false,
      target: null,
      command: null,
      diagnostics: ["PHASE_6_RECOVERY_TARGET_NOT_ALLOWLISTED"],
      post_recovery_health: null,
    };
  }
  if (!input.health.runtime_required || input.health.status === "blocked" || input.health.role_id === "console_senior_worker") {
    return {
      status: "blocked",
      attempted: false,
      target: plan.target,
      command: null,
      diagnostics: ["PHASE_6_RECOVERY_BLOCKED_FOR_NON_REQUIRED_OR_SENIOR_ROLE"],
      post_recovery_health: null,
    };
  }
  if (input.health.status === "healthy") {
    return {
      status: "not_attempted",
      attempted: false,
      target: plan.target,
      command: null,
      diagnostics: ["PHASE_6_ROLE_ALREADY_HEALTHY"],
      post_recovery_health: null,
    };
  }

  const runner = input.recoveryRunner ?? defaultRecoveryRunner;
  const command = `docker restart ${plan.target.name}`;
  try {
    await runner("docker", ["restart", plan.target.name]);
    const postRecoveryHealth = await checkRuntimeRoleHealth({
      roleId: input.health.role_id,
      env: input.env,
      fetchFn: input.fetchFn,
      smokeChecks: input.smokeChecks,
    });
    return {
      status: postRecoveryHealth.status === "healthy" ? "recovered" : "failed",
      attempted: true,
      target: plan.target,
      command,
      diagnostics: postRecoveryHealth.status === "healthy"
        ? ["PHASE_6_RECOVERY_POSTCHECK_HEALTHY"]
        : ["PHASE_6_RECOVERY_POSTCHECK_NOT_HEALTHY"],
      post_recovery_health: postRecoveryHealth,
    };
  } catch (error) {
    return {
      status: "failed",
      attempted: true,
      target: plan.target,
      command,
      diagnostics: [
        error instanceof Error ? `PHASE_6_RECOVERY_COMMAND_FAILED:${error.message}` : "PHASE_6_RECOVERY_COMMAND_FAILED",
      ],
      post_recovery_health: null,
    };
  }
}

export async function checkAllRequiredRuntimeRoles(
  options: RuntimeSupervisorOptions = {},
): Promise<{ roleHealth: RuntimeRoleHealth[]; recoveryPlans: RuntimeRecoveryPlan[] }> {
  const assignments = listModelRoleAssignments(options.env);
  const roleHealth = await Promise.all(assignments.map((assignment) => checkRuntimeRoleHealth({
    roleId: assignment.roleId,
    env: options.env,
    fetchFn: options.fetchFn,
    smokeChecks: options.smokeChecks,
  })));
  const recoveredHealth: RuntimeRoleHealth[] = [];
  for (const health of roleHealth) {
    if (health.runtime_required && health.status !== "healthy") {
      const result = await recoverRuntimeRole({
        health,
        env: options.env,
        fetchFn: options.fetchFn,
        smokeChecks: options.smokeChecks,
        recover: options.recover === true,
        recoveryRunner: options.recoveryRunner,
      });
      recoveredHealth.push({
        ...(result.post_recovery_health ?? health),
        recovery_attempted: result.attempted,
        recovery_result: result,
      });
    } else {
      recoveredHealth.push(health);
    }
  }
  return {
    roleHealth: recoveredHealth,
    recoveryPlans: assignments.map((assignment) => recoveryPlanForRole(assignment.roleId)),
  };
}

function supervisorStatus(roleHealth: RuntimeRoleHealth[]): RuntimeSupervisorStatus {
  const required = roleHealth.filter((health) => health.runtime_required);
  if (required.some((health) => health.status === "missing" || health.status === "unknown")) return "blocked";
  if (required.every((health) => health.status === "healthy")) return "healthy";
  return "degraded";
}

function blockedReasons(roleHealth: RuntimeRoleHealth[]): string[] {
  return roleHealth.flatMap((health) => {
    if (!health.runtime_required || health.status === "healthy") return [];
    return [
      `${health.role_id}:PHASE_6_REQUIRED_RUNTIME_${health.status.toUpperCase()}`,
      ...health.diagnostics,
      health.smoke_check.error,
      health.recovery_result?.diagnostics.join(";") ?? null,
    ].filter((entry): entry is string => !!entry);
  });
}

export async function runRuntimeSupervisorPreflight(
  options: RuntimeSupervisorOptions = {},
): Promise<RuntimeSupervisorReport> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const evidenceRoot = options.evidenceRoot ?? "evidence/runtime-supervisor";
  const evidencePath = path.join(evidenceRoot, `runtime-supervisor-${generatedAt.replace(/[:.]/g, "-")}.json`);
  const assignments = listModelRoleAssignments(options.env);
  const { roleHealth, recoveryPlans } = await checkAllRequiredRuntimeRoles(options);
  const report: RuntimeSupervisorReport = {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: generatedAt,
    status: supervisorStatus(roleHealth),
    check_only: options.recover !== true,
    recovery_enabled: options.recover === true,
    roles_checked: assignments.map((assignment) => assignment.roleId),
    required_roles: assignments
      .filter((assignment) => assignment.runtimeRequired)
      .map((assignment) => assignment.roleId),
    role_assignments: assignments,
    role_health: roleHealth.map((health) => ({ ...health, evidence_path: evidencePath })),
    recovery_plans: recoveryPlans,
    blocked_reasons: blockedReasons(roleHealth),
    safety_notes: [
      "Phase 6 checks Nano runtime roles only.",
      "Senior/Super remains blocked and is not runtime-required.",
      "Recovery is limited to explicitly allowlisted Nano Docker containers.",
      "No fallback model, Qwen route, AirLLM, Super, or integration action is selected by this supervisor.",
    ],
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    integration_performed: false,
    evidence_path: evidencePath,
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
