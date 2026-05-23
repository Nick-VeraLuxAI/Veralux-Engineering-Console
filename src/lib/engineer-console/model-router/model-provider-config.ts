export type EngineerConsoleModelProvider = "mock" | "kimi";

export interface ModelProviderConfig {
  provider: EngineerConsoleModelProvider;
  kimiApiKey: string | null;
  kimiBaseUrl: string;
  kimiModel: string;
  requestTimeoutMs: number;
}

export class ModelProviderConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelProviderConfigError";
    this.code = code;
  }
}

const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/v1";
const DEFAULT_KIMI_MODEL = "kimi-k2-0711-preview";
const DEFAULT_TIMEOUT_MS = 120_000;

function parseProvider(value: string | undefined): EngineerConsoleModelProvider {
  if (!value || value === "mock") return "mock";
  if (value === "kimi") return "kimi";
  throw new ModelProviderConfigError(
    "UNKNOWN_PROVIDER",
    `Unknown ENGINEER_CONSOLE_MODEL_PROVIDER: ${value}. Use "mock" or "kimi".`,
  );
}

export function getModelProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelProviderConfig {
  const provider = parseProvider(env.ENGINEER_CONSOLE_MODEL_PROVIDER);
  const kimiApiKey = env.KIMI_API_KEY?.trim() || null;

  return {
    provider,
    kimiApiKey,
    kimiBaseUrl: env.KIMI_BASE_URL?.trim() || DEFAULT_KIMI_BASE_URL,
    kimiModel: env.KIMI_MODEL?.trim() || DEFAULT_KIMI_MODEL,
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function validateModelProviderConfig(
  config: ModelProviderConfig = getModelProviderConfig(),
): void {
  if (config.provider === "kimi" && !config.kimiApiKey) {
    throw new ModelProviderConfigError(
      "KIMI_API_KEY_MISSING",
      "KIMI_API_KEY is required when ENGINEER_CONSOLE_MODEL_PROVIDER=kimi",
    );
  }
}

export function getPublicModelProviderInfo(
  config: ModelProviderConfig = getModelProviderConfig(),
): {
  provider: EngineerConsoleModelProvider;
  model: string;
  providerStatus: "ready" | "misconfigured";
  statusMessage: string | null;
} {
  try {
    validateModelProviderConfig(config);
    return {
      provider: config.provider,
      model: config.provider === "kimi" ? config.kimiModel : "mock-worker-plan-v1",
      providerStatus: "ready",
      statusMessage: null,
    };
  } catch (error) {
    if (error instanceof ModelProviderConfigError) {
      return {
        provider: config.provider,
        model: config.provider === "kimi" ? config.kimiModel : "mock-worker-plan-v1",
        providerStatus: "misconfigured",
        statusMessage: error.message,
      };
    }
    throw error;
  }
}
