export interface VeraExecutorConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string | null;
  escalationModel: string | null;
  requestTimeoutMs: number;
  runTimeoutMs: number;
  noProgressTimeoutMs: number;
  pollIntervalMs: number;
  maxTransportRetries: number;
}

export class VeraExecutorConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VeraExecutorConfigError";
    this.code = code;
  }
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new VeraExecutorConfigError("INVALID_CONFIG", `${key} must be a positive integer.`);
  }
  return parsed;
}

export function getVeraExecutorConfig(env: NodeJS.ProcessEnv = process.env): VeraExecutorConfig {
  return {
    baseUrl: (env.VERA_API_BASE_URL?.trim() || "http://127.0.0.1:8642").replace(/\/+$/, ""),
    apiKey: env.VERA_API_KEY?.trim() || env.API_SERVER_KEY?.trim() || "",
    defaultModel: env.VERA_DEFAULT_MODEL?.trim() || null,
    escalationModel: env.VERA_ESCALATION_MODEL?.trim() || null,
    requestTimeoutMs: intEnv(env, "VERA_REQUEST_TIMEOUT_MS", 30_000),
    runTimeoutMs: intEnv(env, "VERA_RUN_TIMEOUT_MS", 30 * 60_000),
    noProgressTimeoutMs: intEnv(env, "VERA_NO_PROGRESS_TIMEOUT_MS", 10 * 60_000),
    pollIntervalMs: intEnv(env, "VERA_POLL_INTERVAL_MS", 2_000),
    maxTransportRetries: intEnv(env, "VERA_TRANSPORT_RETRIES", 2),
  };
}

export function validateVeraExecutorConfig(config: VeraExecutorConfig = getVeraExecutorConfig()): void {
  if (!config.apiKey) {
    throw new VeraExecutorConfigError(
      "VERA_API_KEY_MISSING",
      "VERA_API_KEY is required for live Vera execution. Set VERA_API_KEY to the local Vera API server key.",
    );
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?($|\/)/.test(config.baseUrl)) {
    throw new VeraExecutorConfigError(
      "VERA_API_BASE_URL_UNSAFE",
      "VERA_API_BASE_URL must point at localhost for governed local execution.",
    );
  }
}

export function redactVeraSecret(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}
