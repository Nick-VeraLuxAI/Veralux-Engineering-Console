import {
  getLocalModelCodingConfig,
  normalizeLocalModelCodingBaseUrl,
  type LocalModelCodingConfig,
} from "./local-model-coding-config";

export type SeniorModelCodingConfig = LocalModelCodingConfig & {
  maxRepairAttempts: number;
};

const DEFAULT_SENIOR_BASE_URL = "http://127.0.0.1:8080/v1";
const DEFAULT_SENIOR_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

export const SENIOR_MODEL_CODING_MAX_REPAIR_ATTEMPTS_ENV =
  "ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MAX_REPAIR_ATTEMPTS" as const;

function resolveMaxRepairAttempts(env: NodeJS.ProcessEnv): number {
  const raw = env[SENIOR_MODEL_CODING_MAX_REPAIR_ATTEMPTS_ENV]?.trim();
  if (!raw) return DEFAULT_MAX_REPAIR_ATTEMPTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : DEFAULT_MAX_REPAIR_ATTEMPTS;
}

export function getSeniorModelCodingConfig(
  env: NodeJS.ProcessEnv = process.env,
): SeniorModelCodingConfig {
  const enabled = env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED?.trim() === "true";
  const model = env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL?.trim() || null;
  const rawBaseUrl = env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL?.trim() || DEFAULT_SENIOR_BASE_URL;
  return {
    enabled,
    baseUrl: normalizeLocalModelCodingBaseUrl(rawBaseUrl),
    model,
    apiKey: env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_API_KEY?.trim() || null,
    timeoutMs: Number(env.ENGINEER_CONSOLE_SENIOR_MODEL_CODING_TIMEOUT_MS ?? DEFAULT_SENIOR_TIMEOUT_MS),
    maxRepairAttempts: resolveMaxRepairAttempts(env),
  };
}

export function seniorModelConfigCollidesWithLocalWorker(
  senior: SeniorModelCodingConfig,
  local: LocalModelCodingConfig = getLocalModelCodingConfig(),
): boolean {
  if (!senior.model || !local.model) return false;
  return normalizeLocalModelCodingBaseUrl(senior.baseUrl) === normalizeLocalModelCodingBaseUrl(local.baseUrl)
    && senior.model === local.model;
}
