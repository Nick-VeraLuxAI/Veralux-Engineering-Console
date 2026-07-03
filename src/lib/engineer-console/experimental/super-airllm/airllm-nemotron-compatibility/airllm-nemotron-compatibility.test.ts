import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeNemotronConfig,
  analyzeNemotronWeights,
  runAirLlmNemotronCompatibilityProof,
  simulateNemotronSplit,
} from "./airllm-nemotron-compatibility";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 15 AirLLM NemotronH compatibility", () => {
  it("detects NemotronH config and auto_map", async () => {
    const modelPath = await tempModel();
    const config = await analyzeNemotronConfig(modelPath);

    expect(config.architecture).toBe("NemotronHForCausalLM");
    expect(config.model_type).toBe("nemotron_h");
    expect(config.auto_map?.AutoConfig).toBe("configuration_nemotron_h.NemotronHConfig");
  });

  it("extracts backbone layer prefixes and simulates non-empty split lookup", async () => {
    const modelPath = await tempModel();
    const weights = await analyzeNemotronWeights(modelPath);
    const simulation = simulateNemotronSplit({ modelPath, weightPrefixAnalysis: weights });

    expect(weights.layer_prefix).toBe("backbone.layers");
    expect(weights.layer_count).toBe(3);
    expect(simulation.status).toBe("passed");
    expect(simulation.empty_layers).toEqual([]);
    expect(simulation.split_writes_performed).toBe(false);
    expect(simulation.tensor_data_loaded).toBe(false);
  });

  it("failed split simulation yields airllm_no_go_for_nemotronh", async () => {
    const { repoRoot, modelPath, phase13, phase14 } = await tempFixture();
    await writeIndex(modelPath, { "model.layers.0.weight": "model-00001-of-00026.safetensors" });

    const result = await runAirLlmNemotronCompatibilityProof({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13),
      phase14EvidencePath: path.basename(phase14),
      modelPath,
      commandRunner: fakeCommandRunner(repoRoot),
    });

    expect(result.final_verdict).toBe("airllm_no_go_for_nemotronh");
    expect(result.split_simulation.status).toBe("failed");
  });

  it("detects Llama fallback and returns requires_fork when split overlay is bounded", async () => {
    const { repoRoot, modelPath, phase13, phase14 } = await tempFixture();
    const result = await runAirLlmNemotronCompatibilityProof({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13),
      phase14EvidencePath: path.basename(phase14),
      modelPath,
      commandRunner: fakeCommandRunner(repoRoot),
    });

    expect(result.final_verdict).toBe("compatibility_requires_fork");
    expect(result.airllm_source_audit.unknown_architecture_fallback).toBe("llama2");
    expect(result.airllm_source_audit.llama_runtime_assumptions.length).toBeGreaterThan(0);
    expect(result.overlay_dry_run.status).toBe("passed");
    expect(result.site_packages_modified).toBe(false);
    expect(result.model_load_attempted).toBe(false);
    expect(result.split_shards_written).toBe(false);
    expect(result.senior_role_resolution.status).toBe("blocked_unproven");
  });

  it("safety flags produce failed compatibility without site-package mutation", async () => {
    const { repoRoot, modelPath, phase13, phase14 } = await tempFixture();
    const result = await runAirLlmNemotronCompatibilityProof({
      repoRoot,
      evidenceRoot: path.join(repoRoot, "evidence"),
      phase13EvidencePath: path.basename(phase13),
      phase14EvidencePath: path.basename(phase14),
      modelPath,
      commandRunner: fakeCommandRunner(repoRoot),
      safetyOverrides: {
        deleteOriginal: true,
        generation: true,
        serving: true,
        qwenUsed: true,
        fallbackUsed: true,
        integration: true,
        sitePackagesModified: true,
        modelLoadAttempted: true,
        splitShardsWritten: true,
      },
    });

    expect(result.final_verdict).toBe("compatibility_patch_failed");
    expect(result.safety_gates.filter((gate) => gate.status === "failed").map((gate) => gate.name)).toEqual(expect.arrayContaining([
      "delete_original_forbidden",
      "no_generation",
      "no_serving",
      "qwen_not_used",
      "fallback_not_used",
      "no_integration",
      "no_site_packages_mutation",
      "no_model_load",
      "no_split_writes",
    ]));
  });
});

