import { describe, expect, it, vi } from "vitest";
import type { HealthCheckProfileConfig } from "./deployment-health-check-types";
import {
  executeHttpHealthCheck,
  getHealthCheckHttpMethod,
  setHealthCheckFetchForTests,
} from "./execute-http-health-check";

const PROFILE: HealthCheckProfileConfig = {
  name: "method-test",
  environmentName: "staging",
  type: "http",
  url: "https://staging.example.com/api/health",
  expectedStatus: 200,
  allowed: true,
  timeoutMs: 1000,
};

describe("executeHttpHealthCheck HTTP method safety", () => {
  it("exposes GET as the only health check method", () => {
    expect(getHealthCheckHttpMethod()).toBe("GET");
  });

  it("always invokes fetch with GET and no custom headers", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    setHealthCheckFetchForTests(fetchMock);
    await executeHttpHealthCheck(PROFILE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.headers).toBeUndefined();
    setHealthCheckFetchForTests(null);
  });
});
