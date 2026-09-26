import fs from "node:fs";
import type { CatalogModel } from "./types";

/**
 * Default workstation model catalog. Values reuse the validated facts in
 * model-router/local-model-runtime-strategy.ts (DeepSeek FTW on 1919, GPU 0,
 * FreeToken hybrid MoE) with a GPU budget capped so GPU 0 keeps headroom for
 * the Receptionist's Whisper + Kokoro containers.
 *
 * Override/extend with ENGINEER_CONSOLE_MODEL_CATALOG_PATH (JSON array of
 * CatalogModel objects; entries with the same id replace defaults).
 */

const MODELS_ROOT = "/mnt/model-storage/models";

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function defaultCatalog(env: NodeJS.ProcessEnv = process.env): CatalogModel[] {
  const deepseekCtx = envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_CONTEXT", 65536);
  const deepseekMoeCache = envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_MOE_CACHE_SIZE", 512);
  const deepseekCpuThreads = envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_CPU_THREADS", 24);
  const deepseekPort = envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_PORT", 1919);
  const ftVenv = env.ENGINEER_CONSOLE_FREETOKEN_VENV?.trim() || "/mnt/model-storage/venvs/freetoken-glm52";

  return [
    {
      id: "receptionist-qwen",
      label: "Qwen3.5-27B GPTQ-Int4 (Receptionist vLLM :8082)",
      aliases: ["Qwen3.5-27B-GPTQ-Int4", "Nemotron-Nano-30B-A3B-NVFP4", "nano-faithful", "qwen-8082"],
      kind: "external",
      role: "Live Receptionist LLM (GPU 1). Shared: routed requests compete with live calls.",
      baseUrl: env.ENGINEER_CONSOLE_RECEPTIONIST_LLM_URL?.trim() || "http://127.0.0.1:8082/v1",
      upstreamModel: "Qwen3.5-27B-GPTQ-Int4",
      contextLength: 8192,
      paths: [`${MODELS_ROOT}/Qwen_Qwen3.5-27B-GPTQ-Int4`],
      protected: true,
      sharedWithReceptionist: true,
      resources: { gpuIndex: 1, vramMiB: 31700, hostRamGiB: 2 },
      launch: null,
      notLoadableReason: "Protected: owned by the live Receptionist (docker nemotron-nano-faithful-8082). The console never starts or stops it.",
      notes: "max-model-len 8192, max-num-seqs 1. Too small for Hermes Agent (needs >= 64K context).",
    },
    {
      id: "deepseek-v4-flash",
      label: "DeepSeek-V4-Flash (FTW, FreeToken hybrid MoE, GPU 0 + CPU RAM)",
      aliases: ["deepseek-v4-flash-ftw-tp1", "deepseek", "deepseek-senior", "big"],
      kind: "managed",
      role: "Big model: senior architect / reviewer and Hermes Agent brain. On demand.",
      baseUrl: `http://127.0.0.1:${deepseekPort}/v1`,
      upstreamModel: "deepseek-v4-flash-ftw-tp1",
      contextLength: deepseekCtx,
      paths: [`${MODELS_ROOT}/deepseek-ai_DeepSeek-V4-Flash-0731-ftw`],
      protected: false,
      sharedWithReceptionist: false,
      resources: {
        gpuIndex: 0,
        vramMiB: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_VRAM_MIB", 20480),
        hostRamGiB: 140,
      },
      launch: {
        runtime: "freetoken",
        // FreeToken answers /v1/models during weight loading; /health flips to "ok" when servable.
        readiness: { path: "/health", jsonField: "status", expect: "ok" },
        venv: ftVenv,
        envFile: `${ftVenv}/nccl.env`,
        command: "ft",
        args: [
          "serve",
          "--model", `${MODELS_ROOT}/deepseek-ai_DeepSeek-V4-Flash-0731-ftw`,
          "--host", "127.0.0.1",
          "--port", String(deepseekPort),
          "--moe-backend", "hybrid",
          "--tensor-parallel-size", "1",
          "--served-model-name", "deepseek-v4-flash-ftw-tp1",
          "--max-seq-len-override", String(deepseekCtx),
          "--num-tokens", String(deepseekCtx),
          // Fixed expert cache (512 x 13.4 MB) instead of --moe-cache-auto so VRAM
          // use is deterministic (~19.6 GiB) and GPU 0 keeps room for Whisper/Kokoro.
          "--moe-cache-size", String(deepseekMoeCache),
          "--memory-ratio", "0.8",
          "--max-running-requests", "1",
          "--max-prefill-length", "8192",
          "--moe-cpu-threads", String(deepseekCpuThreads),
          "--decode-log-interval", "50",
        ],
        cudaVisibleDevices: "0",
        readyTimeoutSeconds: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_READY_TIMEOUT_S", 600),
      },
      notLoadableReason: null,
      notes: "Measured on this workstation: ~37 s load, ~20-27 tok/s decode, 64K context.",
    },
    {
      id: "deepseek-v4-flash-raw",
      label: "DeepSeek-V4-Flash 0731 (raw HF weights)",
      aliases: [],
      kind: "on_disk",
      role: "Source weights for the FTW build above.",
      baseUrl: null,
      upstreamModel: null,
      contextLength: null,
      paths: [`${MODELS_ROOT}/deepseek-ai_DeepSeek-V4-Flash-0731`],
      protected: false,
      sharedWithReceptionist: false,
      resources: null,
      launch: null,
      notLoadableReason: "Use deepseek-v4-flash (FTW build of the same model) instead.",
      notes: null,
    },
    {
      id: "nemotron-3-super-120b-fp8",
      label: "NVIDIA Nemotron-3-Super-120B-A12B FP8",
      aliases: ["nemotron-super-fp8"],
      kind: "on_disk",
      role: "Big model on disk.",
      baseUrl: null,
      upstreamModel: null,
      contextLength: null,
      paths: [`${MODELS_ROOT}/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`],
      protected: false,
      sharedWithReceptionist: false,
      resources: null,
      launch: null,
      notLoadableReason: "120 GB of weights; no interactive runtime fits GPU 0 (~24 GB usable) without taking GPU 1 from the Receptionist.",
      notes: null,
    },
    {
      id: "nemotron-3-super-120b-nvfp4",
      label: "NVIDIA Nemotron-3-Super-120B-A12B NVFP4",
      aliases: ["nemotron-super-nvfp4", "nemotron-super"],
      kind: "on_disk",
      role: "Big model on disk.",
      baseUrl: null,
      upstreamModel: null,
      contextLength: null,
      paths: [
        `${MODELS_ROOT}/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4`,
        "/mnt/model-storage/airllm-split/super-nemotron-120b",
      ],
      protected: false,
      sharedWithReceptionist: false,
      resources: null,
      launch: null,
      notLoadableReason: "75 GB of weights exceeds GPU 0 alone; only the research AirLLM layer-streaming probe exists (not interactive). Needs GPU 1 or a CPU-offload runtime.",
      notes: null,
    },
    {
      id: "nemotron-nano-30b-nvfp4-archive",
      label: "Nemotron-Nano-30B-A3B NVFP4 (archived)",
      aliases: [],
      kind: "on_disk",
      role: "Archived.",
      baseUrl: null,
      upstreamModel: null,
      contextLength: null,
      paths: ["/mnt/model-storage/veralux-super-airllm-archive/20260725/models/nano-30b-a3b-nvfp4"],
      protected: false,
      sharedWithReceptionist: false,
      resources: null,
      launch: null,
      notLoadableReason: "Archived copy; not configured for serving.",
      notes: null,
    },
  ];
}

