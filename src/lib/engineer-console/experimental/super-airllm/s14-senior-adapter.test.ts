/**
 * S14 gated senior adapter unit tests.
 * No real Nano stop; S13 HTTP is mocked.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  assertLoopbackS13BaseUrl,
  assertNoDefaultInvariants,
  assertOrdinaryRequestDoesNotInvokeSenior,
  assertWorkerIdentityPreserved,
  createSeniorAdapter,
  createSeniorApprovalArtifact,
  evaluateSeniorFallback,
  evaluateSeniorRouteDecision,
  GATED_SENIOR_REGISTRY_AFTER,
  GATED_SENIOR_REGISTRY_BEFORE,
  mapS13StateToSenior,
  S13LocalClient,
  S14_RUNTIME_ID,
  validateSeniorApproval,
} from "./s14-senior-adapter";

function tempStore(): string {
  return mkdtempSync(path.join(tmpdir(), "s14-corr-"));
}

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [key, handler] of Object.entries(handlers)) {
      if (url.includes(key)) return handler(init);
    }
    return new Response(JSON.stringify({ error: "not_mocked" }), { status: 500 });
  }) as unknown as typeof fetch;
}

describe("S14 loopback URL policy", () => {
  it("accepts loopback S13 URL", () => {
    expect(assertLoopbackS13BaseUrl("http://127.0.0.1:8091")).toBe("http://127.0.0.1:8091");
  });
  it("rejects non-loopback S13 URL", () => {
    expect(() => assertLoopbackS13BaseUrl("http://10.0.0.2:8091")).toThrow(/non_loopback/);
  });
  it("rejects credentialed URLs", () => {
    expect(() => assertLoopbackS13BaseUrl("http://user:pass@127.0.0.1:8091")).toThrow(/credentials/);
  });
});

describe("S14 approval gate", () => {
  it("blocks missing approval", () => {
    const req = {
      veraRequestId: "v1",
      prompt: "Hello",
      maxNewTokens: 1 as const,
      approvalReference: "a1",
      idempotencyKey: "k1",
      requestedAt: new Date().toISOString(),
      seniorRequested: true,
    };
    const v = validateSeniorApproval(req, null);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("senior_execution_approval_missing");
  });

  it("blocks mismatched request id", () => {
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "v1", maxNewTokens: 1 });
    const req = {
      veraRequestId: "v2",
      prompt: "Hello",
      maxNewTokens: 1 as const,
      approvalReference: artifact.approvalReference,
      idempotencyKey: "k1",
      requestedAt: new Date().toISOString(),
      seniorRequested: true,
    };
    const v = validateSeniorApproval(req, artifact);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("senior_execution_approval_mismatch");
  });

  it("blocks expired approval", () => {
    const artifact = createSeniorApprovalArtifact({
      veraRequestId: "v1",
      maxNewTokens: 1,
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    const req = {
      veraRequestId: "v1",
      prompt: "Hello",
      maxNewTokens: 1 as const,
      approvalReference: artifact.approvalReference,
      idempotencyKey: "k1",
      requestedAt: new Date().toISOString(),
      seniorRequested: true,
    };
    const v = validateSeniorApproval(req, artifact);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("senior_execution_approval_expired");
  });

  it("blocks token scope expansion", () => {
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "v1", maxNewTokens: 1 });
    const req = {
      veraRequestId: "v1",
      prompt: "Hello",
      maxNewTokens: 2 as const,
      approvalReference: artifact.approvalReference,
      idempotencyKey: "k1",
      requestedAt: new Date().toISOString(),
      seniorRequested: true,
    };
    const v = validateSeniorApproval(req, artifact);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("senior_execution_approval_scope_mismatch");
  });

  it("accepts matching approval", () => {
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "v1", maxNewTokens: 2 });
    const req = {
      veraRequestId: "v1",
      prompt: "Hello",
      maxNewTokens: 1 as const,
      approvalReference: artifact.approvalReference,
      idempotencyKey: "k1",
      requestedAt: new Date().toISOString(),
      seniorRequested: true,
    };
    expect(validateSeniorApproval(req, artifact).ok).toBe(true);
  });
});

describe("S14 route gate", () => {
  it("blocks when senior not requested", () => {
    const d = evaluateSeniorRouteDecision({
      request: {
        veraRequestId: "v1",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "a",
        idempotencyKey: "k",
        requestedAt: new Date().toISOString(),
        seniorRequested: false,
      },
      approval: null,
    });
    expect(d.reason).toBe("senior_execution_not_requested");
    expect(d.approved).toBe(false);
  });

  it("senior designation alone is insufficient", () => {
    const d = evaluateSeniorRouteDecision({
      request: {
        veraRequestId: "v1",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "a",
        idempotencyKey: "k",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      approval: null,
    });
    expect(d.eligible).toBe(true);
    expect(d.approved).toBe(false);
    expect(d.reason).toBe("senior_execution_approval_missing");
  });
});

describe("S14 state map + fallback", () => {
  it("maps S13 states", () => {
    expect(mapS13StateToSenior("streaming_layers")).toBe("senior_executing");
    expect(mapS13StateToSenior("restoring_nano")).toBe("senior_operational_cleanup");
    expect(mapS13StateToSenior("recovery_required")).toBe("senior_recovery_required");
  });

  it("disables fallback by default", () => {
    const d = evaluateSeniorFallback({
      record: { allowFallback: false, s13RequestId: null, result: null, state: "senior_failed" },
      failureCode: "senior_service_unavailable_before_submission",
    });
    expect(d.allowed).toBe(false);
  });

  it("blocks fallback after submission", () => {
    const d = evaluateSeniorFallback({
      record: { allowFallback: true, s13RequestId: "s13-1", result: null, state: "senior_executing" },
      failureCode: "senior_service_unavailable_before_submission",
    });
    expect(d.allowed).toBe(false);
  });

  it("preserves worker identity", () => {
    expect(() =>
      assertWorkerIdentityPreserved({ claimedModel: "Nemotron-Super", actualWorker: "nano" }),
    ).toThrow(/disguise/);
  });
});

describe("S14 registry invariants", () => {
  it("before/after keep no-default facts", () => {
    assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_BEFORE);
    assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);
    expect(GATED_SENIOR_REGISTRY_AFTER.health_state).toBe("gated_available");
    expect(GATED_SENIOR_REGISTRY_AFTER.model_id).toBe(S14_RUNTIME_ID);
  });
});

describe("S14 runner with mocked S13", () => {
  it("ordinary request path does not submit to S13", async () => {
    const fetchImpl = mockFetch({});
    const { runner } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl,
      sleep: async () => undefined,
    });
    const record = await runner.run(
      {
        veraRequestId: "ordinary-1",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "",
        idempotencyKey: "ord-1",
        requestedAt: new Date().toISOString(),
        seniorRequested: false,
      },
      null,
    );
    expect(record.s13RequestId).toBeNull();
    expect(record.state).toBe("senior_decision_blocked");
    assertOrdinaryRequestDoesNotInvokeSenior({ seniorRequested: false, s13Submitted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("unapproved senior request never calls S13", async () => {
    const fetchImpl = mockFetch({});
    const { runner } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl,
      sleep: async () => undefined,
    });
    const record = await runner.run(
      {
        veraRequestId: "unapproved-1",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "missing",
        idempotencyKey: "u-1",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      null,
    );
    expect(record.s13RequestId).toBeNull();
    expect(record.error?.code).toBe("senior_execution_approval_missing");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("approved one-token request completes with correlation", async () => {
    let state = "queued";
    const fetchImpl = mockFetch({
      "/v1/health": () =>
        new Response(
          JSON.stringify({
            healthy: true,
            serviceState: "idle",
            httpLocalOnly: true,
            bind: "127.0.0.1:8091",
            executionMode: "modelopt_fake_quant_cuda",
            recoveryRequired: false,
            sourceCommit: "abc",
            sourceManifestSha256: "def",
          }),
        ),
      "/v1/readiness": () =>
        new Response(
          JSON.stringify({
            serviceReady: true,
            acceptingRequests: true,
            recoveryRequired: false,
          }),
        ),
      "/v1/generations": (init) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ requestId: "s13-hello-1", state: "queued" }), {
            status: 202,
          });
        }
        state = "completed";
        return new Response(
          JSON.stringify({
            requestId: "s13-hello-1",
            state,
            result: {
              generatedTokens: [{ tokenId: 1044, decoded: "!", selectedLogit: 0 }],
              nanoRestored: true,
              fallbackDetected: false,
              model: "Nemotron-Super-120B-A12B-FP8",
              createdAt: "t0",
              completedAt: "t1",
            },
          }),
        );
      },
    });
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "vera-hello", maxNewTokens: 1 });
    const { runner, store } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl,
      expectedSourceCommit: "abc",
      expectedManifestSha: "def",
      sleep: async () => undefined,
    });
    const record = await runner.run(
      {
        veraRequestId: "vera-hello",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: artifact.approvalReference,
        idempotencyKey: "idem-hello",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      artifact,
    );
    expect(record.state).toBe("senior_completed");
    expect(record.s13RequestId).toBe("s13-hello-1");
    expect(record.result?.generatedTokens.map((t) => t.tokenId)).toEqual([1044]);
    expect(store.read("vera-hello")?.s13RequestId).toBe("s13-hello-1");
  });

  it("duplicate invocation returns same S13 request", async () => {
    let posts = 0;
    const fetchImpl = mockFetch({
      "/v1/health": () =>
        new Response(
          JSON.stringify({
            healthy: true,
            serviceState: "idle",
            httpLocalOnly: true,
            bind: "127.0.0.1:8091",
            executionMode: "modelopt_fake_quant_cuda",
            recoveryRequired: false,
          }),
        ),
      "/v1/readiness": () =>
        new Response(JSON.stringify({ serviceReady: true, acceptingRequests: true, recoveryRequired: false })),
      "/v1/generations": (init) => {
        if (init?.method === "POST") {
          posts += 1;
          return new Response(JSON.stringify({ requestId: "s13-dup-1", state: "queued" }), { status: 202 });
        }
        return new Response(
          JSON.stringify({
            requestId: "s13-dup-1",
            state: "completed",
            result: {
              generatedTokens: [{ tokenId: 1044, decoded: "!", selectedLogit: 0 }],
              nanoRestored: true,
              fallbackDetected: false,
              completedAt: "t1",
            },
          }),
        );
      },
    });
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "vera-dup", maxNewTokens: 1 });
    const { runner } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl,
      sleep: async () => undefined,
    });
    const req = {
      veraRequestId: "vera-dup",
      prompt: "Hello",
      maxNewTokens: 1 as const,
      approvalReference: artifact.approvalReference,
      idempotencyKey: "idem-dup",
      requestedAt: new Date().toISOString(),
      seniorRequested: true,
    };
    const first = await runner.run(req, artifact);
    const second = await runner.run(req, artifact);
    expect(first.s13RequestId).toBe(second.s13RequestId);
    expect(posts).toBe(1);
  });

  it("blocks new submission when S13 recovery required", async () => {
    const fetchImpl = mockFetch({
      "/v1/health": () =>
        new Response(
          JSON.stringify({
            healthy: true,
            serviceState: "idle",
            httpLocalOnly: true,
            bind: "127.0.0.1:8091",
            executionMode: "modelopt_fake_quant_cuda",
            recoveryRequired: true,
          }),
        ),
      "/v1/readiness": () =>
        new Response(JSON.stringify({ serviceReady: false, acceptingRequests: false, recoveryRequired: true })),
    });
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "vera-rec", maxNewTokens: 1 });
    const { runner } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl,
      sleep: async () => undefined,
    });
    const record = await runner.run(
      {
        veraRequestId: "vera-rec",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: artifact.approvalReference,
        idempotencyKey: "idem-rec",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      artifact,
    );
    expect(record.s13RequestId).toBeNull();
    expect(record.error?.code).toBe("senior_recovery_required");
  });

  it("isolates S13 unavailable before submission", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "vera-down", maxNewTokens: 1 });
    const { runner } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl,
      sleep: async () => undefined,
    });
    const record = await runner.run(
      {
        veraRequestId: "vera-down",
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: artifact.approvalReference,
        idempotencyKey: "idem-down",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
        allowFallback: true,
      },
      artifact,
    );
    expect(record.s13RequestId).toBeNull();
    expect(record.state).toBe("senior_fallback_eligible");
    expect(record.fallbackWorker).toBe("local-nemotron-nano-30b-console");
  });

  it("cancellation propagates to S13", async () => {
    let cancelled = false;
    let state = "streaming_layers";
    const fetchImpl = mockFetch({
      "/v1/health": () =>
        new Response(
          JSON.stringify({
            healthy: true,
            serviceState: "running_request",
            httpLocalOnly: true,
            bind: "127.0.0.1:8091",
            executionMode: "modelopt_fake_quant_cuda",
            recoveryRequired: false,
          }),
        ),
      "/v1/readiness": () =>
        new Response(
          JSON.stringify({ serviceReady: true, acceptingRequests: false, largeModelRunning: true, recoveryRequired: false }),
        ),
      "/v1/generations": (init) => {
        const urlMethod = init?.method ?? "GET";
        if (urlMethod === "POST" && !String(init?.body ?? "").includes("cancel")) {
          // submit
          if (!cancelled) {
            return new Response(JSON.stringify({ requestId: "s13-cancel-1", state: "queued" }), { status: 202 });
          }
        }
        return new Response(JSON.stringify({ requestId: "s13-cancel-1", state }));
      },
      "/cancel": () => {
        cancelled = true;
        state = "cancelled";
        return new Response(JSON.stringify({ state: "cancellation_requested" }));
      },
    });
    // Refine mock: path-based
    const fetch2 = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/health")) {
        return new Response(
          JSON.stringify({
            healthy: true,
            serviceState: "idle",
            httpLocalOnly: true,
            bind: "127.0.0.1:8091",
            executionMode: "modelopt_fake_quant_cuda",
            recoveryRequired: false,
          }),
        );
      }
      if (url.endsWith("/v1/readiness")) {
        return new Response(
          JSON.stringify({ serviceReady: true, acceptingRequests: true, recoveryRequired: false }),
        );
      }
      if (url.endsWith("/v1/generations") && init?.method === "POST") {
        return new Response(JSON.stringify({ requestId: "s13-cancel-1", state: "queued" }), { status: 202 });
      }
      if (url.includes("/cancel") && init?.method === "POST") {
        cancelled = true;
        state = "cancelled";
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.includes("/v1/generations/s13-cancel-1")) {
        return new Response(JSON.stringify({ requestId: "s13-cancel-1", state }));
      }
      return new Response(JSON.stringify({ error: "unhandled" }), { status: 500 });
    }) as unknown as typeof fetch;

    const artifact = createSeniorApprovalArtifact({ veraRequestId: "vera-cancel", maxNewTokens: 2 });
    const { runner } = createSeniorAdapter({
      stateRoot: tempStore(),
      fetchImpl: fetch2,
      sleep: async () => undefined,
      deadlines: { pollIntervalMs: 1, queuedWaitMs: 50, activeExecutionMs: 50, operationalCleanupMs: 50 },
    });
    // Seed correlation mid-flight
    const storePath = tempStore();
    const adapter = createSeniorAdapter({
      stateRoot: storePath,
      fetchImpl: fetch2,
      sleep: async () => undefined,
      deadlines: { pollIntervalMs: 1 },
    });
    adapter.store.write({
      veraRequestId: "vera-cancel",
      runId: "",
      taskId: "",
      runtimeId: S14_RUNTIME_ID,
      approvalReference: artifact.approvalReference,
      s13RequestId: "s13-cancel-1",
      idempotencyKey: "idem-cancel",
      prompt: "The capital of France is",
      maxNewTokens: 2,
      state: "senior_executing",
      lastS13State: "streaming_layers",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      cancelRequestedAt: null,
      result: null,
      error: null,
      decision: null,
      allowFallback: false,
      fallbackUsed: false,
      fallbackWorker: null,
    });
    const cancelledRecord = await adapter.runner.cancel("vera-cancel");
    expect(cancelled).toBe(true);
    expect(cancelledRecord.state).toBe("senior_cancelled");
  });
});

describe("S13LocalClient", () => {
  it("constructs with default loopback", () => {
    const c = new S13LocalClient();
    expect(c.baseUrl).toBe("http://127.0.0.1:8091");
  });
});
