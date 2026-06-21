import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import type { SuperModelArtifactCheck } from "../super-compatibility/super-compatibility-audit";
import {
  buildSuperBootProbeCommand,
  runGuardedSuperBootProbe,
  validateSuperBootProbeCommand,
  type SuperBootProbeChildProcessResult,
  type SuperBootProbeChildRunner,
} from "./super-boot-probe";

const tempDirs: string[] = [];
const phase12Evidence = "phase12-ready.json";
const modelPath = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8";

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 13 guarded Super boot probe", () => {
  it("builds a command with official runtime and exact model path only", () => {
    const command = buildSuperBootProbeCommand({
      runtimePath: ".venv-airllm/bin/python",
      modelPath,
    });

    expect(command[0]).toBe(".venv-airllm/bin/python");
    expect(command.join(" ")).toContain(modelPath);
    expect(validateSuperBootProbeCommand(command)).toEqual([]);
    expect(command.join(" ")).not.toContain(".generate(");
    expect(command.join(" ")).not.toContain("uvicorn");
    expect(command.join(" ")).not.toContain("qwen");
  });

  it("rejects disallowed model path and unsafe command terms", () => {
    expect(validateSuperBootProbeCommand(["python3", "-c", "x"])).toContain("SUPER_BOOT_PROBE_RUNTIME_NOT_OFFICIAL_AIRLLM_VENV");
    expect(validateSuperBootProbeCommand([".venv-airllm/bin/python", "-c", "/tmp/other-model"])).toContain("SUPER_BOOT_PROBE_MODEL_PATH_COUNT_INVALID:0");
    expect(validateSuperBootProbeCommand([".venv-airllm/bin/python", "-c", `${modelPath}; .generate(`])).toContain("SUPER_BOOT_PROBE_INFERENCE_FORBIDDEN");
    expect(validateSuperBootProbeCommand([".venv-airllm/bin/python", "-c", `${modelPath}; uvicorn`])).toContain("SUPER_BOOT_PROBE_SERVER_START_FORBIDDEN");
    expect(validateSuperBootProbeCommand([".venv-airllm/bin/python", "-c", `${modelPath}; qwen`])).toContain("SUPER_BOOT_PROBE_QWEN_FORBIDDEN");
  });

  it("dry run does not launch the child process", async () => {
    const repoRoot = await tempRepo();
    const childRunner = vi.fn(successChild);
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: false,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner,
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_unknown");
    expect(result.child_process.launched).toBe(false);
    expect(childRunner).not.toHaveBeenCalled();
  });

  it("missing runtime blocks launch as unsafe", async () => {
    const repoRoot = await tempRepo(false);
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner: successChild,
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_unsafe");
    expect(result.child_process.launched).toBe(false);
    expect(result.safety_gates.find((gate) => gate.name === "official_airllm_runtime_exists")?.status).toBe("failed");
  });

  it("missing Phase 12 readiness blocks launch", async () => {
    const repoRoot = await tempRepo(true, false);
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner: successChild,
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_unsafe");
    expect(result.safety_gates.find((gate) => gate.name === "phase12_ready_for_guarded_boot_probe")?.status).toBe("failed");
  });

  it("missing model artifacts block launch", async () => {
    const repoRoot = await tempRepo();
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("failed"),
      childRunner: successChild,
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_unsafe");
    expect(result.child_process.launched).toBe(false);
  });

  it("child success marker yields boot_probe_passed", async () => {
    const repoRoot = await tempRepo();
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner: successChild,
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_passed");
    expect(result.child_process.pid).toBe(1234);
    expect(result.model_load_attempted).toBe(true);
    expect(result.model_load_completed).toBe(true);
    expect(result.resource_snapshots.length).toBeGreaterThanOrEqual(2);
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
    expect(result.senior_role_promoted).toBe(false);
  });

  it("child nonzero exit yields boot_probe_failed", async () => {
    const repoRoot = await tempRepo();
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner: async () => ({ ...childBase(), exit_code: 1, success_marker_seen: false, model_load_completed: false }),
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_failed");
  });

  it("child timeout yields boot_probe_timeout when cleanup succeeds", async () => {
    const repoRoot = await tempRepo();
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner: async () => ({ ...childBase(), timed_out: true, cleanup_status: "terminated", exit_code: null, signal: "SIGTERM", success_marker_seen: false, model_load_completed: false }),
      commandRunner: fakeCommandRunner,
    });

    expect(result.final_verdict).toBe("boot_probe_timeout");
  });

  it("cleanup failure or serving/inference/fallback flags yield unsafe", async () => {
    const repoRoot = await tempRepo();
    const result = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: healthyPreflight,
      artifactAudit: async () => artifact("passed"),
      childRunner: async () => ({ ...childBase(), cleanup_status: "failed" }),
      commandRunner: fakeCommandRunner,
      safetyOverrides: { servingDetected: true, inferenceDetected: true, qwenUsed: true, fallbackUsed: true, integrationPerformed: true },
    });

    expect(result.final_verdict).toBe("boot_probe_unsafe");
    expect(result.safety_gates.filter((gate) => gate.status === "failed").map((gate) => gate.name)).toEqual(expect.arrayContaining([
      "cleanup_succeeded",
      "no_serving_started",
      "no_inference_or_generation",
      "qwen_not_used",
      "fallback_not_used",
      "no_integration",
    ]));
  });

  it("Nano preflight blocks launch and postflight degradation is unsafe", async () => {
    const repoRoot = await tempRepo();
    const preflightFail = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: async () => preflight("blocked"),
      artifactAudit: async () => artifact("passed"),
      childRunner: successChild,
      commandRunner: fakeCommandRunner,
    });
    expect(preflightFail.child_process.launched).toBe(false);
    expect(preflightFail.final_verdict).toBe("boot_probe_unsafe");

    let calls = 0;
    const postflightFail = await runGuardedSuperBootProbe({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase12EvidencePath: phase12Evidence,
      enabled: true,
      runtimePreflight: async () => preflight(calls++ === 0 ? "healthy" : "blocked"),
      artifactAudit: async () => artifact("passed"),
      childRunner: successChild,
      commandRunner: fakeCommandRunner,
    });
    expect(postflightFail.final_verdict).toBe("boot_probe_unsafe");
  });
});

