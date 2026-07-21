/** Loopback-only S13 HTTP client. Never allocates CUDA or stops Nano. */

import {
  S14_DEFAULT_S13_BASE_URL,
  type S13GenerationStatus,
  type S13Health,
  type S13Readiness,
} from "./types";

export class S13ClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "S13ClientError";
  }
}

export function assertLoopbackS13BaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new S13ClientError(`invalid_s13_base_url:${baseUrl}`, "senior_non_loopback_url_rejected");
  }
  if (parsed.username || parsed.password) {
    throw new S13ClientError("s13_url_contains_credentials", "senior_non_loopback_url_rejected");
  }
  const host = parsed.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new S13ClientError(`non_loopback_s13_url:${host}`, "senior_non_loopback_url_rejected");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new S13ClientError(`unsupported_s13_protocol:${parsed.protocol}`, "senior_non_loopback_url_rejected");
  }
  return parsed.origin;
}

export type S13ClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  connectTimeoutMs?: number;
};

export class S13LocalClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly connectTimeoutMs: number;

  constructor(options: S13ClientOptions = {}) {
    this.baseUrl = assertLoopbackS13BaseUrl(options.baseUrl ?? S14_DEFAULT_S13_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.connectTimeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text };
      }
      if (!res.ok) {
        const errMsg =
          typeof parsed === "object" && parsed && "error" in parsed
            ? String((parsed as { error: unknown }).error)
            : `http_${res.status}`;
        throw new S13ClientError(errMsg, "s13_http_error", res.status, parsed);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof S13ClientError) throw error;
      const name = error instanceof Error ? error.name : "Error";
      const msg = error instanceof Error ? error.message : String(error);
      throw new S13ClientError(`${name}:${msg}`, "senior_service_unavailable_before_submission");
    } finally {
      clearTimeout(timer);
    }
  }

  health(timeoutMs?: number): Promise<S13Health> {
    return this.request<S13Health>("GET", "/v1/health", undefined, timeoutMs);
  }

  readiness(timeoutMs?: number): Promise<S13Readiness> {
    return this.request<S13Readiness>("GET", "/v1/readiness", undefined, timeoutMs);
  }

  runtime(timeoutMs?: number): Promise<Record<string, unknown>> {
    return this.request("GET", "/v1/runtime", undefined, timeoutMs);
  }

  submitGeneration(input: {
    prompt: string;
    maxNewTokens: number;
    generationPolicy?: "greedy";
    requestKey?: string;
    stopTokenIds?: number[];
    stopOnEos?: boolean;
  }): Promise<{
    requestId: string;
    state?: string;
    idempotentReplay?: boolean;
    requestedMaxNewTokens?: number;
    expectedFullModelPasses?: number;
    generationStrategy?: string;
    serializedExecution?: boolean;
  }> {
    return this.request("POST", "/v1/generations", {
      prompt: input.prompt,
      maxNewTokens: input.maxNewTokens,
      generationPolicy: input.generationPolicy ?? "greedy",
      requestKey: input.requestKey,
      stopTokenIds: input.stopTokenIds,
      stopOnEos: input.stopOnEos,
    });
  }

  getGeneration(requestId: string, timeoutMs?: number): Promise<S13GenerationStatus> {
    return this.request("GET", `/v1/generations/${encodeURIComponent(requestId)}`, undefined, timeoutMs);
  }

  cancelGeneration(requestId: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/v1/generations/${encodeURIComponent(requestId)}/cancel`, {});
  }

  resumeGeneration(requestId: string): Promise<Record<string, unknown>> {
    return this.request("POST", `/v1/generations/${encodeURIComponent(requestId)}/resume`, {});
  }
}
