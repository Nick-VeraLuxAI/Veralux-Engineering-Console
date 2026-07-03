import { execFile } from "child_process";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { resolveModelRole, type ModelRoleAssignment } from "../model-role-stub";
import type { SuperAuditCommandRunner } from "../super-compatibility/super-compatibility-audit";

export type AirLlmNemotronCompatibilityVerdict =
  | "compatibility_patch_viable"
  | "compatibility_patch_failed"
  | "compatibility_requires_fork"
  | "airllm_no_go_for_nemotronh"
  | "compatibility_unknown";

export interface NemotronConfigAnalysis {
  architecture: string | null;
  model_type: string | null;
  auto_map: Record<string, string> | null;
  num_hidden_layers: number | null;
  diagnostics: string[];
}

export interface NemotronWeightPrefixAnalysis {
  weight_map_count: number;
  safetensors_shard_count: number;
  layer_count: number;
  embedding_prefix: string | null;
  layer_prefix: string | null;
  norm_prefix: string | null;
  lm_head_prefix: string | null;
  sample_keys: string[];
  diagnostics: string[];
}

export interface NemotronSplitSimulation {
  proposed_layer_names: string[];
  empty_layers: string[];
  missing_shard_files: string[];
  layer_to_shard_counts: Record<string, number>;
  split_writes_performed: false;
  tensor_data_loaded: false;
  status: "passed" | "failed";
}

export interface AirLlmSourceAudit {
  airllm_version: string | null;
  source_files_inspected: string[];
  supported_architecture_patterns: string[];
  unknown_architecture_fallback: "llama2" | "none" | "unknown";
  layer_names_supported: boolean;
  delete_original_supported_and_forbidden: boolean;
  llama_runtime_assumptions: string[];
  diagnostics: string[];
}

export interface AirLlmOverlayDryRun {
  status: "passed" | "failed" | "skipped";
  command: string[];
  exit_code: number | null;
  stdout_summary: string | null;
  stderr_summary: string | null;
  child_process_only: boolean;
  site_packages_modified: false;
  model_load_attempted: false;
  split_shards_written: false;
  diagnostics: string[];
}

export interface AirLlmNemotronSafetyGate {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface AirLlmNemotronCompatibilityResult {
  phase_id: "phase-15-airllm-nemotronh-compatibility";
  compatibility_id: string;
  timestamp: string;
  repo_commit_at_start: string | null;
  phase13_evidence_path: string;
  phase14_evidence_path: string;
  model_path: string;
  runtime_path: ".venv-airllm/bin/python";
  config_analysis: NemotronConfigAnalysis;
  weight_prefix_analysis: NemotronWeightPrefixAnalysis;
  airllm_source_audit: AirLlmSourceAudit;
  split_simulation: NemotronSplitSimulation;
  overlay_strategy: string;
  overlay_dry_run: AirLlmOverlayDryRun;
  safety_gates: AirLlmNemotronSafetyGate[];
  site_packages_modified: false;
  model_load_attempted: false;
  split_shards_written: false;
  inference_or_generation_occurred: false;
  serving_occurred: false;
  qwen_used: false;
  fallback_used: false;
  integration_performed: false;
  senior_role_resolution: ModelRoleAssignment;
  final_verdict: AirLlmNemotronCompatibilityVerdict;
  recommended_next_action: string;
  evidence_path: string;
  blocked_reasons: string[];
  warnings: string[];
}

export interface AirLlmNemotronCompatibilityOptions {
  repoRoot?: string;
  evidenceRoot?: string;
  phase13EvidencePath: string;
  phase14EvidencePath: string;
  modelPath?: string;
  runtimePath?: ".venv-airllm/bin/python";
  now?: () => Date;
  commandRunner?: SuperAuditCommandRunner;
  env?: NodeJS.ProcessEnv;
  safetyOverrides?: Partial<{
    deleteOriginal: boolean;
    generation: boolean;
    serving: boolean;
    qwenUsed: boolean;
    fallbackUsed: boolean;
    integration: boolean;
    sitePackagesModified: boolean;
    modelLoadAttempted: boolean;
    splitShardsWritten: boolean;
  }>;
}

const DEFAULT_MODEL_PATH = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
const DEFAULT_RUNTIME = ".venv-airllm/bin/python" as const;
const AIRLLM_FILES = [
  "auto_model.py",
  "airllm_base.py",
  "airllm.py",
  "utils.py",
];

export async function runAirLlmNemotronCompatibilityProof(
  options: AirLlmNemotronCompatibilityOptions,
): Promise<AirLlmNemotronCompatibilityResult> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const compatibilityId = `phase-15-airllm-nemotronh-compatibility-${safeTimestamp(timestamp)}`;
  const evidenceRoot = options.evidenceRoot ?? "evidence/airllm-nemotron-compatibility";
  const evidencePath = path.join(evidenceRoot, `${compatibilityId}.json`);
  const modelPath = options.modelPath ?? DEFAULT_MODEL_PATH;
  const runtimePath = options.runtimePath ?? DEFAULT_RUNTIME;
  const runner = options.commandRunner ?? defaultCommandRunner;
  const seniorRole = resolveModelRole("console_senior_worker", options.env);

