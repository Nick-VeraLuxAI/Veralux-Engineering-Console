import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelRoleAssignment } from "../model-routing/model-role-routing";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import {
  auditAirLLMDependencies,
  auditHardwareForSuper,
  auditSuperModelArtifacts,
  createSuperBootProbePlan,
  evaluateSuperCompatibilityGates,
  parseAirLlmUri,
  runSuperCompatibilityAudit,
  type SuperAuditCommandRunner,
  type SuperModelArtifactCheck,
} from "./super-compatibility-audit";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 8 AirLLM/Super compatibility audit", () => {
  it("parses configured airllm URIs safely", () => {
    const parsed = parseAirLlmUri("airllm:///mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8");

    expect(parsed.scheme).toBe("airllm");
    expect(parsed.model_path).toBe("/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("reports missing model path as no-go artifact failure without loading", async () => {
    const parsed = parseAirLlmUri("airllm:///definitely/missing/super-model");
    const artifact = await auditSuperModelArtifacts({
      parsedUri: parsed,
      expectedModel: "Nemotron-Super-120B-A12B-FP8",
    });

    expect(artifact.status).toBe("failed");
    expect(artifact.path_exists).toBe(false);
    expect(artifact.weight_files).toEqual([]);
    expect(artifact.diagnostics[0]).toContain("SUPER_AUDIT_MODEL_PATH_MISSING");
  });

  it("passes non-loading artifact audit for a valid mocked artifact set", async () => {
    const modelDir = await createMockSuperModelDir();
    const artifact = await auditSuperModelArtifacts({
      parsedUri: parseAirLlmUri(`airllm://${modelDir}`),
      expectedModel: "Nemotron-Super-120B-A12B-FP8",
    });

    expect(artifact.status).toBe("passed");
    expect(artifact.path_exists).toBe(true);
    expect(artifact.readable).toBe(true);
    expect(artifact.config_files).toContain("config.json");
    expect(artifact.tokenizer_files).toContain("tokenizer.json");
    expect(artifact.weight_files).toContain("model-00001-of-00002.safetensors");
    expect(artifact.index_files).toContain("model.safetensors.index.json");
    expect(artifact.total_size_bytes).toBeGreaterThan(0);
  });

  it("dependency audit degrades missing AirLLM to unknown rather than crashing", async () => {
    const runner: SuperAuditCommandRunner = async (command, args) => {
      const joined = [command, ...args].join(" ");
      if (joined.startsWith("python --version")) return { stdout: "Python 3.11", stderr: "", exitCode: 0 };
      if (joined.includes("find_spec('airllm')")) return { stdout: "", stderr: "", exitCode: 2 };
      if (command === "nvidia-smi") return { stdout: "RTX 5090, 580.95, 32607 MiB, 4000 MiB, 28000 MiB", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "unknown", exitCode: 1 };
    };
    const checks = await auditAirLLMDependencies(runner);

    expect(checks.find((check) => check.name === "python_available")?.status).toBe("passed");
    expect(checks.find((check) => check.name === "airllm_import_discoverable")?.status).toBe("unknown");
    expect(checks.find((check) => check.name === "airllm_import_discoverable")?.diagnostics).toContain("SUPER_AUDIT_AIRLLM_IMPORT_NOT_DISCOVERABLE");
  });

  it("hardware snapshot failures degrade to unknown rather than crashing", async () => {
    const modelDir = await createMockSuperModelDir();
    const snapshot = await auditHardwareForSuper({
      modelPath: modelDir,
      runner: async () => {
        throw new Error("nvidia-smi unavailable");
      },
    });

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.gpu_summary).toBeNull();
    expect(snapshot.memory_summary.total_bytes).toBeGreaterThan(0);
    expect(snapshot.disk_summary.free_bytes).toBeGreaterThan(0);
    expect(snapshot.diagnostics[0]).toContain("SUPER_AUDIT_NVIDIA_SMI_UNAVAILABLE");
  });

  it("safety gates fail if AirLLM/Super, Qwen, fallback, or integration are flagged", async () => {
    const gates = evaluateSuperCompatibilityGates({
      seniorRole: blockedSeniorRole(),
      artifactCheck: passedArtifact(),
      dependencyChecks: [{ name: "python_available", status: "passed", command: "python --version", details: "ok", diagnostics: [] }],
      hardwareSnapshot: passedHardware(),
      preflightRuntimeStatus: "healthy",
      postflightRuntimeStatus: "healthy",
      safetyOverrides: {
        airllmSuperStarted: true,
        qwenUsed: true,
        fallbackUsed: true,
        integrationPerformed: true,
      },
    });

    expect(gates.verdict).toBe("no_go");
    expect(gates.gates.find((gate) => gate.name === "super_not_started")?.status).toBe("failed");
    expect(gates.gates.find((gate) => gate.name === "qwen_not_used")?.status).toBe("failed");
    expect(gates.gates.find((gate) => gate.name === "fallback_not_used")?.status).toBe("failed");
    expect(gates.gates.find((gate) => gate.name === "no_integration")?.status).toBe("failed");
  });

  it("boot probe defaults to disabled and explicit mode remains blocked without guards", () => {
    const disabled = createSuperBootProbePlan({
      mode: "disabled",
      seniorRole: blockedSeniorRole(),
      nanoPreflightStatus: "healthy",
    });
    const explicit = createSuperBootProbePlan({
      mode: "explicit_allowlisted_boot_probe",
      seniorRole: blockedSeniorRole(),
      nanoPreflightStatus: "healthy",
      allowFlag: false,
      confirmFlag: false,
    });

    expect(disabled.status).toBe("disabled");
    expect(disabled.command).toBeNull();
    expect(explicit.status).toBe("blocked");
    expect(explicit.command).toBeNull();
    expect(explicit.blocked_reason).toBe("SUPER_BOOT_PROBE_NOT_EXECUTED_IN_PHASE_8");
  });

  it("runs complete audit and preserves blocked senior role with a mocked valid artifact set", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const modelDir = await createMockSuperModelDir();
    const result = await runSuperCompatibilityAudit({
      evidenceRoot,
      now: fixedNow,
      env: {
        CONSOLE_SENIOR_WORKER_ENDPOINT: `airllm://${modelDir}`,
      } as unknown as NodeJS.ProcessEnv,
      runtimePreflight: runtimePreflightSequence(),
      commandRunner: passingRunner(),
    });

    expect(result.final_verdict).toBe("go_for_future_boot_probe");
    expect(result.senior_role_id).toBe("console_senior_worker");
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
    expect(result.audit_mode).toBe("non_loading_audit");
    expect(result.boot_probe_plan.status).toBe("disabled");
    expect(result.fallback_used).toBe(false);
    expect(result.airllm_super_used).toBe(false);
    expect(result.qwen_used).toBe(false);
    expect(result.super_model_load_performed).toBe(false);
    expect(result.super_model_inference_performed).toBe(false);
    expect(result.integration_performed).toBe(false);

    const evidence = JSON.parse(await readFile(result.evidence_path, "utf8"));
    expect(evidence.final_verdict).toBe("go_for_future_boot_probe");
    expect(evidence.model_artifact_check.status).toBe("passed");
  });

  it("returns no_go for missing configured artifacts while still producing evidence", async () => {
    const evidenceRoot = await tempEvidenceRoot();
    const result = await runSuperCompatibilityAudit({
      evidenceRoot,
      now: fixedNow,
      env: {
        CONSOLE_SENIOR_WORKER_ENDPOINT: "airllm:///definitely/missing/super-model",
      } as unknown as NodeJS.ProcessEnv,
      runtimePreflight: runtimePreflightSequence(),
      commandRunner: passingRunner(),
    });

    expect(result.final_verdict).toBe("no_go");
    expect(result.model_artifact_check.status).toBe("failed");
    expect(result.blocked_reasons.some((reason) => reason.includes("SUPER_AUDIT_MODEL_PATH_MISSING"))).toBe(true);
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
    expect(result.super_model_load_performed).toBe(false);
  });
});

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "super-compatibility-"));
  tempDirs.push(dir);
  return dir;
}

function fixedNow(): Date {
  return new Date("2026-06-21T20:45:00.000Z");
}

function passingRunner(): SuperAuditCommandRunner {
  return async (command, args) => {
    const joined = [command, ...args].join(" ");
    if (joined.startsWith("python --version")) return { stdout: "Python 3.11.15", stderr: "", exitCode: 0 };
    if (joined.includes("find_spec('airllm')")) return { stdout: "", stderr: "", exitCode: 0 };
    if (command === "nvidia-smi") return { stdout: "0, NVIDIA GeForce RTX 5090, 32607, 4096, 28511, 580.95", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };
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

function passedHardware() {
  return {
    status: "passed" as const,
    gpu_summary: "RTX 5090",
    memory_summary: { total_bytes: 100, free_bytes: 50 },
    disk_summary: { path: "/mock/super", total_bytes: 1000, free_bytes: 500 },
    diagnostics: [],
  };
}
