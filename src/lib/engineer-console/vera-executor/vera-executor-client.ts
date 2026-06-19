import {
  getVeraExecutorConfig,
  redactVeraSecret,
  validateVeraExecutorConfig,
  type VeraExecutorConfig,
} from "./vera-executor-config";
import type {
  VeraCancellationResult,
  VeraExecutionFailure,
  VeraRunEvent,
  VeraRunStatus,
  VeraRunSubmissionResponse,
} from "./vera-execution-types";

export type VeraFetchFn = typeof fetch;

export class VeraExecutorClientError extends Error {
  readonly failure: VeraExecutionFailure;
  readonly statusCode: number | null;

  constructor(failure: VeraExecutionFailure, statusCode: number | null = null) {
    super(failure.message);
    this.name = "VeraExecutorClientError";
    this.failure = failure;
    this.statusCode = statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
  return Date.now();
}

function classifyHttp(status: number, message: string): VeraExecutionFailure {
  if (status === 401 || status === 403) {
    return { code: "VERA_AUTH_FAILED", category: "authentication", message, retryable: false };
  }
  if (status === 404) {
    return { code: "VERA_RUN_NOT_FOUND", category: "runtime", message, retryable: false };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { code: "VERA_TRANSIENT_HTTP_FAILURE", category: "transport", message, retryable: true };
  }
  return { code: "VERA_HTTP_FAILURE", category: "runtime", message, retryable: false };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactVeraSecret(message);
}

async function withTimeout<T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new VeraExecutorClientError({
        code: "VERA_REQUEST_TIMEOUT",
        category: "timeout",
        message: `Vera request timed out after ${timeoutMs}ms.`,
        retryable: true,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class VeraExecutorClient {
  private readonly config: VeraExecutorConfig;
  private readonly fetchFn: VeraFetchFn;

  constructor(config: VeraExecutorConfig = getVeraExecutorConfig(), fetchFn: VeraFetchFn = fetch) {
    validateVeraExecutorConfig(config);
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async health(): Promise<Record<string, unknown>> {
    return this.requestJson<Record<string, unknown>>("GET", "/health");
  }

  async submitRun(body: Record<string, unknown>): Promise<VeraRunSubmissionResponse> {
    return this.requestJson<VeraRunSubmissionResponse>("POST", "/v1/runs", body);
  }

  async getRunStatus(externalRunId: string): Promise<VeraRunStatus> {
    return this.requestJson<VeraRunStatus>("GET", `/v1/runs/${encodeURIComponent(externalRunId)}`);
  }

  async cancelRun(externalRunId: string): Promise<VeraCancellationResult> {
    return this.requestJson<VeraCancellationResult>(
      "POST",
      `/v1/runs/${encodeURIComponent(externalRunId)}/stop`,
      {},
    );
  }

  async pollRun(externalRunId: string): Promise<{ status: VeraRunStatus; events: VeraRunEvent[] }> {
    const started = nowMs();
    const events: VeraRunEvent[] = [];
    let lastEvent: string | null = null;
    let lastProgressAt = started;
    let lastUpdatedAt: number | null = null;

    while (nowMs() - started <= this.config.runTimeoutMs) {
      const status = await this.getRunStatus(externalRunId);
      if (typeof status.updated_at === "number" && status.updated_at !== lastUpdatedAt) {
        lastUpdatedAt = status.updated_at;
        lastProgressAt = nowMs();
      }
      if (status.last_event && status.last_event !== lastEvent) {
        lastEvent = status.last_event;
        lastProgressAt = nowMs();
        events.push({
          event: status.last_event,
          run_id: status.run_id,
          timestamp: status.updated_at,
          output: status.output ?? undefined,
          usage: status.usage ?? undefined,
          error: status.error ?? undefined,
        });
      }
      if (["completed", "failed", "cancelled"].includes(status.status)) {
        return { status, events };
      }
      if (nowMs() - lastProgressAt > this.config.noProgressTimeoutMs) {
        await this.cancelRunBestEffort(externalRunId);
        throw new VeraExecutorClientError({
          code: "VERA_RUN_NO_PROGRESS_TIMEOUT",
          category: "timeout",
          message: `Vera run ${externalRunId} made no status progress for ${this.config.noProgressTimeoutMs}ms.`,
          retryable: true,
        });
      }
      await sleep(this.config.pollIntervalMs);
    }

    await this.cancelRunBestEffort(externalRunId);
    throw new VeraExecutorClientError({
      code: "VERA_RUN_TIMEOUT",
      category: "timeout",
      message: `Vera run ${externalRunId} did not finish within ${this.config.runTimeoutMs}ms.`,
      retryable: true,
    });
  }

  private async cancelRunBestEffort(externalRunId: string): Promise<void> {
    try {
      await this.cancelRun(externalRunId);
    } catch {
      // Preserve the original timeout/no-progress failure.
    }
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.config.maxTransportRetries; attempt++) {
      try {
        return await withTimeout(this.config.requestTimeoutMs, async (signal) => {
          const response = await this.fetchFn(`${this.config.baseUrl}${path}`, {
            method,
            signal,
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const text = await response.text();
          let parsed: unknown = null;
          if (text.trim()) {
            try {
              parsed = JSON.parse(text);
            } catch {
              throw new VeraExecutorClientError({
                code: "VERA_MALFORMED_RESPONSE",
                category: "runtime",
                message: `Vera returned non-JSON response for ${method} ${path}.`,
                retryable: false,
              }, response.status);
            }
          }
          if (!response.ok) {
            const message =
              typeof parsed === "object" && parsed && "error" in parsed
                ? JSON.stringify((parsed as { error: unknown }).error)
                : text;
            throw new VeraExecutorClientError(
              classifyHttp(response.status, redactVeraSecret(`Vera API error ${response.status}: ${message}`)),
              response.status,
            );
          }
          return parsed as T;
        });
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof VeraExecutorClientError ? error.failure.retryable : true;
        if (!retryable || attempt >= this.config.maxTransportRetries) break;
        await sleep(250 * (attempt + 1));
      }
    }

    if (lastError instanceof VeraExecutorClientError) throw lastError;
    throw new VeraExecutorClientError({
      code: "VERA_TRANSPORT_FAILURE",
      category: "transport",
      message: `Unable to reach Vera API: ${errorMessage(lastError)}`,
      retryable: true,
    });
  }
}