async function tempRepo(withRuntime = true, withPhase12 = true): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "super-boot-probe-"));
  tempDirs.push(dir);
  if (withRuntime) {
    await writeFile(path.join(dir, ".venv-airllm.bin-placeholder"), "");
    await writeFile(path.join(dir, phase12Evidence), JSON.stringify({ final_verdict: withPhase12 ? "ready_for_guarded_boot_probe" : "no_go" }));
    await mkdir(path.join(dir, ".venv-airllm", "bin"), { recursive: true });
    await writeFile(path.join(dir, ".venv-airllm", "bin", "python"), "");
  } else if (withPhase12) {
    await writeFile(path.join(dir, phase12Evidence), JSON.stringify({ final_verdict: "ready_for_guarded_boot_probe" }));
  }
  return dir;
}

function childBase(): SuperBootProbeChildProcessResult {
  return {
    launched: true,
    pid: 1234,
    command: [".venv-airllm/bin/python", "-c", "<probe>"],
    cwd: "/repo",
    stdout_summary: "ok",
    stderr_summary: null,
    exit_code: 0,
    signal: null,
    timed_out: false,
    cleanup_status: "not_needed",
    cleanup_signal: null,
    success_marker_seen: true,
    model_load_attempted: true,
    model_load_completed: true,
    inference_or_generation_detected: false,
    serving_detected: false,
    diagnostics: [],
  };
}

async function successChild(input: Parameters<SuperBootProbeChildRunner>[0]): Promise<SuperBootProbeChildProcessResult> {
  await input.onDuringSnapshot(1234);
  return childBase();
}

async function fakeCommandRunner(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (command === "nvidia-smi") return { stdout: "0, RTX 5090, 32607 MiB, 4000 MiB, 28000 MiB, 0 %", stderr: "", exitCode: 0 };
  if (command === "git") return { stdout: "abc123\n", stderr: "", exitCode: 0 };
  return { stdout: "ok", stderr: "", exitCode: 0 };
}

async function healthyPreflight(): Promise<RuntimeSupervisorReport> {
  return preflight("healthy");
}

function preflight(status: RuntimeSupervisorReport["status"]): RuntimeSupervisorReport {
  return {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: "2026-06-21T22:00:00.000Z",
    status,
    check_only: true,
    recovery_enabled: false,
    roles_checked: [],
    required_roles: [],
    role_assignments: [],
    role_health: [],
    recovery_plans: [],
    blocked_reasons: [],
    safety_notes: [],
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    integration_performed: false,
    evidence_path: "runtime.json",
  };
}

function artifact(status: SuperModelArtifactCheck["status"]): SuperModelArtifactCheck {
  return {
    status,
    configured_uri: `airllm://${modelPath}`,
    model_path: modelPath,
    path_exists: status === "passed",
    readable: status === "passed",
    expected_model_name_consistent: status === "passed",
    config_files: status === "passed" ? ["config.json"] : [],
    tokenizer_files: status === "passed" ? ["tokenizer.json"] : [],
    weight_files: status === "passed" ? ["model-00001-of-00026.safetensors"] : [],
    index_files: status === "passed" ? ["model.safetensors.index.json"] : [],
    total_size_bytes: status === "passed" ? 1 : 0,
    partial_artifact_indicators: [],
    diagnostics: status === "passed" ? [] : ["missing"],
  };
}
