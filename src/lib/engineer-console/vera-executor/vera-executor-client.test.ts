import { describe, expect, it } from "vitest";
import { VeraExecutorClient, VeraExecutorClientError, type VeraFetchFn } from "./vera-executor-client";

const config = {
  baseUrl: "http://127.0.0.1:8642",
  apiKey: "test-secret",
  defaultModel: "qwen-test",
  escalationModel: null,
  requestTimeoutMs: 1000,
  runTimeoutMs: 1000,
  noProgressTimeoutMs: 50,
  pollIntervalMs: 1,
  maxTransportRetries: 0,
};

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("VeraExecutorClient", () => {
  it("submits authenticated runs and polls terminal status", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: VeraFetchFn = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/runs")) return response({ run_id: "run_fake", status: "started" });
      return response({
        run_id: "run_fake",
        status: "completed",
        model: "qwen-test",
        output: "done",
        usage: { total_tokens: 12 },
        last_event: "run.completed",
      });
    };
    const client = new VeraExecutorClient(config, fetchFn);
    const submitted = await client.submitRun({ input: "hello" });
    const result = await client.pollRun(submitted.run_id);
    expect(submitted.run_id).toBe("run_fake");
    expect(result.status.status).toBe("completed");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer test-secret" });
  });

  it("classifies authentication failures without leaking bearer values", async () => {
    const fetchFn: VeraFetchFn = async () =>
      response({ error: { message: "bad Bearer test-secret" } }, { status: 401 });
    const client = new VeraExecutorClient(config, fetchFn);
    await expect(client.submitRun({ input: "hello" })).rejects.toMatchObject({
      failure: {
        category: "authentication",
        retryable: false,
      },
    });
    await client.submitRun({ input: "hello" }).catch((error) => {
      expect(error).toBeInstanceOf(VeraExecutorClientError);
      expect(String(error.message)).not.toContain("test-secret");
    });
  });

  it("cancels a run when polling sees no progress", async () => {
    const calls: string[] = [];
    const fetchFn: VeraFetchFn = async (url) => {
      const rendered = String(url);
      calls.push(rendered);
      if (rendered.endsWith("/stop")) return response({ run_id: "run_stale", status: "stopping" });
      return response({
        run_id: "run_stale",
        status: "running",
        updated_at: 1,
        last_event: "tool.completed",
      });
    };
    const client = new VeraExecutorClient(config, fetchFn);
    await expect(client.pollRun("run_stale")).rejects.toMatchObject({
      failure: { code: "VERA_RUN_NO_PROGRESS_TIMEOUT" },
    });
    expect(calls.some((call) => call.endsWith("/v1/runs/run_stale/stop"))).toBe(true);
  });
});
