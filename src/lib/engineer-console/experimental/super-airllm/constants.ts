/** Historical NTFS download path — do not use for AirLLM shard reads or split materialize. */
export const SUPER_LEGACY_NTFS_MODEL_PATH =
  "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8" as const;

/** Ext4 runtime artifact mirror for AirLLM work (S3 closeout default). */
export const SUPER_AIRLLM_DEFAULT_MODEL_PATH =
  "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8" as const;

/** Env var override for Super model path used by AirLLM runtime scripts. */
export const SUPER_AIRLLM_MODEL_PATH_ENV_VAR = "ENGINEER_CONSOLE_SUPER_MODEL_PATH" as const;

/** Default model path for AirLLM runtime scripts (ext4 mirror). */
export const SUPER_CANONICAL_MODEL_PATH = SUPER_AIRLLM_DEFAULT_MODEL_PATH;

export const SUPER_EXPECTED_MODEL_NAME = "Nemotron-Super-120B-A12B-FP8" as const;

export const SUPER_AIRLLM_DEFAULT_RUNTIME = ".venv-airllm/bin/python" as const;

export const NEMOTRONH_ARCHITECTURE = "NemotronHForCausalLM" as const;

export const NEMOTRONH_LAYER_PREFIXES = {
  embed: "backbone.embeddings",
  layerPrefix: "backbone.layers",
  norm: "backbone.norm_f",
  lmHead: "lm_head",
} as const;

/** Evidence status when canonical Super artifacts are absent (S0: no crash). */
export const SUPER_ARTIFACT_MISSING = "artifact_missing" as const;

/** Gate verdict when proofs must not proceed without weights. */
export const SUPER_BLOCKED_MISSING_ARTIFACT = "blocked_missing_artifact" as const;

/** S0 repair phase: static/audit proofs only; no model load, GPU, or HTTP serving. */
export const SUPER_AIRLLM_REPAIR_PHASE_S0 = "super_airllm_repair_s0" as const;

/** Env var for ext4 AirLLM split/cache output (S2+). */
export const SUPER_AIRLLM_SPLIT_CACHE_ENV_VAR = "ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR" as const;

export function readSuperModelPathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env[SUPER_AIRLLM_MODEL_PATH_ENV_VAR]?.trim() || SUPER_AIRLLM_DEFAULT_MODEL_PATH;
}

/** Legacy S2 default (ext4 via /home but insufficient free space for Super splits). */
export const SUPER_AIRLLM_LEGACY_SPLIT_CACHE_DIR =
  "/home/ndesantis/vera-workspace/super-airllm-splits" as const;

/** Recommended ext4 split/cache path when env var is unset (S3+). */
export const SUPER_AIRLLM_DEFAULT_SPLIT_CACHE_DIR =
  "/mnt/model-storage/airllm-split/super-nemotron-120b" as const;

/** Minimum comfortable free GiB before L4 split materialization. */
export const SUPER_AIRLLM_MIN_SPLIT_FREE_GIB = 160 as const;

/** Blocked filesystem types for AirLLM split materialization. */
export const SUPER_AIRLLM_BLOCKED_SPLIT_FS_TYPES = [
  "ntfs",
  "ntfs3",
  "fuseblk",
  "exfat",
  "vfat",
  "msdos",
  "cifs",
  "smb3",
] as const;
