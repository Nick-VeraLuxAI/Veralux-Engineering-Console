import { execFile } from "child_process";
import { createHash } from "crypto";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "fs/promises";
import path from "path";
import { promisify } from "util";

export type MixtralSeniorCandidateStatus =
  | "candidate_unproven"
  | "candidate_proven_import_only"
  | "candidate_proven_boot"
  | "candidate_proven_bounded_review"
  | "candidate_failed"
  | "candidate_failed_route_test"
  | "candidate_failed_runtime_test"
  | "candidate_needs_tuning";

export type MixtralPhase16Verdict =
  | "mixtral_candidate_ready_for_manual_review"
  | "mixtral_candidate_import_only"
  | "mixtral_candidate_boot_only"
  | "mixtral_candidate_failed"
  | "mixtral_download_blocked"
  | "mixtral_access_blocked_before_delete"
  | "nemotron_delete_blocked_path_verification_failed";

export interface NemotronDeleteVerification {
  requested_path: string;
  realpath: string | null;
  basename: string | null;
  is_directory: boolean;
  config_exists: boolean;
  config_mentions_nemotron: boolean;
  unsafe_path: boolean;
  safe_to_delete: boolean;
  diagnostics: string[];
}

export interface MixtralArtifactVerification {
  local_path: string;
  exists: boolean;
  config_exists: boolean;
  tokenizer_files: string[];
  safetensors_files: string[];
  index_files: string[];
  architecture: string | null;
  model_type: string | null;
  shard_count: number;
  apparent_size: string | null;
  qwen_files_added: boolean;
  status: "passed" | "failed";
  diagnostics: string[];
}

export interface AirLlmMixtralRouteProof {
  architecture: string | null;
  expected_class: "AirLLMMixtral" | null;
  fallback_to_llama2: boolean;
  status: "passed" | "failed";
  diagnostics: string[];
}

export interface ColdSeniorRoleStatus {
  role: "console_cold_senior_reviewer";
  provider: "airllm-cold";
  model: "mistralai/Mixtral-8x22B-Instruct-v0.1";
  local_path: string;
  status: MixtralSeniorCandidateStatus;
  mode: "offline_review_job";
  writes: "none";
  fallback: "none";
  required_for_mainline: false;
  senior_promoted_to_routing: false;
}

export const MIXTRAL_REPO_ID = "mistralai/Mixtral-8x22B-Instruct-v0.1";
export const MIXTRAL_LOCAL_PATH = "/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1";
export const NEMOTRON_LOCAL_PATH = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
export const AIRLLM_PYTHON = ".venv-airllm/bin/python";

const execFileAsync = promisify(execFile);

export async function verifyNemotronDeleteTarget(targetPath = NEMOTRON_LOCAL_PATH): Promise<NemotronDeleteVerification> {
  const diagnostics: string[] = [];
  let resolved: string | null = null;
  let isDirectory = false;
  let configExists = false;
  let configMentionsNemotron = false;
  try {
    resolved = await realpath(targetPath);
  } catch (error) {
    diagnostics.push(error instanceof Error ? `REALPATH_FAILED:${error.message}` : "REALPATH_FAILED");
  }
  try {
    isDirectory = (await stat(targetPath)).isDirectory();
  } catch {
    isDirectory = false;
  }
  try {
    const config = await readFile(path.join(targetPath, "config.json"), "utf8");
    configExists = true;
    configMentionsNemotron = config.includes("NemotronHForCausalLM") || config.includes("nemotron_h");
  } catch {
    configExists = false;
  }
  const basename = resolved ? path.basename(resolved) : null;
  const unsafePaths = new Set([
    "/",
    "/mnt",
    "/mnt/large-storage",
    "/mnt/large-storage/models",
    process.env.HOME ?? "",
    process.cwd(),
  ]);
  const unsafePath = !resolved || unsafePaths.has(resolved);
  if (resolved !== NEMOTRON_LOCAL_PATH) diagnostics.push("DELETE_TARGET_REALPATH_MISMATCH");
  if (basename !== "nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8") diagnostics.push("DELETE_TARGET_BASENAME_MISMATCH");
  if (!isDirectory) diagnostics.push("DELETE_TARGET_NOT_DIRECTORY");
  if (!configExists) diagnostics.push("DELETE_TARGET_CONFIG_MISSING");
  if (!configMentionsNemotron) diagnostics.push("DELETE_TARGET_CONFIG_NOT_NEMOTRON");
  if (unsafePath) diagnostics.push("DELETE_TARGET_UNSAFE_PATH");
  return {
    requested_path: targetPath,
    realpath: resolved,
    basename,
    is_directory: isDirectory,
    config_exists: configExists,
    config_mentions_nemotron: configMentionsNemotron,
    unsafe_path: unsafePath,
    safe_to_delete: diagnostics.length === 0,
    diagnostics,
  };
}