  const [repoCommit, phase13Ready, phase14Ready, runtimeExists, modelExists] = await Promise.all([
    repoCommitAtStart(runner),
    evidenceExists(path.join(repoRoot, options.phase13EvidencePath)),
    evidenceExists(path.join(repoRoot, options.phase14EvidencePath)),
    evidenceExists(path.join(repoRoot, runtimePath)),
    directoryExists(modelPath),
  ]);
  const configAnalysis = await analyzeNemotronConfig(modelPath);
  const weightPrefixAnalysis = await analyzeNemotronWeights(modelPath);
  const airllmSourceAudit = await auditAirLlmSource({ repoRoot, runtimePath, runner });
  const splitSimulation = simulateNemotronSplit({ modelPath, weightPrefixAnalysis });
  const overlayDryRun = await runOverlayDryRun({ repoRoot, runtimePath, modelPath, runner });
  const safetyGates = evaluateSafetyGates({
    phase13Ready,
    phase14Ready,
    runtimeExists,
    modelExists,
    configAnalysis,
    weightPrefixAnalysis,
    airllmSourceAudit,
    splitSimulation,
    overlayDryRun,
    seniorRole,
    safetyOverrides: options.safetyOverrides,
  });
  const finalVerdict = evaluateVerdict({ safetyGates, airllmSourceAudit, splitSimulation, overlayDryRun });
  const result: AirLlmNemotronCompatibilityResult = {
    phase_id: "phase-15-airllm-nemotronh-compatibility",
    compatibility_id: compatibilityId,
    timestamp,
    repo_commit_at_start: repoCommit,
    phase13_evidence_path: options.phase13EvidencePath,
    phase14_evidence_path: options.phase14EvidencePath,
    model_path: modelPath,
    runtime_path: runtimePath,
    config_analysis: configAnalysis,
    weight_prefix_analysis: weightPrefixAnalysis,
    airllm_source_audit: airllmSourceAudit,
    split_simulation: splitSimulation,
    overlay_strategy: "child-process-only in-memory dispatch/layer-name overlay; no site-packages edits and no model load in default proof",
    overlay_dry_run: overlayDryRun,
    safety_gates: safetyGates,
    site_packages_modified: false,
    model_load_attempted: false,
    split_shards_written: false,
    inference_or_generation_occurred: false,
    serving_occurred: false,
    qwen_used: false,
    fallback_used: false,
    integration_performed: false,
    senior_role_resolution: seniorRole,
    final_verdict: finalVerdict,
    recommended_next_action: recommendation(finalVerdict),
    evidence_path: evidencePath,
    blocked_reasons: safetyGates.filter((gate) => gate.status === "failed").map((gate) => `${gate.name}:${gate.message}`),
    warnings: [
      ...configAnalysis.diagnostics,
      ...weightPrefixAnalysis.diagnostics,
      ...airllmSourceAudit.diagnostics,
      ...overlayDryRun.diagnostics,
    ],
  };
  await writeJson(evidencePath, result);
  return result;
}

