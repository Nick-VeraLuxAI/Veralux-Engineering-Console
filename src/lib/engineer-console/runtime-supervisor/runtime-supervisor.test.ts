import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRuntimeRoleHealth,
  recoverRuntimeRole,
  runRuntimeSupervisorPreflight,
  type RuntimeRoleHealth,
} from "./runtime-supervisor";
import type { ModelRoleFetch } from "../model-routing/model-role-routing";

const NANO_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
const EMPTY_ENV = {} as NodeJS.ProcessEnv;
const tempDirs: string[] = [];

function response(payload: unknown, ok = true, status = ok ? 200 : 503): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

function healthyNanoFetch(): ModelRoleFetch {
  return (async (url: RequestInfo | URL) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/models")) {
      return response({ data: [{ id: NANO_MODEL, owned_by: "vllm" }] });
    }
    if (requestUrl.endsWith("/chat/completions")) {
      if (requestUrl.includes(":8081")) {
        return response({ choices: [{ message: { content: "Vera route ready" } }] });
      }
      return response({ choices: [{ message: { content: "Console route ready" } }] });
    }
    return response({ error: "not found" }, false, 404);
  }) as unknown as ModelRoleFetch;
}

async function tempEvidenceRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runtime-supervisor-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 6 runtime supervisor", () => {
  it("reports healthy Vera and Console Nano roles and blocked senior without fallback", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const report = await runRuntimeSupervisorPreflight({
      env: EMPTY_ENV,
      fetchFn: healthyNanoFetch(),
      evidenceRoot,
      now: () => new Date("2026-06-21T19:00:00.000Z"),
    });

    expect(report.status).toBe("healthy");
    expect(report.check_only).toBe(true);
    expect(report.fallback_used).toBe(false);
    expect(report.airllm_super_used).toBe(false);
    expect(report.qwen_used).toBe(false);
    expect(report.integration_performed).toBe(false);

    const vera = report.role_health.find((role) => role.role_id === "vera_command");
    const consoleWorker = report.role_health.find((role) => role.role_id === "console_default_worker");
    const senior = report.role_health.find((role) => role.role_id === "console_senior_worker");
    expect(vera).toMatchObject({
      status: "healthy",
      endpoint: "http://127.0.0.1:8081/v1",
      expected_model: NANO_MODEL,
      models_endpoint_ok: true,
      expected_model_present: true,
      smoke_check_ok: true,
      runtime_required: true,
      recovery_supported: true,
    });
    expect(consoleWorker).toMatchObject({
      status: "healthy",
      endpoint: "http://127.0.0.1:8082/v1",
      expected_model: NANO_MODEL,
      models_endpoint_ok: true,
      expected_model_present: true,
      smoke_check_ok: true,
      runtime_required: true,
      recovery_supported: true,
    });
    expect(senior).toMatchObject({
      status: "blocked",
      runtime_required: false,
      recovery_supported: false,
      recovery_attempted: false,
    });

    const evidence = JSON.parse(await readFile(report.evidence_path, "utf8"));
    expect(evidence.report_schema).toBe("runtime_supervisor.phase_6.v1");
    expect(evidence.role_health).toHaveLength(3);
  });

  it("fails closed when a required endpoint is unavailable", async () => {
    const health = await checkRuntimeRoleHealth({
      roleId: "vera_command",
      env: EMPTY_ENV,
      fetchFn: (async () => {
        throw new Error("connection refused");
      }) as unknown as ModelRoleFetch,
    });

    expect(health.status).toBe("missing");
    expect(health.models_endpoint_ok).toBe(false);
    expect(health.recovery_supported).toBe(true);
    expect(health.smoke_check.error).toContain("PHASE_6_MODELS_ENDPOINT_UNREACHABLE");
  });

  it("marks a role unhealthy when the expected model is absent", async () => {
    const health = await checkRuntimeRoleHealth({
      roleId: "console_default_worker",
      env: EMPTY_ENV,
      fetchFn: (async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/models")) {
          return response({ data: [{ id: "Different-Model" }] });
        }
        return response({ choices: [{ message: { content: "Console route ready" } }] });
      }) as unknown as ModelRoleFetch,
    });

    expect(health.status).toBe("unhealthy");
    expect(health.models_endpoint_ok).toBe(true);
    expect(health.expected_model_present).toBe(false);
    expect(health.model_names_returned).toEqual(["Different-Model"]);
  });

  it("fails closed for an unknown runtime role", async () => {
    const health = await checkRuntimeRoleHealth({
      roleId: "fallback_worker",
      env: EMPTY_ENV,
      fetchFn: healthyNanoFetch(),
    });

    expect(health.status).toBe("unknown");
    expect(health.runtime_required).toBe(false);
    expect(health.recovery_supported).toBe(false);
    expect(health.smoke_check.error).toBe("PHASE_6_UNKNOWN_ROLE_FAIL_CLOSED");
  });

  it("does not attempt recovery in check-only mode", async () => {
    const runner = vi.fn();
    const evidenceRoot = await tempEvidenceRoot();
    const report = await runRuntimeSupervisorPreflight({
      env: EMPTY_ENV,
      fetchFn: (async (url: RequestInfo | URL) => {
        const requestUrl = String(url);
        if (requestUrl.includes(":8082")) {
          throw new Error("connection refused");
        }
        return healthyNanoFetch()(url);
      }) as unknown as ModelRoleFetch,
      evidenceRoot,
      recover: false,
      recoveryRunner: runner,
    });
    const worker = report.role_health.find((role) => role.role_id === "console_default_worker");

    expect(report.status).toBe("blocked");
    expect(runner).not.toHaveBeenCalled();
    expect(worker?.recovery_attempted).toBe(false);
    expect(worker?.recovery_result?.status).toBe("not_attempted");
    expect(worker?.recovery_result?.diagnostics).toContain("PHASE_6_CHECK_ONLY_RECOVERY_NOT_ATTEMPTED");
  });

  it("blocks recovery for unknown targets instead of guessing", async () => {
    const runner = vi.fn();
    const result = await recoverRuntimeRole({
      health: {
        role_id: "unlisted_worker",
        endpoint: "http://127.0.0.1:8999/v1",
        expected_model: NANO_MODEL,
        status: "missing",
        models_endpoint_ok: false,
        expected_model_present: false,
        smoke_check_ok: null,
        smoke_check: {
          status: "skipped",
          expected_content: null,
          actual_content: null,
          error: null,
        },
        latency_ms: 1,
        runtime_required: true,
        recovery_supported: false,
        recovery_attempted: false,
        recovery_result: null,
        model_names_returned: [],
        diagnostics: [],
        evidence_path: null,
      },
      recover: true,
      recoveryRunner: runner,
    });

    expect(result.status).toBe("unsupported");
    expect(result.attempted).toBe(false);
    expect(result.diagnostics).toContain("PHASE_6_RECOVERY_TARGET_NOT_ALLOWLISTED");
    expect(runner).not.toHaveBeenCalled();
  });

  it("recovers only allowlisted Nano targets and requires healthy post-checks", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" });
    const result = await recoverRuntimeRole({
      health: unhealthyConsoleHealth(),
      recover: true,
      fetchFn: healthyNanoFetch(),
      recoveryRunner: runner,
    });

    expect(runner).toHaveBeenCalledWith("docker", ["restart", "nemotron-nano-console-8082"]);
    expect(result.status).toBe("recovered");
    expect(result.attempted).toBe(true);
    expect(result.post_recovery_health?.status).toBe("healthy");
  });

  it("does not claim recovery success when post-checks fail", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" });
    const result = await recoverRuntimeRole({
      health: unhealthyConsoleHealth(),
      recover: true,
      fetchFn: (async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/models")) {
          return response({ data: [{ id: "Different-Model" }] });
        }
        return response({ choices: [{ message: { content: "Console route ready" } }] });
      }) as unknown as ModelRoleFetch,
      recoveryRunner: runner,
    });

    expect(result.status).toBe("failed");
    expect(result.attempted).toBe(true);
    expect(result.post_recovery_health?.status).toBe("unhealthy");
    expect(result.diagnostics).toContain("PHASE_6_RECOVERY_POSTCHECK_NOT_HEALTHY");
  });

  it("does not recover senior/Super or start AirLLM", async () => {
    const runner = vi.fn();
    const seniorHealth = await checkRuntimeRoleHealth({
      roleId: "console_senior_worker",
      env: EMPTY_ENV,
      fetchFn: healthyNanoFetch(),
    });
    const result = await recoverRuntimeRole({
      health: seniorHealth,
      recover: true,
      recoveryRunner: runner,
    });

    expect(seniorHealth.status).toBe("blocked");
    expect(seniorHealth.runtime_required).toBe(false);
    expect(result.status).toBe("unsupported");
    expect(runner).not.toHaveBeenCalled();
  });
});

function unhealthyConsoleHealth(): RuntimeRoleHealth {
  return {
    role_id: "console_default_worker",
    endpoint: "http://127.0.0.1:8082/v1",
    expected_model: NANO_MODEL,
    status: "missing",
    models_endpoint_ok: false,
    expected_model_present: false,
    smoke_check_ok: null,
    smoke_check: {
      status: "skipped",
      expected_content: "Console route ready",
      actual_content: null,
      error: "PHASE_6_MODELS_ENDPOINT_UNREACHABLE",
    },
    latency_ms: 1,
    runtime_required: true,
    recovery_supported: true,
    recovery_attempted: false,
    recovery_result: null,
    model_names_returned: [],
    diagnostics: [],
    evidence_path: null,
  };
}
