import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSupervisorReport } from "../runtime-supervisor/runtime-supervisor";
import {
  buildOfficialArtifactManifest,
  loadPhase13FailureEvidence,
  planSuperArtifactRemediation,
  runSuperArtifactRemediation,
  type SuperArtifactDownloader,
} from "./super-artifact-remediation";

const tempDirs: string[] = [];
const officialRepo = "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8";

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 14 Super artifact remediation", () => {
  it("loads Phase 13 failure evidence for missing configuration_nemotron_h.py", async () => {
    const repo = await tempRepo();
    const evidence = path.join(repo, "phase13.json");
    await writePhase13Evidence(evidence);

    const result = await loadPhase13FailureEvidence(evidence);

    expect(result.found).toBe(true);
    expect(result.reason).toContain("configuration_nemotron_h.py");
  });

  it("builds a manifest and plans only allowed missing small artifacts", async () => {
    const modelPath = await tempModel();
    const manifest = await buildOfficialArtifactManifest({ sourceRepoId: officialRepo, modelPath });
    const plan = planSuperArtifactRemediation({ manifest, enabled: false });

    expect(plan.candidates.map((entry) => entry.file_name)).toEqual(expect.arrayContaining([
      "configuration_nemotron_h.py",
      "modeling_nemotron_h.py",
      "super_v3_reasoning_parser.py",
    ]));
    expect(plan.candidates.map((entry) => entry.file_name)).not.toContain("__init__.py");
    expect(plan.candidates.some((entry) => entry.file_name.endsWith(".safetensors"))).toBe(false);
    expect(plan.candidates.some((entry) => entry.file_name === "model.safetensors.index.json")).toBe(false);
  });

  it("dry-run does not write files and returns remediation_plan_ready", async () => {
    const { repoRoot, modelPath, phase13Path } = await tempFixture();
    const result = await runSuperArtifactRemediation({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13Path),
      modelPath,
      enabled: false,
      runtimePreflight: healthyPreflight,
      commandRunner: fakeCommandRunner,
      downloader: fakeDownloader,
    });

    await expect(stat(path.join(modelPath, "configuration_nemotron_h.py"))).rejects.toThrow();
    expect(result.final_verdict).toBe("remediation_plan_ready");
    expect(result.files_written).toEqual([]);
    expect(result.phase13_rerun_performed).toBe(false);
  });

  it("enabled remediation downloads, writes, verifies hashes, and records config-only success", async () => {
    const { repoRoot, modelPath, phase13Path } = await tempFixture();
    const result = await runSuperArtifactRemediation({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13Path),
      modelPath,
      enabled: true,
      runtimePreflight: healthyPreflight,
      commandRunner: fakeCommandRunner,
      downloader: fakeDownloader,
    });

    const written = result.files_written.map((step) => step.file_name);
    expect(result.final_verdict).toBe("remediation_verified");
    expect(written).toContain("configuration_nemotron_h.py");
    expect(written).toContain("modeling_nemotron_h.py");
    expect(await readFile(path.join(modelPath, "configuration_nemotron_h.py"), "utf8")).toContain("NemotronHConfig");
    expect(result.files_written.every((step) => step.staged_sha256 && step.staged_sha256 === step.final_sha256)).toBe(true);
    expect(result.verification_results.every((entry) => entry.compile_status !== "failed")).toBe(true);
    expect(result.config_only_check.status).toBe("passed");
    expect(result.model_load_occurred).toBe(false);
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
  });

  it("blocks missing official source", async () => {
    const { repoRoot, modelPath, phase13Path } = await tempFixture();
    const result = await runSuperArtifactRemediation({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13Path),
      modelPath,
      enabled: true,
      runtimePreflight: healthyPreflight,
      commandRunner: fakeCommandRunner,
      downloader: async () => {
        throw new Error("404");
      },
    });

    expect(result.final_verdict).toBe("remediation_blocked");
    expect(result.files_written).toEqual([]);
  });

  it("enforces official repo id and safety flags", async () => {
    const { repoRoot, modelPath, phase13Path } = await tempFixture();
    const result = await runSuperArtifactRemediation({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13Path),
      modelPath,
      sourceRepoId: "someone/unofficial",
      enabled: true,
      runtimePreflight: healthyPreflight,
      commandRunner: fakeCommandRunner,
      downloader: fakeDownloader,
      safetyOverrides: { servingOccurred: true, inferenceOccurred: true, qwenUsed: true, fallbackUsed: true, integrationPerformed: true },
    });

    expect(result.final_verdict).toBe("remediation_unsafe");
    expect(result.safety_gates.filter((gate) => gate.status === "failed").map((gate) => gate.name)).toEqual(expect.arrayContaining([
      "official_source_repo",
      "no_inference_or_generation",
      "no_serving",
      "qwen_not_used",
      "fallback_not_used",
      "no_integration",
    ]));
  });

  it("compile failure blocks verification", async () => {
    const { repoRoot, modelPath, phase13Path } = await tempFixture();
    const result = await runSuperArtifactRemediation({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13Path),
      modelPath,
      enabled: true,
      runtimePreflight: healthyPreflight,
      commandRunner: async (command, args) => {
        if (args.includes("py_compile")) return { stdout: "", stderr: "SyntaxError", exitCode: 1 };
        return fakeCommandRunner(command, args);
      },
      downloader: fakeDownloader,
    });

    expect(result.final_verdict).toBe("remediation_blocked");
    expect(result.verification_results.some((entry) => entry.compile_status === "failed")).toBe(true);
  });
});

