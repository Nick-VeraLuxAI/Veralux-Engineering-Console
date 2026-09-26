import { normalizeLocalModelCodingBaseUrl } from "../bridge/local-model-coding-config";
import type { SeniorEndpointHealth } from "./invoke-types";

async function probe(
  fetchFn: typeof fetch,
  url: string,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const response = await fetchFn(url, { method: "GET" });
    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "health check failed",
    };
  }
}

export async function checkSeniorEndpointAvailable(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<SeniorEndpointHealth> {
  const normalized = normalizeLocalModelCodingBaseUrl(baseUrl);
  const modelsUrl = `${normalized}/models`;
  const models = await probe(fetchFn, modelsUrl);
  if (models.ok) {
    return { available: true, checkedUrl: modelsUrl, statusCode: models.status, error: null };
  }

  try {
    const healthUrl = `${new URL(normalized).origin}/health`;
    const health = await probe(fetchFn, healthUrl);
    if (health.ok) {
      return { available: true, checkedUrl: healthUrl, statusCode: health.status, error: null };
    }
    return {
      available: false,
      checkedUrl: modelsUrl,
      statusCode: health.status ?? models.status,
      error: health.error ?? models.error,
    };
  } catch {
    return {
      available: false,
      checkedUrl: modelsUrl,
      statusCode: models.status,
      error: models.error,
    };
  }
}