export async function analyzeNemotronConfig(modelPath: string): Promise<NemotronConfigAnalysis> {
  try {
    const parsed = JSON.parse(await readFile(path.join(modelPath, "config.json"), "utf8")) as {
      architectures?: string[];
      model_type?: string;
      auto_map?: Record<string, string>;
      num_hidden_layers?: number;
    };
    return {
      architecture: parsed.architectures?.[0] ?? null,
      model_type: parsed.model_type ?? null,
      auto_map: parsed.auto_map ?? null,
      num_hidden_layers: typeof parsed.num_hidden_layers === "number" ? parsed.num_hidden_layers : null,
      diagnostics: [],
    };
  } catch (error) {
    return {
      architecture: null,
      model_type: null,
      auto_map: null,
      num_hidden_layers: null,
      diagnostics: [error instanceof Error ? `NEMOTRON_CONFIG_READ_FAILED:${error.message}` : "NEMOTRON_CONFIG_READ_FAILED"],
    };
  }
}

export async function analyzeNemotronWeights(modelPath: string): Promise<NemotronWeightPrefixAnalysis> {
  try {
    const index = JSON.parse(await readFile(path.join(modelPath, "model.safetensors.index.json"), "utf8")) as { weight_map?: Record<string, string> };
    const weightMap = index.weight_map ?? {};
    const keys = Object.keys(weightMap);
    const layerIds = new Set<number>();
    for (const key of keys) {
      const match = /^backbone\.layers\.(\d+)\./.exec(key);
      if (match) layerIds.add(Number(match[1]));
    }
    const shardNames = new Set(Object.values(weightMap));
    return {
      weight_map_count: keys.length,
      safetensors_shard_count: shardNames.size,
      layer_count: layerIds.size,
      embedding_prefix: keys.some((key) => key.startsWith("backbone.embeddings.")) ? "backbone.embeddings" : null,
      layer_prefix: layerIds.size > 0 ? "backbone.layers" : null,
      norm_prefix: keys.some((key) => key.startsWith("backbone.norm_f.")) ? "backbone.norm_f" : null,
      lm_head_prefix: keys.some((key) => key.startsWith("lm_head.")) ? "lm_head" : null,
      sample_keys: keys.slice(0, 25),
      diagnostics: [],
    };
  } catch (error) {
    return {
      weight_map_count: 0,
      safetensors_shard_count: 0,
      layer_count: 0,
      embedding_prefix: null,
      layer_prefix: null,
      norm_prefix: null,
      lm_head_prefix: null,
      sample_keys: [],
      diagnostics: [error instanceof Error ? `NEMOTRON_INDEX_READ_FAILED:${error.message}` : "NEMOTRON_INDEX_READ_FAILED"],
    };
  }
}

export function simulateNemotronSplit(input: {
  modelPath: string;
  weightPrefixAnalysis: NemotronWeightPrefixAnalysis;
}): NemotronSplitSimulation {
  const names = proposedLayerNames(input.weightPrefixAnalysis);
  const layerToShardCounts: Record<string, number> = {};
  const emptyLayers: string[] = [];
  const missingShardFiles: string[] = [];
  let weightMap: Record<string, string> = {};
  try {
    const index = JSON.parse(require("fs").readFileSync(path.join(input.modelPath, "model.safetensors.index.json"), "utf8")) as { weight_map?: Record<string, string> };
    weightMap = index.weight_map ?? {};
    for (const layer of names) {
      const prefix = `${layer}.`;
      const shards = [...new Set(Object.entries(weightMap).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value))];
      layerToShardCounts[layer] = shards.length;
      if (shards.length === 0) emptyLayers.push(layer);
      for (const shard of shards) {
        if (!require("fs").existsSync(path.join(input.modelPath, shard))) missingShardFiles.push(shard);
      }
    }
  } catch {
    emptyLayers.push(...names);
  }
  return {
    proposed_layer_names: names,
    empty_layers: emptyLayers,
    missing_shard_files: [...new Set(missingShardFiles)],
    layer_to_shard_counts: layerToShardCounts,
    split_writes_performed: false,
    tensor_data_loaded: false,
    status: emptyLayers.length === 0 && missingShardFiles.length === 0 && names.length > 0 ? "passed" : "failed",
  };
}

