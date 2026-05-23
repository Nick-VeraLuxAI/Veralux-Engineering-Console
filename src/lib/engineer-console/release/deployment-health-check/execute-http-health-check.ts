import type { HealthCheckProfileConfig } from "./deployment-health-check-types";
import type { HttpHealthCheckExecResult } from "./deployment-health-check-types";

export type HealthCheckFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

let fetchOverride: HealthCheckFetchFn | null = null;

export function setHealthCheckFetchForTests(fetchFn: HealthCheckFetchFn | null): void {
  fetchOverride = fetchFn;
}

const MAX_BODY_BYTES = 4096;

export async function executeHttpHealthCheck(
  profile: HealthCheckProfileConfig,
): Promise<HttpHealthCheckExecResult> {
  const fetchFn = fetchOverride ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = profile.timeoutMs ?? 10_000;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(profile.url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await response.text();
    const bodySnippet =
      body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) : body;
    return {
      responseStatus: response.status,
      responseTimeMs: Date.now() - start,
      bodySnippet,
      errorMessage: null,
      timedOut: false,
    };
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"));
    return {
      responseStatus: null,
      responseTimeMs: Date.now() - start,
      bodySnippet: "",
      errorMessage: timedOut
        ? "Health check timed out."
        : error instanceof Error
          ? error.message
          : String(error),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}
