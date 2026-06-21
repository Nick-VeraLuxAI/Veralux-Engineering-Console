import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelRoleAssignment } from "../model-routing/model-role-routing";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import type { SuperAuditCommandRunner, SuperHardwareSnapshot, SuperModelArtifactCheck } from "../super-compatibility/super-compatibility-audit";
import {
  captureAirLlmDependencySnapshot,
  checkAirLlmImportability,
  createAirLlmProvisioningPlan,
  discoverAirLlmPythonRuntimes,
  evaluateAirLlmEnvironmentGates,
  runAirLlmEnvironmentProof,
} from "./airllm-environment-proof";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 9 AirLLM environment import proof", () => {
  it("discovers Python runtime candidates safely", async () => {
    const candidates = await discoverAirLlmPythonRuntimes({
      env: { AIRLLM_PYTHON: "/opt/airllm/bin/python" } as unknown as NodeJS.ProcessEnv,
      candidatePaths: ["/custom/python"],
      commandRunner: candidateRunner({
        "/opt/airllm/bin/python": "Python 3.11.9",
        "/custom/python": "Python 3.12.1",
        python3: "Python 3.12.3",
      }),
    });

    expect(candidates.map((candidate) => candidate.executable)).toContain("/opt/airllm/bin/python");
    expect(candidates.map((candidate) => candidate.executable)).toContain("/custom/python");
    expect(candidates.find((candidate) => candidate.executable === "python3")?.exists).toBe(true);
  });

  it("handles no Python candidates without crashing", async () => {
    const candidates = await discoverAirLlmPythonRuntimes({
      commandRunner: async () => ({ stdout: "", stderr: "missing", exitCode: 127 }),
    });
    const check = await checkAirLlmImportability({
      candidates,
      commandRunner: async () => ({ stdout: "", stderr: "missing", exitCode: 127 }),
    });

    expect(candidates.every((candidate) => candidate.exists === false)).toBe(true);
    expect(check.status).toBe("unknown");
    expect(check.diagnostics).toContain("AIRLLM_IMPORT_NOT_DISCOVERABLE_IN_CANDIDATE_RUNTIMES");
  });

  it("reports AirLLM import success with version and module path metadata", async () => {
    const candidate = {
      id: "path:python3",
      executable: "python3",
      source: "path" as const,
      exists: true,
      version: "Python 3.12.3",
      diagnostics: [],
    };
    const check = await checkAirLlmImportability({
      candidates: [candidate],
      commandRunner: async (command, args) => {
        expect(command).toBe("python3");
        expect(args).not.toContain("/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8");
        return {
          stdout: JSON.stringify({
            package_found: true,
            import_succeeded: true,
            version: "2.0.0",
            module_path: "/venv/site-packages/airllm/__init__.py",
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    expect(check.status).toBe("passed");
    expect(check.package_found).toBe(true);
    expect(check.import_succeeded).toBe(true);
    expect(check.version).toBe("2.0.0");
    expect(check.module_path).toContain("airllm");
  });

  it("reports AirLLM import failure as unknown and creates a provisioning plan", async () => {
    const candidate = {
      id: "path:python3",
      executable: "python3",
      source: "path" as const,
      exists: true,
      version: "Python 3.12.3",
      diagnostics: [],
    };
    const check = await checkAirLlmImportability({
      candidates: [candidate],
      commandRunner: async () => ({
        stdout: JSON.stringify({ package_found: false, import_succeeded: false }),
        stderr: "",
        exitCode: 2,
      }),
    });
    const plan = createAirLlmProvisioningPlan({
      importCheck: check,
      candidates: [candidate],
    });

    expect(check.status).toBe("unknown");
    expect(plan.needed).toBe(true);
    expect(plan.missing_item).toBe("airllm Python package/import");
    expect(plan.proposed_commands.join("\n")).toContain("pip install airllm");
    expect(plan.next_human_approval_required).toBe(true);
  });

  it("dependency snapshot degrades to unknown instead of crashing", async () => {
    const snapshot = await captureAirLlmDependencySnapshot({
      importCheck: {
        status: "unknown",
        candidate: null,
        command: null,
        exit_code: null,
        stdout: null,
        stderr: null,
        package_found: false,
        import_succeeded: false,
        version: null,
        module_path: null,
        diagnostics: ["missing"],
      },
      commandRunner: async () => {
        throw new Error("nvidia-smi unavailable");
      },
    });

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.python_executable).toBeNull();
    expect(snapshot.diagnostics).toContain("AIRLLM_DEPENDENCY_SNAPSHOT_SKIPPED_NO_RUNTIME");
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.includes("AIRLLM_NVIDIA_SMI_UNAVAILABLE"))).toBe(true);
  });

  it("safety gates fail if model load, inference, Qwen, fallback, or integration are flagged", () => {
    const result = evaluateAirLlmEnvironmentGates({
      seniorRole: blockedSeniorRole(),
      importCheck: passedImportCheck(),
      dependencySnapshot: passedDependencySnapshot(),
      artifactCheck: passedArtifact(),
      hardwareSnapshot: passedHardware(),
      preflightRuntimeStatus: "healthy",
      postflightRuntimeStatus: "healthy",
      safetyOverrides: {
        superModelLoaded: true,
        seniorInferencePerformed: true,
        airllmServingStarted: true,
        qwenUsed: true,
        fallbackUsed: true,
        integrationPerformed: true,
      },
    });

    expect(result.verdict).toBe("no_go");
    expect(result.gates.find((gate) => gate.name === "no_super_model_load")?.status).toBe("failed");
    expect(result.gates.find((gate) => gate.name === "no_senior_inference")?.status).toBe("failed");
    expect(result.gates.find((gate) => gate.name === "no_airllm_serving")?.status).toBe("failed");
    expect(result.gates.find((gate) => gate.name === "qwen_not_used")?.status).toBe("failed");
    expect(result.gates.find((gate) => gate.name === "fallback_not_used")?.status).toBe("failed");
    expect(result.gates.find((gate) => gate.name === "no_integration")?.status).toBe("failed");
  });

  it("runs complete import proof with mocked AirLLM import success", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const modelDir = await createMockSuperModelDir();
    const airLlmPython = path.join(evidenceRoot, "airllm-python");
    await writeFile(airLlmPython, "#!/usr/bin/env python3\n");
    const result = await runAirLlmEnvironmentProof({
      evidenceRoot,
      now: fixedNow,
      env: {
        CONSOLE_SENIOR_WORKER_ENDPOINT: `airllm://${modelDir}`,
        AIRLLM_PYTHON: airLlmPython,
      } as unknown as NodeJS.ProcessEnv,
      runtimePreflight: runtimePreflightSequence(),
      commandRunner: airLlmPresentRunner(),
    });

    expect(result.final_verdict).toBe("ready_for_guarded_boot_probe");
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
    expect(result.proof_mode).toBe("import_only_no_model_load");
    expect(result.selected_runtime_path).toBe(airLlmPython);
    expect(result.airllm_import_check.status).toBe("passed");
    expect(result.dependency_snapshot.airllm_distribution_version).toBe("2.0.0");
    expect(result.boot_probe_plan.status).toBe("disabled");
    expect(result.fallback_used).toBe(false);
    expect(result.airllm_serving_started).toBe(false);
    expect(result.super_used).toBe(false);
    expect(result.qwen_used).toBe(false);
    expect(result.super_model_load_performed).toBe(false);
    expect(result.super_model_inference_performed).toBe(false);
    expect(result.integration_performed).toBe(false);

    const evidence = JSON.parse(await readFile(result.evidence_path, "utf8"));
    expect(evidence.final_verdict).toBe("ready_for_guarded_boot_probe");
  });

  it("runs complete import proof with missing AirLLM and returns unknown plus plan", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const modelDir = await createMockSuperModelDir();
    const result = await runAirLlmEnvironmentProof({
      evidenceRoot,
      now: fixedNow,
      env: {
        CONSOLE_SENIOR_WORKER_ENDPOINT: `airllm://${modelDir}`,
      } as unknown as NodeJS.ProcessEnv,
      runtimePreflight: runtimePreflightSequence(),
      commandRunner: airLlmMissingRunner(),
    });

    expect(result.final_verdict).toBe("unknown");
    expect(result.airllm_import_check.status).toBe("unknown");
    expect(result.provisioning_plan.needed).toBe(true);
    expect(result.provisioning_plan.next_human_approval_required).toBe(true);
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
    expect(result.boot_probe_plan.status).toBe("disabled");
  });
});