export async function auditAirLlmSource(input: {
  repoRoot: string;
  runtimePath: string;
  runner: SuperAuditCommandRunner;
}): Promise<AirLlmSourceAudit> {
  const root = path.join(input.repoRoot, ".venv-airllm/lib/python3.12/site-packages/airllm");
  const sourceFiles = AIRLLM_FILES.map((file) => path.join(root, file));
  const contents = await Promise.all(sourceFiles.map(async (file) => {
    try {
      return await readFile(file, "utf8");
    } catch {
      return "";
    }
  }));
  const autoModel = contents[0] ?? "";
  const base = contents[1] ?? "";
  const utils = contents[3] ?? "";
  const version = await input.runner(input.runtimePath, ["-c", "import importlib.metadata; print(importlib.metadata.version('airllm'))"]);
  const patterns = [...autoModel.matchAll(/"([^"]+ForCausalLM|QWen|Baichuan|ChatGLM|InternLM|Mistral|Mixtral|Llama)"/g)].map((match) => match[1]);
  return {
    airllm_version: version.exitCode === 0 ? version.stdout.trim() || null : null,
    source_files_inspected: sourceFiles,
    supported_architecture_patterns: [...new Set(patterns)],
    unknown_architecture_fallback: autoModel.includes("try to use Llama2") ? "llama2" : "unknown",
    layer_names_supported: utils.includes("layer_names") && base.includes("set_layer_names_dict"),
    delete_original_supported_and_forbidden: utils.includes("delete_original") && base.includes("delete_original=False"),
    llama_runtime_assumptions: [
      base.includes("self.model.model.layers[3].self_attn") ? "init_model probes self.model.model.layers[3].self_attn" : null,
      base.includes("prepare_inputs_for_generation") ? "base prepare_inputs_for_generation is Llama-style" : null,
      base.includes("past_key_values[0][0].shape[2]") ? "base KV cache sequence dimension assumes Llama layout" : null,
      base.includes("attention_mask[:, :, -len_s:, -len_p - len_s:]") ? "base attention mask slicing assumes decoder-only attention layout" : null,
    ].filter((entry): entry is string => !!entry),
    diagnostics: autoModel.includes("NemotronHForCausalLM") ? [] : ["AIRLLM_NEMOTRONH_ARCHITECTURE_NOT_MAPPED"],
  };
}

