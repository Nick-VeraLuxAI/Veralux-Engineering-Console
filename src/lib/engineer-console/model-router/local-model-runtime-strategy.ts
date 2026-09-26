/**
 * Declarative local model role split for VeraLux Engineering Console.
 * Source of truth: docs/source-of-truth/local-model-runtime-strategy.md
 *
 * This module records validated roles. It is not imported by the AE loop,
 * worker-route, or senior-model-coding-config getters. Do not use it to
 * auto-start DeepSeek or change live Nano defaults.
 * AE-facing named profiles: `ae-runtime-profiles.ts` (switchboard only).
 */

export const LOCAL_MODEL_RUNTIME_STRATEGY_ID = "local-model-runtime-strategy-v1" as const;

export const NANO_MODEL_ID = "Nemotron-Nano-30B-A3B-NVFP4" as const;

export const NANO_SHORT_WORKER = {
  roleId: "nano_short_implementation_worker",
  label: "short-context fast implementation worker",
  endpoint: "http://127.0.0.1:8081",
  openaiBaseUrl: "http://127.0.0.1:8081/v1",
  container: "nemotron-nano-vera-8081",
  model: NANO_MODEL_ID,
  maxModelLen: 8192,
  avgOutputTokPerSec: 278.82,
  medianOutputTokPerSec: 278.97,
  streamingTtftSeconds: 0.059,
} as const;

export const NANO_LONG_WORKER = {
  roleId: "nano_long_implementation_diagnostic_worker",
  label: "long-context implementation / diagnostic worker",
  endpoint: "http://127.0.0.1:8082",
  openaiBaseUrl: "http://127.0.0.1:8082/v1",
  container: "nemotron-nano-faithful-8082",
  model: NANO_MODEL_ID,
  maxModelLen: 262144,
  avgOutputTokPerSec: 279.83,
  medianOutputTokPerSec: 279.89,
  longPrefillPromptTokensPassed: 8116,
} as const;

export const DEEPSEEK_SENIOR = {
  roleId: "deepseek_v4_flash_ftw_senior_architect",
  label: "senior architect / reviewer / failed-run diagnostician",
  rawPath: "/mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731",
  ftwPath: "/mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731-ftw",
  host: "127.0.0.1",
  port: 1919,
  openaiBaseUrl: "http://127.0.0.1:1919/v1",
  servedModelName: "deepseek-v4-flash-ftw-tp1",
  tensorParallelSize: 1,
  gpu: 0,
  contextProven: 32768,
  longContextPromptTokensPassed: 27966,
  decodeTokPerSec: 26.6,
  onDemand: true,
  autoServe: false,
  concurrentWithNano: false,
} as const;

export const GLM_PARKED = {
  roleId: "glm_52_parked",
  status: "inactive_parked",
  rawPath: "/mnt/model-storage/models/nvidia_GLM-5.2-NVFP4",
  ftwPath: "/mnt/model-storage/models/nvidia_GLM-5.2-NVFP4-ftw",
  reason: "GLM FTW TP2 appears blocked; TP1 did not prove useful 20k+ context",
  deleteForbidden: true,
} as const;

export const TP2_ACTIVE = false;

export const NANO_RETUNE_NEEDED = false;

export const DEEPSEEK_GPU_CONSTRAINT = {
  nanoOccupiesBothGpus: true,
  deepseekUsesGpu0Tp1: true,
  concurrentServeSupported: false,
  note: "DeepSeek senior-model use is on-demand. Stop Nano on GPU 0 before serving FTW on 1919, then restore Nano.",
} as const;

export const VALIDATED_PROBE_PATHS = {
  deepseekFtwVerify: "/home/ndesantis/deepseek-v4-freetoken-ftw-verify/20260822T142628Z",
  nanoTpsBenchmark: "/home/ndesantis/nano-tps-benchmark/20260822T151925Z",
} as const;

export const ESCALATION_RULES = [
  "If Nano fails the same QC class twice, escalate to DeepSeek.",
  "If a repair loop reaches budget exhaustion, escalate to DeepSeek.",
  "If the task touches architecture, data contracts, auth, payments, orchestration, persistent state, or approval gates, use DeepSeek for planning or review.",
  "If the objective requires repo-wide judgment, use DeepSeek.",
  "If the task is a small bounded code edit, use Nano first.",
  "If context exceeds 8081 but does not require senior judgment, use Nano 8082.",
  "If context exceeds 32k and needs senior judgment, summarize/evidence-pack first, then send to DeepSeek.",
] as const;

/** Recommended operator env. Do not apply these as process defaults. */
export const RECOMMENDED_OPERATOR_ENV = {
  shortWorkerBaseUrl: NANO_SHORT_WORKER.openaiBaseUrl,
  longWorkerBaseUrl: NANO_LONG_WORKER.openaiBaseUrl,
  workerModel: NANO_MODEL_ID,
  seniorEnabledDefault: false,
  seniorBaseUrl: DEEPSEEK_SENIOR.openaiBaseUrl,
  seniorModel: DEEPSEEK_SENIOR.servedModelName,
} as const;

export function localModelRuntimeStrategySummary(): {
  id: typeof LOCAL_MODEL_RUNTIME_STRATEGY_ID;
  nanoShort: typeof NANO_SHORT_WORKER;
  nanoLong: typeof NANO_LONG_WORKER;
  senior: typeof DEEPSEEK_SENIOR;
  glm: typeof GLM_PARKED;
  tp2Active: typeof TP2_ACTIVE;
  deepseekOnDemand: true;
} {
  return {
    id: LOCAL_MODEL_RUNTIME_STRATEGY_ID,
    nanoShort: NANO_SHORT_WORKER,
    nanoLong: NANO_LONG_WORKER,
    senior: DEEPSEEK_SENIOR,
    glm: GLM_PARKED,
    tp2Active: TP2_ACTIVE,
    deepseekOnDemand: true,
  };
}
