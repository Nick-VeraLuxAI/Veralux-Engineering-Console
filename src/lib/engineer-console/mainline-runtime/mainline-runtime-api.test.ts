import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/engineer-console/server", () => ({
  ensureEngineerConsoleReady: vi.fn(),
}));
vi.mock("@/lib/engineer-console/security/route-guards", () => ({
  authorizeRead: vi.fn(async () => ({ operator: { id: "local", role: "viewer" } })),
}));

function request(): Request {
  return new Request("http://localhost/api/engineer-console/mainline-runtime", {
    method: "GET",
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Phase 22 mainline runtime API routes", () => {
  it("returns the Nano mainline runtime contract through the app API surface", async () => {
    const { GET } = await import("@/app/api/engineer-console/mainline-runtime/contract/route");
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.contract.contractSchema).toBe("mainline_runtime.phase_20.v1");
    expect(body.contract.activeRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        roleId: "vera_command",
        endpoint: "http://127.0.0.1:8081/v1",
        requiredForMainline: true,
      }),
      expect.objectContaining({
        roleId: "console_default_worker",
        endpoint: "http://127.0.0.1:8082/v1",
        requiredForMainline: true,
      }),
    ]));
    expect(body.contract.safetyPolicy.fallbackAllowed).toBe(false);
    expect(body.contract.safetyPolicy.qwenUsed).toBe(false);
    expect(body.contract.safetyPolicy.superRequiredForMainline).toBe(false);
    expect(body.contract.safetyPolicy.mixtralRequiredForMainline).toBe(false);
  });

  it("returns the deterministic mainline task run proof through the app API surface", async () => {
    const { GET } = await import("@/app/api/engineer-console/mainline-runtime/task-run-proof/route");
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proof.proofSchema).toBe("mainline_task_run_proof.phase_21.v1");
    expect(body.proof.lifecycle.map((step: { state: string }) => step.state)).toEqual([
      "intent_intake",
      "console_task_requested",
      "governed_execution",
      "evidence_packaged",
      "awaiting_user_approval",
    ]);
    expect(body.proof.finalState).toBe("awaiting_user_approval");
    expect(body.proof.safetyInvariants.approvalRequired).toBe(true);
    expect(body.proof.safetyInvariants.integrationPerformed).toBe(false);
    expect(body.proof.safetyInvariants.fallbackUsed).toBe(false);
    expect(body.proof.safetyInvariants.qwenUsed).toBe(false);
    expect(body.proof.safetyInvariants.superRequired).toBe(false);
    expect(body.proof.safetyInvariants.mixtralRequired).toBe(false);
  });

  it("returns deterministic task proof responses", async () => {
    const { GET } = await import("@/app/api/engineer-console/mainline-runtime/task-run-proof/route");
    const first = await (await GET(request())).json();
    const second = await (await GET(request())).json();

    expect(first).toEqual(second);
  });
});