function candidateRunner(versions: Record<string, string>): SuperAuditCommandRunner {
  return async (command, args) => {
    if (args[0] === "--version" && versions[command]) {
      return { stdout: versions[command], stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "missing", exitCode: 127 };
  };
}

function airLlmPresentRunner(): SuperAuditCommandRunner {
  return async (command, args) => {
    const script = args.join(" ");
    if (args[0] === "--version") return { stdout: `${command} 3.12.3`, stderr: "", exitCode: 0 };
    if (script.includes("<airllm-import-only-check>")) return { stdout: "", stderr: "", exitCode: 1 };
    if (script.includes("importlib.import_module('airllm')")) {
      return {
        stdout: JSON.stringify({
          package_found: true,
          import_succeeded: true,
          version: "2.0.0",
          module_path: "/mock/site-packages/airllm/__init__.py",
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (script.includes("torch_cuda_available")) {
      return {
        stdout: JSON.stringify({
          python_version: "3.12.3",
          airllm_version: "2.0.0",
          torch_version: "2.8.0",
          torch_cuda_available: true,
          torch_cuda_version: "12.8",
        }),
        stderr: "",
        exitCode: 0,
      };
    }
    if (command === "nvidia-smi") {
      return { stdout: "NVIDIA GeForce RTX 5090, 595.71.05, 32607 MiB, 4096 MiB, 28511 MiB", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}

function airLlmMissingRunner(): SuperAuditCommandRunner {
  return async (command, args) => {
    const script = args.join(" ");
    if (args[0] === "--version" && command === "python3") return { stdout: "Python 3.12.3", stderr: "", exitCode: 0 };
    if (script.includes("importlib.import_module('airllm')")) {
      return { stdout: JSON.stringify({ package_found: false, import_succeeded: false }), stderr: "", exitCode: 2 };
    }
    if (command === "nvidia-smi") {
      return { stdout: "NVIDIA GeForce RTX 5090, 595.71.05, 32607 MiB, 4096 MiB, 28511 MiB", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "missing", exitCode: 127 };
  };
}

async function createMockSuperModelDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mock-super-model-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, "config.json"), JSON.stringify({
    model_type: "nemotron",
    architectures: ["NemotronSuperForCausalLM"],
  }));
  await writeFile(path.join(dir, "tokenizer.json"), "{}");
  await writeFile(path.join(dir, "model-00001-of-00002.safetensors"), "not-real-weights");
  await writeFile(path.join(dir, "model.safetensors.index.json"), "{}");
  return dir;
}

async function tempEvidenceRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airllm-environment-"));
  tempDirs.push(dir);
  return dir;
}

function runtimePreflightSequence(): () => Promise<RuntimeSupervisorReport> {
  let count = 0;
  return async () => {
    count += 1;
    return runtimeReport(`runtime-${count}.json`);
  };
}

function runtimeReport(evidencePath: string): RuntimeSupervisorReport {
  return {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: fixedNow().toISOString(),
    status: "healthy",
    check_only: true,
    recovery_enabled: false,
    roles_checked: ["vera_command", "console_default_worker", "console_senior_worker"],
    required_roles: ["vera_command", "console_default_worker"],
    role_assignments: [],
    role_health: [],
    recovery_plans: [],
    blocked_reasons: [],
    safety_notes: ["mock runtime report"],
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    integration_performed: false,
    evidence_path: evidencePath,
  };
}

function fixedNow(): Date {
  return new Date("2026-06-21T21:00:00.000Z");
}

function blockedSeniorRole(): ModelRoleAssignment {
  return {
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
    notes: "Senior role is intentionally blocked.",
  };
}

function passedImportCheck() {
  return {
    status: "passed" as const,
    candidate: {
      id: "path:python3",
      executable: "python3",
      source: "path" as const,
      exists: true,
      version: "Python 3.12.3",
      diagnostics: [],
    },
    command: "python3 -c <airllm-import-only-check>",
    exit_code: 0,
    stdout: "{}",
    stderr: null,
    package_found: true,
    import_succeeded: true,
    version: "2.0.0",
    module_path: "/mock/airllm/__init__.py",
    diagnostics: [],
  };
}

function passedDependencySnapshot() {
  return {
    status: "passed" as const,
    python_executable: "python3",
    python_version: "3.12.3",
    airllm_distribution_version: "2.0.0",
    torch_version: "2.8.0",
    torch_cuda_available: true,
    torch_cuda_version: "12.8",
    nvidia_smi_summary: "RTX 5090",
    safe_environment: {},
    diagnostics: [],
  };
}

function passedArtifact(): SuperModelArtifactCheck {
  return {
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
    total_size_bytes: 100,
    partial_artifact_indicators: [],
    diagnostics: [],
  };
}

function passedHardware(): SuperHardwareSnapshot {
  return {
    status: "passed",
    gpu_summary: "RTX 5090",
    memory_summary: { total_bytes: 100, free_bytes: 50 },
    disk_summary: { path: "/mock/super", total_bytes: 1000, free_bytes: 500 },
    diagnostics: [],
  };
}