async function tempFixture(): Promise<{ repoRoot: string; modelPath: string; phase13: string; phase14: string }> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "nemotron-compat-repo-"));
  tempDirs.push(repoRoot);
  await writeAirLlmSources(repoRoot);
  const modelPath = await tempModel();
  const phase13 = path.join(repoRoot, "phase13.json");
  const phase14 = path.join(repoRoot, "phase14.json");
  await writeFile(phase13, JSON.stringify({ final_verdict: "boot_probe_failed" }));
  await writeFile(phase14, JSON.stringify({ final_verdict: "remediation_verified" }));
  return { repoRoot, modelPath, phase13, phase14 };
}

async function tempModel(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nemotron-compat-model-"));
  tempDirs.push(dir);
  await writeFile(path.join(dir, "config.json"), JSON.stringify({
    architectures: ["NemotronHForCausalLM"],
    model_type: "nemotron_h",
    auto_map: {
      AutoConfig: "configuration_nemotron_h.NemotronHConfig",
      AutoModelForCausalLM: "modeling_nemotron_h.NemotronHForCausalLM",
    },
    num_hidden_layers: 3,
  }));
  await writeIndex(dir, {
    "backbone.embeddings.weight": "model-00001-of-00026.safetensors",
    "backbone.layers.0.mixer.weight": "model-00001-of-00026.safetensors",
    "backbone.layers.1.mixer.weight": "model-00002-of-00026.safetensors",
    "backbone.layers.2.mixer.weight": "model-00003-of-00026.safetensors",
    "backbone.norm_f.weight": "model-00003-of-00026.safetensors",
    "lm_head.weight": "model-00003-of-00026.safetensors",
  });
  for (let index = 1; index <= 3; index += 1) {
    await writeFile(path.join(dir, `model-0000${index}-of-00026.safetensors`), "placeholder");
  }
  return dir;
}

async function writeIndex(modelPath: string, weightMap: Record<string, string>): Promise<void> {
  await writeFile(path.join(modelPath, "model.safetensors.index.json"), JSON.stringify({ weight_map: weightMap }));
}

async function writeAirLlmSources(repoRoot: string): Promise<void> {
  const root = path.join(repoRoot, ".venv-airllm/lib/python3.12/site-packages/airllm");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "auto_model.py"), [
    "if 'Llama' in config.architectures[0]: pass",
    "else: print('unknown artichitecture: x, try to use Llama2...')",
  ].join("\n"));
  await writeFile(path.join(root, "airllm_base.py"), [
    "def set_layer_names_dict(self): pass",
    "print(self.model.model.layers[3].self_attn)",
    "def prepare_inputs_for_generation(): pass",
    "past_key_values[0][0].shape[2]",
    "attention_mask[:, :, -len_s:, -len_p - len_s:]",
    "delete_original=False",
  ].join("\n"));
  await writeFile(path.join(root, "airllm.py"), "class AirLLMLlama2: pass\n");
  await writeFile(path.join(root, "utils.py"), "layer_names = None\ndelete_original = False\n");
}

function fakeCommandRunner(repoRoot: string) {
  return async (command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    if (command === "git") return { stdout: "72f43b9\n", stderr: "", exitCode: 0 };
    if (args.join(" ").includes("importlib.metadata.version('airllm')")) return { stdout: "2.11.0\n", stderr: "", exitCode: 0 };
    if (args.includes("-c")) return { stdout: JSON.stringify({ architecture: "NemotronHForCausalLM", model_load_attempted: false, split_shards_written: false, site_packages_modified: false }), stderr: "", exitCode: 0 };
    if (command.includes(repoRoot)) return { stdout: "", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  };
}