async function tempFixture(): Promise<{ repoRoot: string; modelPath: string; phase13Path: string }> {
  const repoRoot = await tempRepo();
  const modelPath = await tempModel();
  const phase13Path = path.join(repoRoot, "phase13.json");
  await writePhase13Evidence(phase13Path);
  return { repoRoot, modelPath, phase13Path };
}

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "super-artifact-repo-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, ".venv-airllm", "bin"), { recursive: true });
  await writeFile(path.join(dir, ".venv-airllm", "bin", "python"), "");
  return dir;
}

async function tempModel(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "super-artifact-model-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, "config.json"), JSON.stringify({
    model_type: "nemotron_h",
    architectures: ["NemotronHForCausalLM"],
    auto_map: {
      AutoConfig: "configuration_nemotron_h.NemotronHConfig",
      AutoModelForCausalLM: "modeling_nemotron_h.NemotronHForCausalLM",
    },
  }));
  await writeFile(path.join(dir, "tokenizer.json"), "{}");
  await writeFile(path.join(dir, "tokenizer_config.json"), "{}");
  await writeFile(path.join(dir, "special_tokens_map.json"), "{}");
  await writeFile(path.join(dir, "hf_quant_config.json"), "{}");
  await writeFile(path.join(dir, "generation_config.json"), "{}");
  await writeFile(path.join(dir, "model.safetensors.index.json"), "{}");
  await writeFile(path.join(dir, "model-00001-of-00026.safetensors"), "weight-placeholder");
  return dir;
}

async function writePhase13Evidence(filePath: string): Promise<void> {
  await writeFile(filePath, JSON.stringify({
    final_verdict: "boot_probe_failed",
    child_process: {
      stdout_summary: "model_load_failed configuration_nemotron_h.py missing",
      stderr_summary: "Could not locate configuration_nemotron_h.py",
    },
  }));
}

const fakeDownloader: SuperArtifactDownloader = async (input) => {
  const content: Record<string, string> = {
    "configuration_nemotron_h.py": "class NemotronHConfig: pass\n",
    "modeling_nemotron_h.py": "class NemotronHForCausalLM: pass\n",
    "__init__.py": "\n",
    "super_v3_reasoning_parser.py": "class ReasoningParser: pass\n",
    "chat_template.jinja": "{{ messages }}\n",
  };
  return {
    bytes: Buffer.from(content[input.fileName] ?? "{}\n"),
    sourceUrl: input.url,
  };
};

async function fakeCommandRunner(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (command === "git" && args[0] === "status") return { stdout: "", stderr: "", exitCode: 0 };
  if (command === "git" && args[0] === "rev-parse") return { stdout: "36a4cd4\n", stderr: "", exitCode: 0 };
  if (args.includes("py_compile")) return { stdout: "", stderr: "", exitCode: 0 };
  if (args.includes("-c")) return { stdout: JSON.stringify({ model_type: "nemotron_h", model_load_performed: false }), stderr: "", exitCode: 0 };
  return { stdout: "", stderr: "", exitCode: 0 };
}

async function healthyPreflight(): Promise<RuntimeSupervisorReport> {
  return {
    report_schema: "runtime_supervisor.phase_6.v1",
    generated_at: "2026-06-21T22:20:00.000Z",
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
    evidence_path: "runtime.json",
  };
}