export async function runOverlayDryRun(input: {
  repoRoot: string;
  runtimePath: string;
  modelPath: string;
  runner: SuperAuditCommandRunner;
}): Promise<AirLlmOverlayDryRun> {
  const script = [
    "import json",
    "from transformers import AutoConfig",
    "from airllm.auto_model import AutoModel",
    "from airllm.airllm_base import AirLLMBaseModel",
    `model_path = ${JSON.stringify(input.modelPath)}`,
    "cfg = AutoConfig.from_pretrained(model_path, trust_remote_code=True)",
    "class AirLLMNemotronH(AirLLMBaseModel):",
    "    def set_layer_names_dict(self):",
    "        self.layer_names_dict = {'embed':'backbone.embeddings','layer_prefix':'backbone.layers','norm':'backbone.norm_f','lm_head':'lm_head'}",
    "    def get_use_better_transformer(self):",
    "        return False",
    "def patched_get_module_class(cls, pretrained_model_name_or_path, *inputs, **kwargs):",
    "    cfg2 = AutoConfig.from_pretrained(pretrained_model_name_or_path, trust_remote_code=True)",
    "    if cfg2.architectures and cfg2.architectures[0] == 'NemotronHForCausalLM':",
    "        return __name__, 'AirLLMNemotronH'",
    "    return AutoModel.get_module_class(pretrained_model_name_or_path, *inputs, **kwargs)",
    "print(json.dumps({'architecture': cfg.architectures[0], 'model_type': cfg.model_type, 'overlay_class_defined': True, 'model_load_attempted': False, 'split_shards_written': False, 'site_packages_modified': False}), flush=True)",
  ].join("\n");
  const result = await input.runner(input.runtimePath, ["-c", script]);
  return {
    status: result.exitCode === 0 ? "passed" : "failed",
    command: [input.runtimePath, "-c", "<phase-15-child-overlay-dry-run>"],
    exit_code: result.exitCode,
    stdout_summary: summarize(result.stdout),
    stderr_summary: summarize(result.stderr),
    child_process_only: true,
    site_packages_modified: false,
    model_load_attempted: false,
    split_shards_written: false,
    diagnostics: result.exitCode === 0 ? [] : [summarize(result.stderr || result.stdout || "OVERLAY_DRY_RUN_FAILED") ?? "OVERLAY_DRY_RUN_FAILED"],
  };
}

function proposedLayerNames(analysis: NemotronWeightPrefixAnalysis): string[] {
  if (!analysis.embedding_prefix || !analysis.layer_prefix || !analysis.norm_prefix || !analysis.lm_head_prefix || analysis.layer_count === 0) return [];
  return [
    analysis.embedding_prefix,
    ...Array.from({ length: analysis.layer_count }, (_, index) => `${analysis.layer_prefix}.${index}`),
    analysis.norm_prefix,
    analysis.lm_head_prefix,
  ];
}

function evaluateSafetyGates(input: {
  phase13Ready: boolean;
  phase14Ready: boolean;
  runtimeExists: boolean;
  modelExists: boolean;
  configAnalysis: NemotronConfigAnalysis;
  weightPrefixAnalysis: NemotronWeightPrefixAnalysis;
  airllmSourceAudit: AirLlmSourceAudit;
  splitSimulation: NemotronSplitSimulation;
  overlayDryRun: AirLlmOverlayDryRun;
  seniorRole: ModelRoleAssignment;
  safetyOverrides?: AirLlmNemotronCompatibilityOptions["safetyOverrides"];
}): AirLlmNemotronSafetyGate[] {
  const safety = input.safetyOverrides ?? {};
  return [
    gate("phase13_rerun_evidence_exists", input.phase13Ready, "Phase 13 rerun evidence exists."),
    gate("phase14_remediation_evidence_exists", input.phase14Ready, "Phase 14 remediation evidence exists."),
    gate("official_airllm_runtime_exists", input.runtimeExists, ".venv-airllm/bin/python exists."),
    gate("model_path_exists", input.modelExists, "Model path exists."),
    gate("safetensors_index_and_26_shards", input.weightPrefixAnalysis.weight_map_count > 0 && input.weightPrefixAnalysis.safetensors_shard_count === 26, "Safetensors index exists with 26 shards."),
    gate("architecture_is_nemotronh", input.configAnalysis.architecture === "NemotronHForCausalLM", "Architecture is NemotronHForCausalLM."),
    gate("model_type_is_nemotronh", input.configAnalysis.model_type === "nemotron_h", "Model type is nemotron_h."),
    gate("airllm_detects_llama_fallback", input.airllmSourceAudit.unknown_architecture_fallback === "llama2", "AirLLM unknown architecture fallback is Llama2."),
    gate("split_simulation_no_empty_layers", input.splitSimulation.status === "passed", "Proposed NemotronH layer names avoid empty shard lookup."),
    gate("overlay_dry_run_passed", input.overlayDryRun.status === "passed", "Child-process overlay dry run passed without model load."),
    gate("delete_original_forbidden", safety.deleteOriginal !== true, "delete_original=True was not used."),
    gate("no_generation", safety.generation !== true, "Generation was not used."),
    gate("no_serving", safety.serving !== true, "Serving was not started."),
    gate("qwen_not_used", safety.qwenUsed !== true, "Qwen was not used."),
    gate("fallback_not_used", safety.fallbackUsed !== true, "No fallback was used."),
    gate("no_integration", safety.integration !== true, "No integration occurred."),
    gate("no_site_packages_mutation", safety.sitePackagesModified !== true, "Site-packages were not modified."),
    gate("no_model_load", safety.modelLoadAttempted !== true, "No model load was attempted in Phase 15 default proof."),
    gate("no_split_writes", safety.splitShardsWritten !== true, "No split shards were written."),
    gate("senior_role_blocked_unproven", input.seniorRole.status === "blocked_unproven", "Senior role remains blocked_unproven."),
  ];
}

