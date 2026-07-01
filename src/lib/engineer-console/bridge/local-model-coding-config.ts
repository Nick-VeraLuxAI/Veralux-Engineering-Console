export type LocalModelCodingConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
  timeoutMs: number;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8081/v1";
const DEFAULT_TIMEOUT_MS = 120_000;

export function getLocalModelCodingConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocalModelCodingConfig {
  const enabled = env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED?.trim() === "true";
  const model = env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL?.trim()
    || env.VERALUX_MODEL_TIER_SENIOR_MODEL?.trim()
    || env.VERALUX_MODEL_TIER_FAST_MODEL?.trim()
    || "Nemotron-Nano-30B-A3B-NVFP4";
  return {
    enabled,
    baseUrl: env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL?.trim()
      || env.VERALUX_MODEL_TIER_SENIOR_URL?.trim()?.replace(/\/chat\/completions\/?$/, "")
      || env.VERALUX_MODEL_TIER_FAST_URL?.trim()?.replace(/\/chat\/completions\/?$/, "")
      || DEFAULT_BASE_URL,
    model,
    apiKey: env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_API_KEY?.trim()
      || env.VERALUX_MODEL_TIER_FAST_API_KEY?.trim()
      || null,
    timeoutMs: Number(env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}
