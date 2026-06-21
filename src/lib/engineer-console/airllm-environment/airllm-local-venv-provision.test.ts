import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AirLlmEnvironmentProofResult } from "./airllm-environment-proof";
import {
  plannedAirLlmProvisionCommands,
  runAirLlmLocalVenvProvision,
  validateAirLlmProvisionCommand,
  type AirLlmProvisionCommandRunner,
} from "./airllm-local-venv-provision";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 10 AirLLM local venv provisioning", () => {
  it("plans only project-local .venv-airllm commands", () => {
    const commands = plannedAirLlmProvisionCommands({
      repoRoot: "/repo",
      evidenceRoot: "evidence/airllm-environment",
      targetVenvPath: ".venv-airllm",
      basePython: "python3",
      packageName: "airllm",
    });

    expect(commands).toEqual([
      ["python3", "-m", "venv", ".venv-airllm"],
      [".venv-airllm/bin/python", "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
      [".venv-airllm/bin/python", "-m", "pip", "install", "airllm"],
    ]);
  });

  it("forbids global install, sudo, apt, and non-allowlisted commands", () => {
    expect(validateAirLlmProvisionCommand(["sudo", "pip", "install", "airllm"])).toContain("AIRLLM_PROVISION_SUDO_FORBIDDEN");
    expect(validateAirLlmProvisionCommand(["apt", "install", "python3-venv"])).toContain("AIRLLM_PROVISION_APT_FORBIDDEN");
    expect(validateAirLlmProvisionCommand(["pip", "install", "airllm"])).toContain("AIRLLM_PROVISION_GLOBAL_PIP_FORBIDDEN");
    expect(validateAirLlmProvisionCommand(["python3", "-m", "pip", "install", "airllm"])).toContain("AIRLLM_PROVISION_COMMAND_NOT_ALLOWLISTED");
    expect(validateAirLlmProvisionCommand([".venv-airllm/bin/python", "-m", "pip", "install", "qwen"])).toContain("AIRLLM_PROVISION_QWEN_FORBIDDEN");
  });

  it("reuses an existing local venv safely", async () => {
    const repoRoot = await tempRepo();
    await mkdir(path.join(repoRoot, ".venv-airllm", "bin"), { recursive: true });
    await writeFile(path.join(repoRoot, ".venv-airllm", "bin", "python"), "");
    const runner = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));
    const result = await runAirLlmLocalVenvProvision({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      runner,
      importProofRunner: async () => proofResult("ready_for_guarded_boot_probe"),
      skipPipUpgrade: true,
    });

    expect(result.commands_executed[0]).toMatchObject({
      name: "reuse_local_venv",
      status: "skipped",
    });
    expect(runner).toHaveBeenCalledWith(".venv-airllm/bin/python", ["-m", "pip", "install", "airllm"], expect.objectContaining({ cwd: repoRoot }));
  });

  it("install success followed by import success yields ready_for_guarded_boot_probe", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmLocalVenvProvision({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      runner: successfulRunner(),
      importProofRunner: async (env) => {
        expect(env.AIRLLM_PYTHON).toBe(".venv-airllm/bin/python");
        return proofResult("ready_for_guarded_boot_probe");
      },
    });

    expect(result.final_verdict).toBe("ready_for_guarded_boot_probe");
    expect(result.install_result.status).toBe("passed");
    expect(result.selected_runtime_path).toBe(".venv-airllm/bin/python");
    expect(result.airllm_package_version).toBe("2.0.0");
    expect(result.venv_gitignored).toBe(true);
    expect(result.safety_gates.every((gate) => gate.status === "passed")).toBe(true);
    expect(JSON.parse(await readFile(result.evidence_path, "utf8")).final_verdict).toBe("ready_for_guarded_boot_probe");
  });

  it("install failure yields no_go and preserves diagnostics", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmLocalVenvProvision({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      runner: async (command) => command === ".venv-airllm/bin/python"
        ? { stdout: "", stderr: "package not found", exitCode: 1 }
        : { stdout: "ok", stderr: "", exitCode: 0 },
      importProofRunner: async () => proofResult("unknown"),
      skipPipUpgrade: true,
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.install_result.status).toBe("failed");
    expect(result.install_result.stderr_summary).toContain("package not found");
  });

  it("import failure after install yields unknown with import proof diagnostics", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmLocalVenvProvision({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      runner: successfulRunner(),
      importProofRunner: async () => proofResult("unknown"),
    });

    expect(result.final_verdict).toBe("unknown");
    expect(result.install_result.status).toBe("passed");
    expect(result.import_proof_result.airllm_import_check.status).toBe("unknown");
  });

  it("fails safety gates for Super load, inference, serving, Qwen, fallback, and integration flags", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmLocalVenvProvision({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      runner: successfulRunner(),
      importProofRunner: async () => proofResult("ready_for_guarded_boot_probe", {
        super_model_load_performed: true,
        super_model_inference_performed: true,
        airllm_serving_started: true,
        qwen_used: true,
        fallback_used: true,
        integration_performed: true,
      }),
      safetyOverrides: {
        superModelLoaded: true,
        seniorInferencePerformed: true,
        airllmServingStarted: true,
        qwenUsed: true,
        fallbackUsed: true,
        integrationPerformed: true,
      },
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.safety_gates.find((gate) => gate.name === "no_super_model_load")?.status).toBe("failed");
    expect(result.safety_gates.find((gate) => gate.name === "no_senior_inference")?.status).toBe("failed");
    expect(result.safety_gates.find((gate) => gate.name === "no_airllm_serving")?.status).toBe("failed");
    expect(result.safety_gates.find((gate) => gate.name === "qwen_not_used")?.status).toBe("failed");
    expect(result.safety_gates.find((gate) => gate.name === "fallback_not_used")?.status).toBe("failed");
    expect(result.safety_gates.find((gate) => gate.name === "no_integration")?.status).toBe("failed");
  });
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airllm-provision-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, ".gitignore"), "/.venv-airllm/\n");
  return dir;
}