function evaluateVerdict(input: {
  safetyGates: AirLlmNemotronSafetyGate[];
  airllmSourceAudit: AirLlmSourceAudit;
  splitSimulation: NemotronSplitSimulation;
  overlayDryRun: AirLlmOverlayDryRun;
}): AirLlmNemotronCompatibilityVerdict {
  if (input.safetyGates.some((gateItem) => gateItem.status === "failed" && ["delete_original_forbidden", "no_generation", "no_serving", "qwen_not_used", "fallback_not_used", "no_integration", "no_site_packages_mutation", "no_model_load", "no_split_writes"].includes(gateItem.name))) return "compatibility_patch_failed";
  if (input.splitSimulation.status === "failed") return "airllm_no_go_for_nemotronh";
  if (input.overlayDryRun.status === "failed") return "compatibility_patch_failed";
  if (input.airllmSourceAudit.llama_runtime_assumptions.length > 0) return "compatibility_requires_fork";
  if (input.safetyGates.every((gateItem) => gateItem.status === "passed")) return "compatibility_patch_viable";
  return "compatibility_unknown";
}

function recommendation(verdict: AirLlmNemotronCompatibilityVerdict): string {
  if (verdict === "compatibility_requires_fork") return "Treat AirLLM NemotronH as requiring a maintained project-owned fork/adapter before any further guarded load attempt.";
  if (verdict === "compatibility_patch_viable") return "Prepare a reviewed project-owned overlay and request explicit approval before any guarded compatibility load.";
  if (verdict === "airllm_no_go_for_nemotronh") return "Mark AirLLM senior runtime no_go for NemotronH unless a different runtime is selected.";
  if (verdict === "compatibility_patch_failed") return "Do not retry without changing the patch approach and preserving safety gates.";
  return "Collect more compatibility evidence before attempting any load.";
}

async function evidenceExists(filePath: string): Promise<boolean> {
  try {
    const entry = await stat(filePath);
    return entry.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(filePath: string): Promise<boolean> {
  try {
    const entry = await stat(filePath);
    return entry.isDirectory();
  } catch {
    return false;
  }
}

async function repoCommitAtStart(runner: SuperAuditCommandRunner): Promise<string | null> {
  const result = await runner("git", ["rev-parse", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

function gate(name: string, passed: boolean, message: string): AirLlmNemotronSafetyGate {
  return { name, status: passed ? "passed" : "failed", message };
}

function summarize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 4000 ? `${trimmed.slice(0, 4000)}...` : trimmed;
}

const execFileAsync = promisify(execFile);

async function defaultCommandRunner(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const maybeError = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof maybeError.code === "number" ? maybeError.code : 1,
    };
  }
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export const DEFAULT_AIRLLM_NEMOTRON_COMPATIBILITY_CONFIG = {
  modelPath: DEFAULT_MODEL_PATH,
  runtimePath: DEFAULT_RUNTIME,
};
