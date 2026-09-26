import fs from "node:fs";
import path from "node:path";
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

/**
 * DeepSeek-V4-Flash FTW launch profiles (FreeToken hybrid MoE: experts in host RAM,
 * attention/KV + an expert cache on GPU). All DeepSeek-specific tuning lives here.
 */
function deepseekFtwProfile(opts: {
  env: NodeJS.ProcessEnv;
  id: string;
  label: string;
  aliases: string[];
  role: string;
  port: number;
  gpus: number[];
  context: number;
  moeCacheSize: number;
  memoryRatio: string;
  vramMiB: number;
  gpuReserveMiB?: number;
  swaRatio?: string;
  longContextLauncher: boolean;
  notes: string;
}): CatalogModel {
  const { env } = opts;
  const ftVenv = env.ENGINEER_CONSOLE_FREETOKEN_VENV?.trim() || "/mnt/model-storage/venvs/freetoken-glm52";
  const cpuThreads = env.ENGINEER_CONSOLE_DEEPSEEK_CPU_THREADS?.trim() || "24";
  const launcher = path.join(
    env.ENGINEER_CONSOLE_REPO_DIR?.trim() || process.cwd(),
    "scripts/runtime/model-control/ft-serve-longctx.py",
  );
  const modelPath = `${MODELS_ROOT}/deepseek-ai_DeepSeek-V4-Flash-0731-ftw`;
  const serveArgs = [
    "serve",
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", String(opts.port),
    "--moe-backend", "hybrid",
    "--tensor-parallel-size", String(opts.gpus.length),
    // Served name kept as the existing senior-escalation contract expects.
    "--served-model-name", "deepseek-v4-flash-ftw-tp1",
    "--max-seq-len-override", String(opts.context),
    "--num-tokens", String(opts.context),
    // Fixed expert cache (not --moe-cache-auto) so VRAM use is deterministic.
    "--moe-cache-size", String(opts.moeCacheSize),
    "--memory-ratio", opts.memoryRatio,
    "--max-running-requests", "1",
    "--moe-cpu-threads", cpuThreads,
    "--decode-log-interval", "50",
  ];
  return {
    id: opts.id,
    label: opts.label,
    aliases: opts.aliases,
    kind: "managed",
    role: opts.role,
    baseUrl: `http://127.0.0.1:${opts.port}/v1`,
    upstreamModel: "deepseek-v4-flash-ftw-tp1",
    contextLength: opts.context,
    paths: [modelPath],
    protected: false,
    sharedWithReceptionist: false,
    resources: {
      gpuIndex: opts.gpus[0],
      gpuIndices: opts.gpus,
      vramMiB: opts.vramMiB,
      gpuReserveMiB: opts.gpuReserveMiB,
      hostRamGiB: 140,
    },
    launch: {
      runtime: "freetoken",
      // FreeToken answers /v1/models during weight loading; /health flips to "ok" when servable.
      readiness: { path: "/health", jsonField: "status", expect: "ok" },
      venv: ftVenv,
      envFile: `${ftVenv}/nccl.env`,
      command: opts.longContextLauncher ? "python" : "ft",
      args: opts.longContextLauncher ? [launcher, ...serveArgs] : serveArgs,
      cudaVisibleDevices: opts.gpus.join(","),
      env: opts.longContextLauncher
        ? {
          FT_SWA_FULL_TOKENS_RATIO: opts.swaRatio ?? "0.015",
          FT_INDEXER_MAX_ELEMS: env.ENGINEER_CONSOLE_DEEPSEEK_INDEXER_MAX_ELEMS?.trim() || "48000000",
        }
        : undefined,
      readyTimeoutSeconds: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_READY_TIMEOUT_S", 600),
    },
    notLoadableReason: null,
    notes: opts.notes,
  };
}

export function defaultCatalog(env: NodeJS.ProcessEnv = process.env): CatalogModel[] {
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
    deepseekFtwProfile({
      env,
      id: "deepseek-v4-flash",
      label: "DeepSeek-V4-Flash (FTW) — 1M context, single GPU 0 + CPU RAM",
      aliases: ["deepseek", "deepseek-v4-flash-1m", "deepseek-maxctx", "big"],
      role: "Big-context model and Hermes Agent brain. Needs GPU 0 essentially empty (Whisper/Kokoro stopped).",
      port: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_PORT", 1919),
      gpus: [envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_GPU", 0)],
      context: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_CONTEXT", 1048576),
      moeCacheSize: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_MOE_CACHE_SIZE", 512),
      memoryRatio: "0.95",
      vramMiB: 30720,
      gpuReserveMiB: 0,
      swaRatio: env.ENGINEER_CONSOLE_DEEPSEEK_SWA_RATIO?.trim() || "0.015",
      longContextLauncher: true,
      notes: "Native max 1,048,576 tokens (YaRN x16 over 64K). Full 1M KV allocated (8.77 GiB, SWA ratio 0.015). Measured TP1: ~31 s load, ~2.3K tok/s prefill, ~22 tok/s decode at 100K depth.",
    }),
    deepseekFtwProfile({
      env,
      id: "deepseek-v4-flash-tp2",
      label: "DeepSeek-V4-Flash (FTW) — 1M context, TP2 across both GPUs",
      aliases: ["deepseek-tp2"],
      role: "Same 1M context split over both GPUs. Kept for comparison: slower here (PCIe all-reduce, no NVLink; DSV4 KV is replicated per rank so TP2 adds no context).",
      port: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_TP2_PORT", 1921),
      gpus: [0, 1],
      context: 1048576,
      moeCacheSize: 512,
      memoryRatio: "0.95",
      vramMiB: 29000,
      gpuReserveMiB: 0,
      swaRatio: "0.015",
      longContextLauncher: true,
      notes: "Measured TP2: ~50 s load, ~340 tok/s prefill, ~3.6 tok/s decode at 100K depth.",
    }),
    deepseekFtwProfile({
      env,
      id: "deepseek-v4-flash-64k",
      label: "DeepSeek-V4-Flash (FTW) — 64K, single GPU 0 (coexists with Receptionist)",
      aliases: ["deepseek-64k", "deepseek-senior", "deepseek-v4-flash-gpu0"],
      role: "Big model on GPU 0 only, leaving GPU 1 to the Receptionist vLLM. On demand.",
      port: envInt(env, "ENGINEER_CONSOLE_DEEPSEEK_64K_PORT", 1920),
      gpus: [0],
      context: 65536,
      moeCacheSize: 512,
      memoryRatio: "0.8",
      vramMiB: 20480,
      longContextLauncher: false,
      notes: "Measured: ~38 s load, ~20-27 tok/s decode, ~19.6 GiB VRAM; keeps >=4 GiB free for Whisper/Kokoro.",
    }),
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