function successfulRunner(): AirLlmProvisionCommandRunner {
  return async () => ({ stdout: "ok", stderr: "", exitCode: 0 });
}

function proofResult(
  verdict: AirLlmEnvironmentProofResult["final_verdict"],
  overrides: Record<string, unknown> = {},
): AirLlmEnvironmentProofResult {
  const success = verdict === "ready_for_guarded_boot_probe";
  return {
    proof_id: "proof",
    timestamp: "2026-06-21T21:30:00.000Z",
    senior_role_id: "console_senior_worker",
    senior_role_resolution: {
      roleId: "console_senior_worker",
      roleKind: "senior_worker",
      provider: "airllm-cold",
      endpoint: "airllm:///mock/super",
      model: "Nemotron-Super-120B-A12B-FP8",
      status: "blocked_unproven",
      repositoryWriteAllowed: false,
      fallbackAllowed: false,
      allowedFallbackRoles: [],
      runtimeRequired: false,
      healthcheckRequired: false,
      notes: "blocked",
    },
    configured_provider: "airllm-cold",
    configured_model_path: "/mock/super",
    expected_model: "Nemotron-Super-120B-A12B-FP8",
    proof_mode: "import_only_no_model_load",
    python_runtime_candidates: [],
    selected_runtime_path: success ? ".venv-airllm/bin/python" : null,
    airllm_import_check: {
      status: success ? "passed" : "unknown",
      candidate: null,
      command: ".venv-airllm/bin/python -c <airllm-import-only-check>",
      exit_code: success ? 0 : null,
      stdout: null,
      stderr: null,
      package_found: success,
      import_succeeded: success,
      version: success ? "2.0.0" : null,
      module_path: success ? "/mock/airllm/__init__.py" : null,
      diagnostics: success ? [] : ["missing"],
    },
    dependency_snapshot: {
      status: success ? "passed" : "unknown",
      python_executable: success ? ".venv-airllm/bin/python" : null,
      python_version: "3.12.3",
      airllm_distribution_version: success ? "2.0.0" : null,
      torch_version: "2.8.0",
      torch_cuda_available: true,
      torch_cuda_version: "12.8",
      nvidia_smi_summary: "RTX 5090",
      safe_environment: {},
      diagnostics: [],
    },
    model_artifact_check: {
      status: "passed",
      configured_uri: "airllm:///mock/super",
      model_path: "/mock/super",
      path_exists: true,
      readable: true,
      expected_model_name_consistent: true,
      config_files: ["config.json"],
      tokenizer_files: ["tokenizer.json"],
      weight_files: ["model.safetensors"],
      index_files: ["model.safetensors.index.json"],
      total_size_bytes: 1,
      partial_artifact_indicators: [],
      diagnostics: [],
    },
    hardware_snapshot: {
      status: "passed",
      gpu_summary: "RTX 5090",
      memory_summary: { total_bytes: 1, free_bytes: 1 },
      disk_summary: { path: "/mock/super", total_bytes: 1, free_bytes: 1 },
      diagnostics: [],
    },
    safety_gates: [],
    boot_probe_plan: {
      mode: "disabled",
      status: "disabled",
      required_guards: [],
      guards_satisfied: [],
      blocked_reason: "disabled",
      command: null,
    },
    preflight_runtime_report_path: "pre.json",
    postflight_runtime_report_path: "post.json",
    preflight_runtime_status: "healthy",
    postflight_runtime_status: "healthy",
    final_verdict: verdict,
    blocked_reasons: [],
    warnings: [],
    provisioning_plan: {
      needed: !success,
      missing_item: success ? null : "airllm",
      candidate_runtime_checked: ".venv-airllm/bin/python",
      project_local_venv_recommended: false,
      proposed_commands: [],
      risks_and_assumptions: [],
      next_human_approval_required: false,
    },
    evidence_path: "proof.json",
    fallback_used: false,
    airllm_serving_started: false,
    super_used: false,
    qwen_used: false,
    super_model_load_performed: false,
    super_model_inference_performed: false,
    integration_performed: false,
    ...overrides,
  } as AirLlmEnvironmentProofResult;
}