let cached: { key: string; models: CatalogModel[] } | null = null;

export function getCatalog(env: NodeJS.ProcessEnv = process.env): CatalogModel[] {
  const overridePath = env.ENGINEER_CONSOLE_MODEL_CATALOG_PATH?.trim() || "";
  let mtime = "";
  if (overridePath) {
    try {
      mtime = String(fs.statSync(overridePath).mtimeMs);
    } catch {
      mtime = "missing";
    }
  }
  const key = `${overridePath}:${mtime}`;
  if (cached && cached.key === key && env === process.env) return cached.models;

  const models = defaultCatalog(env);
  if (overridePath && mtime !== "missing") {
    try {
      const extra = JSON.parse(fs.readFileSync(overridePath, "utf8")) as CatalogModel[];
      for (const entry of extra) {
        const idx = models.findIndex((m) => m.id === entry.id);
        if (idx >= 0) models[idx] = entry;
        else models.push(entry);
      }
    } catch {
      // Ignore malformed override; defaults stay authoritative.
    }
  }
  if (env === process.env) cached = { key, models };
  return models;
}

export function getDefaultRouteModelId(env: NodeJS.ProcessEnv = process.env): string {
  return env.ENGINEER_CONSOLE_MODEL_DEFAULT?.trim() || "deepseek-v4-flash";
}

/** Resolve an id, alias or upstream name (case-insensitive) to a catalog entry. */
export function resolveCatalogModel(
  name: string | null | undefined,
  catalog: CatalogModel[] = getCatalog(),
  env: NodeJS.ProcessEnv = process.env,
): CatalogModel | null {
  const wanted = (name ?? "").trim();
  const target = !wanted || wanted === "default" || wanted === "auto" ? getDefaultRouteModelId(env) : wanted;
  const lower = target.toLowerCase();
  return (
    catalog.find((m) => m.id.toLowerCase() === lower) ??
    catalog.find((m) => m.aliases.some((a) => a.toLowerCase() === lower)) ??
    catalog.find((m) => (m.upstreamModel ?? "").toLowerCase() === lower) ??
    null
  );
}
