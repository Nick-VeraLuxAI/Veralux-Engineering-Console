/** Canonical operator path for Nemotron Super weights (Phase 14/15 historical proofs). */
export const SUPER_CANONICAL_MODEL_PATH =
  "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8" as const;

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
