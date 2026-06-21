import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import type { AirLlmImportProbeResult } from "./airllm-compatibility-matrix";
import type { AirLlmEnvironmentProofResult } from "./airllm-environment-proof";
import {
  PHASE_12_WINNING_PINS,
  loadWinningCandidateFromPhase11Evidence,
  renderAirLlmRequirements,
  runAirLlmWinningCandidatePromotion,
  validateAirLlmPromotionCommand,
  type AirLlmPromotionCommandRunner,
  type AirLlmWinningCandidateLock,
} from "./airllm-winning-candidate-promotion";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 12 AirLLM winning candidate promotion", () => {
  it("loads the Phase 11 a2 winner and exact pins", async () => {
    const repoRoot = await tempRepo();
    const evidencePath = await writePhase11Evidence(repoRoot, "a2");
    const lock = await loadWinningCandidateFromPhase11Evidence({ evidencePath });

    expect(lock.candidate_id).toBe("a2");
    expect(lock.pins).toEqual(PHASE_12_WINNING_PINS);
  });

  it("rejects a non-a2 winner by default", async () => {
    const repoRoot = await tempRepo();
    const evidencePath = await writePhase11Evidence(repoRoot, "b2");

    await expect(loadWinningCandidateFromPhase11Evidence({ evidencePath })).rejects.toThrow("PHASE_12_REJECTS_NON_A2_WINNER:b2");
  });

  it("renders requirements with required pins and no model path", () => {
    const content = renderAirLlmRequirements(lock());

    for (const pin of PHASE_12_WINNING_PINS) expect(content).toContain(pin);
    expect(content).not.toContain("/mnt/large-storage/models");
    expect(content).toContain("Import-only proven");
  });

  it("forbids global install, sudo, apt, model path, Qwen, and matrix venv mutation", () => {
    expect(validateAirLlmPromotionCommand(["sudo", "pip", "install", "airllm"])).toContain("AIRLLM_PROMOTION_SUDO_FORBIDDEN");
    expect(validateAirLlmPromotionCommand(["apt", "install", "python3-venv"])).toContain("AIRLLM_PROMOTION_APT_FORBIDDEN");
    expect(validateAirLlmPromotionCommand(["pip", "install", "airllm"])).toContain("AIRLLM_PROMOTION_GLOBAL_PIP_FORBIDDEN");
    expect(validateAirLlmPromotionCommand([".venv-airllm/bin/python", "-m", "pip", "install", "qwen"])).toContain("AIRLLM_PROMOTION_QWEN_FORBIDDEN");
    expect(validateAirLlmPromotionCommand([".venv-airllm/bin/python", "-c", "/mnt/large-storage/models/super"])).toContain("AIRLLM_PROMOTION_MODEL_PATH_FORBIDDEN");
    expect(validateAirLlmPromotionCommand([".airllm-matrix/venv-a2/bin/python", "-m", "pip", "install", "airllm"])).toContain("AIRLLM_PROMOTION_MATRIX_VENV_MUTATION_FORBIDDEN");
  });

  it("promotes exact pins and yields ready_for_guarded_boot_probe", async () => {
    const repoRoot = await tempRepo();
    await mkdir(path.join(repoRoot, ".venv-airllm", "bin"), { recursive: true });
    await writeFile(path.join(repoRoot, ".venv-airllm", "bin", "python"), "");
    const evidencePath = await writePhase11Evidence(repoRoot, "a2");
    const result = await runAirLlmWinningCandidatePromotion({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase11EvidencePath: evidencePath,
      runner: successfulRunner(),
      importProbeRunner: async () => successProbe(),
      environmentProofRunner: async () => environmentProof("ready_for_guarded_boot_probe"),
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("ready_for_guarded_boot_probe");
    expect(result.target_venv_path).toBe(".venv-airllm");
    expect(result.generated_requirements_path).toBe("requirements-airllm.txt");
    expect(await readFile(path.join(repoRoot, "requirements-airllm.txt"), "utf8")).toContain("sentencepiece==0.2.1");
    expect(result.commands_executed[0].name).toBe("remove_existing_official_venv");
    expect(result.commands_executed.some((step) => step.command.join(" ").includes(".airllm-matrix"))).toBe(false);
  });

  it("install failure yields no_go", async () => {
    const repoRoot = await tempRepo();
    const evidencePath = await writePhase11Evidence(repoRoot, "a2");
    const result = await runAirLlmWinningCandidatePromotion({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase11EvidencePath: evidencePath,
      runner: async (command, args) => args.join(" ").includes("-r requirements-airllm.txt")
        ? { stdout: "", stderr: "resolver failed", exitCode: 1 }
        : { stdout: "ok", stderr: "", exitCode: 0 },
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.commands_executed.find((step) => step.name === "install_official_airllm_requirements")?.status).toBe("failed");
  });

  it("import failure yields no_go", async () => {
    const repoRoot = await tempRepo();
    const evidencePath = await writePhase11Evidence(repoRoot, "a2");
    const result = await runAirLlmWinningCandidatePromotion({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase11EvidencePath: evidencePath,
      runner: successfulRunner(),
      importProbeRunner: async () => ({ ...successProbe(), status: "failed", airllm_automodel_resolved: false, diagnostics: ["import failed"] }),
      environmentProofRunner: async () => environmentProof("no_go"),
      runtimePreflight: healthyPreflight,
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.safety_gates.find((gate) => gate.name === "automodel_import_resolved")?.status).toBe("failed");
  });

  it("fails safety gates for unsafe runtime flags", async () => {
    const repoRoot = await tempRepo();
    const evidencePath = await writePhase11Evidence(repoRoot, "a2");
    const result = await runAirLlmWinningCandidatePromotion({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase11EvidencePath: evidencePath,
      runner: successfulRunner(),
      importProbeRunner: async () => successProbe(),
      environmentProofRunner: async () => environmentProof("ready_for_guarded_boot_probe"),
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
    expect(result.safety_gates.filter((gate) => gate.status === "failed").map((gate) => gate.name)).toEqual(expect.arrayContaining([
      "no_super_model_load",
      "no_senior_inference",
      "no_airllm_serving",
      "qwen_not_used",
      "fallback_not_used",
      "no_integration",
    ]));
  });
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airllm-promotion-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, "docs", "runtime"), { recursive: true });
  await writeFile(path.join(dir, ".gitignore"), "/.venv-airllm/\n/.airllm-matrix/\n");
  return dir;
}

async function writePhase11Evidence(repoRoot: string, winner: string): Promise<string> {
  const evidencePath = path.join(repoRoot, "phase11.json");
  await writeFile(evidencePath, JSON.stringify({
    winner_candidate_id: winner,
    final_verdict: "ready_for_guarded_boot_probe",
    package_freeze_for_winner: lock().full_freeze,
  }));
  return evidencePath;
}

function lock(): AirLlmWinningCandidateLock {
  return {
    candidate_id: "a2",
    pins: PHASE_12_WINNING_PINS,
    full_freeze: [
      "airllm==2.11.0",
      "optimum==1.27.0",
      "transformers==4.48.3",
      "setuptools==81.0.0",
      "sentencepiece==0.2.1",
    ],
    source_phase11_evidence_path: "phase11.json",
  };
}

function successfulRunner(): AirLlmPromotionCommandRunner {
  return async () => ({ stdout: "ok", stderr: "", exitCode: 0 });
}

function successProbe(): AirLlmImportProbeResult {
  return {
    status: "passed",
    command: [".venv-airllm/bin/python", "-c", "<probe>"],
    exit_code: 0,
    stdout_summary: "{}",
    stderr_summary: null,
    timed_out: false,
    python_executable: ".venv-airllm/bin/python",
    python_version: "3.12.3",
    installed_versions: {
      airllm: "2.11.0",
      optimum: "1.27.0",
      transformers: "4.48.3",
      setuptools: "81.0.0",
      sentencepiece: "0.2.1",
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
    gpu_memory_before: "gpu",
    gpu_memory_after: "gpu",
    diagnostics: [],
  };
}

function environmentProof(verdict: AirLlmEnvironmentProofResult["final_verdict"]): AirLlmEnvironmentProofResult {
  return {
    final_verdict: verdict,
    warnings: [],
    boot_probe_plan: { status: "disabled" },
  } as unknown as AirLlmEnvironmentProofResult;
}

async function healthyPreflight(): Promise<RuntimeSupervisorReport> {
  return {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: "2026-06-21T21:30:00.000Z",
    status: "healthy",
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
    evidence_path: "preflight.json",
  };
}
