import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import {
  buildAirLlmCompatibilityCandidates,
  runAirLlmCompatibilityMatrix,
  runAirLlmImportProbe,
  validateAirLlmMatrixCommand,
  type AirLlmCompatibilityCandidate,
  type AirLlmCompatibilityCommandRunner,
  type AirLlmPythonRuntimeSpec,
} from "./airllm-compatibility-matrix";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 11 AirLLM compatibility matrix", () => {
  it("generates the approved candidate matrix", () => {
    const candidates = buildAirLlmCompatibilityCandidates({
      runtimes: [runtime("python3.12", "3.12", true), runtime("python3.11", "3.11", false), runtime("python3.10", "3.10", false)],
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3", "d1", "d2", "d3", "d4"]);
    expect(candidates.find((candidate) => candidate.id === "a1")?.venv_path).toBe(".airllm-matrix/venv-a1");
    expect(candidates.find((candidate) => candidate.id === "a3")?.package_pin_set.packages.join(" ")).toContain("github.com/lyogavin/airllm.git");
  });

  it("rejects global install, sudo, apt, model paths, and Qwen commands", () => {
    expect(validateAirLlmMatrixCommand(["sudo", "pip", "install", "airllm"])).toContain("AIRLLM_MATRIX_SUDO_FORBIDDEN");
    expect(validateAirLlmMatrixCommand(["apt", "install", "python3.11"])).toContain("AIRLLM_MATRIX_APT_FORBIDDEN");
    expect(validateAirLlmMatrixCommand(["pip", "install", "airllm"])).toContain("AIRLLM_MATRIX_GLOBAL_PIP_FORBIDDEN");
    expect(validateAirLlmMatrixCommand([".airllm-matrix/venv-a1/bin/python", "-m", "pip", "install", "qwen"])).toContain("AIRLLM_MATRIX_QWEN_FORBIDDEN");
    expect(validateAirLlmMatrixCommand([".airllm-matrix/venv-a1/bin/python", "-c", "/mnt/large-storage/models/super"])).toContain("AIRLLM_MATRIX_MODEL_PATH_FORBIDDEN");
  });

  it("skips missing Python candidates without failing the matrix", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmCompatibilityMatrix({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      candidates: [candidate("b1", runtime("python3.11", "3.11", false))],
      runner: successfulRunner(),
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.candidate_results[0]).toMatchObject({ candidate_id: "b1", verdict: "skipped", reason: "PYTHON_RUNTIME_MISSING" });
  });

  it("records install failure and continues to the next candidate", async () => {
    const repoRoot = await tempRepo();
    const runner = matrixRunner({
      failInstallFor: "venv-a1",
      successfulProbeFor: "venv-a2",
    });
    const result = await runAirLlmCompatibilityMatrix({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      candidates: [
        candidate("a1", runtime("python3.12", "3.12", true)),
        candidate("a2", runtime("python3.12", "3.12", true)),
      ],
      runner,
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("ready_for_guarded_boot_probe");
    expect(result.candidate_results.map((item) => item.candidate_id)).toEqual(["a1", "a2"]);
    expect(result.candidate_results[0]).toMatchObject({ verdict: "fail", reason: "CANDIDATE_PACKAGE_INSTALL_FAILED" });
    expect(result.winner_candidate_id).toBe("a2");
  });

  it("stops after the first successful candidate", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmCompatibilityMatrix({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      candidates: [
        candidate("a1", runtime("python3.12", "3.12", true)),
        candidate("a2", runtime("python3.12", "3.12", true)),
      ],
      runner: matrixRunner({ successfulProbeFor: "venv-a1" }),
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("ready_for_guarded_boot_probe");
    expect(result.candidate_results.map((item) => item.candidate_id)).toEqual(["a1"]);
  });

  it("returns no_go when all candidates fail", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmCompatibilityMatrix({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      candidates: [
        candidate("a1", runtime("python3.12", "3.12", true)),
        candidate("a2", runtime("python3.12", "3.12", true)),
      ],
      runner: matrixRunner({}),
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.candidate_results.every((item) => item.verdict === "fail")).toBe(true);
  });

  it("fails safety gates for model load, inference, serving, Qwen, fallback, and integration flags", async () => {
    const repoRoot = await tempRepo();
    const result = await runAirLlmCompatibilityMatrix({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      candidates: [candidate("a1", runtime("python3.12", "3.12", true))],
      runner: matrixRunner({ successfulProbeFor: "venv-a1" }),
      runtimePreflight: healthyPreflight,
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

  it("import probe command avoids model path and model instantiation", async () => {
    let probeScript = "";
    const runner: AirLlmCompatibilityCommandRunner = async (command, args) => {
      if (command === "nvidia-smi") return { stdout: "gpu", stderr: "", exitCode: 0 };
      probeScript = args[1] ?? "";
      return { stdout: JSON.stringify(successProbeJson()), stderr: "", exitCode: 0 };
    };

    const result = await runAirLlmImportProbe({
      pythonExecutable: ".airllm-matrix/venv-a1/bin/python",
      repoRoot: "/repo",
      runner,
    });

    expect(result.status).toBe("passed");
    expect(probeScript).not.toContain("/mnt/large-storage/models");
    expect(probeScript).not.toContain("from_pretrained");
    expect(probeScript).not.toContain("AutoModel(");
  });
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airllm-matrix-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, ".gitignore"), "/.airllm-matrix/\n");
  return dir;
}

function runtime(executable: string, expected: string | null, exists: boolean): AirLlmPythonRuntimeSpec {
  return {
    id: executable,
    executable,
    expected_major_minor: expected,
    exists,
    version: exists ? `Python ${expected ?? "3.12"}.3` : null,
    diagnostics: exists ? [] : ["missing"],
  };
}

function candidate(id: string, python: AirLlmPythonRuntimeSpec): AirLlmCompatibilityCandidate {
  return {
    id,
    group: "A",
    kind: "install_import",
    python,
    venv_path: `.airllm-matrix/venv-${id}`,
    package_pin_set: {
      id: `${id}-pins`,
      packages: ["airllm==2.11.0", "optimum<2", "transformers<4.49"],
      source_url: null,
      notes: [],
    },
    stop_on_success: true,
  };
}

function matrixRunner(options: {
  failInstallFor?: string;
  successfulProbeFor?: string;
}): AirLlmCompatibilityCommandRunner {
  return async (command, args) => {
    const serialized = [command, ...args].join(" ");
    if (command === "git") return { stdout: "abc123\n", stderr: "", exitCode: 0 };
    if (command === "nvidia-smi") return { stdout: "0, 32000, 30000, 2000", stderr: "", exitCode: 0 };
    if (args[0] === "--version") return { stdout: "Python 3.12.3", stderr: "", exitCode: 0 };
    if (serialized.includes("pip freeze")) return { stdout: "airllm==2.11.0\noptimum==1.27.0\ntransformers==4.48.3", stderr: "", exitCode: 0 };
    if (serialized.includes("pip install airllm") && options.failInstallFor && serialized.includes(options.failInstallFor)) {
      return { stdout: "", stderr: "resolver failed", exitCode: 1 };
    }
    if (args[0] === "-c") {
      const success = options.successfulProbeFor && serialized.includes(options.successfulProbeFor);
      return {
        stdout: JSON.stringify(success ? successProbeJson() : {
          ...successProbeJson(),
          optimum_bettertransformer_resolved: false,
          airllm_import_resolved: false,
          airllm_automodel_resolved: false,
          error_class: "ModuleNotFoundError",
          error_message: "No module named 'optimum.bettertransformer'",
        }),
        stderr: "",
        exitCode: success ? 0 : 1,
      };
    }
    return { stdout: "ok", stderr: "", exitCode: 0 };
  };
}

function successfulRunner(): AirLlmCompatibilityCommandRunner {
  return async () => ({ stdout: "ok", stderr: "", exitCode: 0 });
}

async function healthyPreflight(): Promise<RuntimeSupervisorReport> {
  return {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: "2026-06-21T21:00:00.000Z",
    status: "healthy",
    check_only: true,
    recovery_enabled: false,
    roles_checked: ["vera_command", "console_default_worker"],
    required_roles: ["vera_command", "console_default_worker"],
    role_assignments: [],
    role_health: [],
    recovery_plans: [],
    blocked_reasons: [],
    safety_notes: [],
    fallback_used: false,
    airllm_super_used: false,
    qwen_used: false,
    integration_performed: false,
    evidence_path: "preflight.json",
  };
}

function successProbeJson(): Record<string, unknown> {
  return {
    python_executable: ".airllm-matrix/venv-a1/bin/python",
    python_version: "3.12.3",
    installed_versions: {
      airllm: "2.11.0",
      optimum: "1.27.0",
      transformers: "4.48.3",
      torch: "2.12.1",
      accelerate: "1.14.0",
      safetensors: "0.8.0",
    },
    optimum_import_resolved: true,
    optimum_bettertransformer_resolved: true,
    airllm_import_resolved: true,
    airllm_automodel_resolved: true,
    model_path_passed: false,
    model_instantiated: false,
    model_load_performed: false,
    inference_performed: false,
    serving_started: false,
    error_class: null,
    error_message: null,
    traceback_summary: null,
  };
}