export async function verifyMixtralArtifacts(modelPath = MIXTRAL_LOCAL_PATH): Promise<MixtralArtifactVerification> {
  const diagnostics: string[] = [];
  let entries: string[] = [];
  let exists = false;
  try {
    exists = (await stat(modelPath)).isDirectory();
    entries = await readdir(modelPath);
  } catch {
    exists = false;
  }
  let architecture: string | null = null;
  let modelType: string | null = null;
  const configExists = entries.includes("config.json");
  if (configExists) {
    try {
      const config = JSON.parse(await readFile(path.join(modelPath, "config.json"), "utf8")) as {
        architectures?: string[];
        model_type?: string;
      };
      architecture = config.architectures?.[0] ?? null;
      modelType = config.model_type ?? null;
    } catch (error) {
      diagnostics.push(error instanceof Error ? `MIXTRAL_CONFIG_PARSE_FAILED:${error.message}` : "MIXTRAL_CONFIG_PARSE_FAILED");
    }
  }
  const tokenizerFiles = entries.filter((entry) => entry.toLowerCase().includes("tokenizer") || entry === "special_tokens_map.json");
  const safetensorsFiles = entries.filter((entry) => entry.endsWith(".safetensors"));
  const indexFiles = entries.filter((entry) => entry.endsWith(".index.json"));
  const qwenFilesAdded = entries.some((entry) => entry.toLowerCase().includes("qwen"));
  if (!exists) diagnostics.push("MIXTRAL_PATH_MISSING");
  if (!configExists) diagnostics.push("MIXTRAL_CONFIG_MISSING");
  if (!architecture?.includes("Mixtral")) diagnostics.push("MIXTRAL_ARCHITECTURE_NOT_MIXTRAL");
  if (modelType !== "mixtral") diagnostics.push("MIXTRAL_MODEL_TYPE_NOT_MIXTRAL");
  if (tokenizerFiles.length === 0) diagnostics.push("MIXTRAL_TOKENIZER_FILES_MISSING");
  if (safetensorsFiles.length === 0 && indexFiles.length === 0) diagnostics.push("MIXTRAL_WEIGHT_OR_INDEX_FILES_MISSING");
  if (qwenFilesAdded) diagnostics.push("MIXTRAL_QWEN_FILES_FORBIDDEN");
  return {
    local_path: modelPath,
    exists,
    config_exists: configExists,
    tokenizer_files: tokenizerFiles,
    safetensors_files: safetensorsFiles,
    index_files: indexFiles,
    architecture,
    model_type: modelType,
    shard_count: safetensorsFiles.length,
    apparent_size: await duSummary(modelPath),
    qwen_files_added: qwenFilesAdded,
    status: diagnostics.length === 0 ? "passed" : "failed",
    diagnostics,
  };
}

export function proveAirLlmMixtralRoute(input: { architecture: string | null; autoModelSource: string }): AirLlmMixtralRouteProof {
  const source = input.autoModelSource;
  const expected = input.architecture?.includes("Mixtral") && source.includes("AirLLMMixtral") ? "AirLLMMixtral" : null;
  const fallbackToLlama2 = !!input.architecture && input.architecture.includes("Mixtral") && !expected && source.includes("try to use Llama2");
  const diagnostics = [
    expected ? null : "AIRLLM_MIXTRAL_ROUTE_NOT_PROVEN",
    fallbackToLlama2 ? "AIRLLM_MIXTRAL_FALLBACK_TO_LLAMA2" : null,
  ].filter((entry): entry is string => !!entry);
  return {
    architecture: input.architecture,
    expected_class: expected,
    fallback_to_llama2: fallbackToLlama2,
    status: diagnostics.length === 0 ? "passed" : "failed",
    diagnostics,
  };
}

export function buildColdSeniorRoleStatus(status: MixtralSeniorCandidateStatus, localPath = MIXTRAL_LOCAL_PATH): ColdSeniorRoleStatus {
  return {
    role: "console_cold_senior_reviewer",
    provider: "airllm-cold",
    model: MIXTRAL_REPO_ID,
    local_path: localPath,
    status,
    mode: "offline_review_job",
    writes: "none",
    fallback: "none",
    required_for_mainline: false,
    senior_promoted_to_routing: false,
  };
}

export async function deleteVerifiedNemotronPath(verification: NemotronDeleteVerification): Promise<"deleted_exact_verified_path" | "blocked_path_verification_failed"> {
  if (!verification.safe_to_delete || verification.realpath !== NEMOTRON_LOCAL_PATH) {
    return "blocked_path_verification_failed";
  }
  await rm(verification.realpath, { recursive: true, force: true });
  return "deleted_exact_verified_path";
}

export async function hashSmallFile(filePath: string): Promise<string | null> {
  try {
    const data = await readFile(filePath);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function command(commandName: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(commandName, args, { cwd, maxBuffer: 32 * 1024 * 1024 });
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

async function duSummary(targetPath: string): Promise<string | null> {
  const result = await command("du", ["-sh", targetPath], process.cwd());
  return result.exitCode === 0 ? result.stdout.trim() : null;
}
