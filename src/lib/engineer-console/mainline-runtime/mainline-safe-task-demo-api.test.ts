import { mkdtemp, readFile, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PHASE_23_EVIDENCE_RELATIVE_PATH,
  PHASE_23_SAFE_REQUEST,
} from "./mainline-safe-task-execution-demo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/engineer-console/server", () => ({
  ensureEngineerConsoleReady: vi.fn(),
}));
vi.mock("@/lib/engineer-console/security/route-guards", () => ({
  authorizeMutation: vi.fn(async () => ({ operator: { id: "local", role: "operator" } })),
}));

const tempRoots: string[] = [];

function request(body?: unknown): Request {
  return new Request("http://localhost/api/engineer-console/mainline-runtime/safe-task-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "phase-24-safe-api-"));
  tempRoots.push(root);
  return root;
}

async function useTempRepoCwd(): Promise<string> {
  const root = await tempRepo();
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("Phase 24 safe task demo API trigger", () => {
  it("returns success for the default safe request and writes controlled evidence", async () => {
    const repoRoot = await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");

    const response = await POST(request());
    const body = await response.json();
    const evidencePath = path.join(repoRoot, PHASE_23_EVIDENCE_RELATIVE_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.status).toBe("safe_mainline_task_demo_api_trigger_passed_awaiting_user_approval");
    expect(body.proof.request).toBe(PHASE_23_SAFE_REQUEST);
    await expect(stat(evidencePath)).resolves.toBeTruthy();
    await expect(readFile(evidencePath, "utf8")).resolves.toContain("Phase 23");
  });

  it("returns the Phase 20 Nano mainline contract in the proof", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.runtimeContract.contractSchema).toBe("mainline_runtime.phase_20.v1");
    expect(body.proof.runtimeContract.status).toBe("usable_without_senior_runtime");
  });

  it("includes Vera Nano endpoint 8081 and Console Nano endpoint 8082", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.runtimeContract.activeRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "vera_command", endpoint: "http://127.0.0.1:8081/v1" }),
      expect.objectContaining({ roleId: "console_default_worker", endpoint: "http://127.0.0.1:8082/v1" }),
    ]));
  });

  it("reaches awaiting user approval through the required lifecycle", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.lifecycle.map((step: { state: string }) => step.state)).toEqual([
      "intent_intake",
      "console_task_requested",
      "governed_execution",
      "evidence_packaged",
      "awaiting_user_approval",
    ]);
    expect(body.proof.finalState).toBe("awaiting_user_approval");
  });

  it("reports approval required and no integration performed", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.approvalRequired).toBe(true);
    expect(body.proof.safetyInvariants.integrationPerformed).toBe(false);
    expect(body.proof.runtimeContract.evidencePolicy.approvalRequired).toBe(true);
    expect(body.proof.runtimeContract.evidencePolicy.integrationPerformed).toBe(false);
  });

  it("reports no fallback or Qwen usage", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.fallbackUsed).toBe(false);
    expect(body.proof.safetyInvariants.qwenUsed).toBe(false);
    expect(body.proof.runtimeContract.safetyPolicy.fallbackUsed).toBe(false);
    expect(body.proof.runtimeContract.safetyPolicy.qwenUsed).toBe(false);
  });

  it("reports Super and Mixtral are not required", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.superRequired).toBe(false);
    expect(body.proof.safetyInvariants.mixtralRequired).toBe(false);
    expect(body.proof.runtimeContract.parkedRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "console_senior_worker", requiredForMainline: false }),
      expect.objectContaining({ roleId: "console_cold_senior_reviewer", requiredForMainline: false }),
    ]));
  });

  it("keeps controlled write path inside evidence/nano-mainline-runtime", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.controlledWrite.path).toBe(PHASE_23_EVIDENCE_RELATIVE_PATH);
    expect(body.proof.controlledWrite.allowedDirectory).toBe("evidence/nano-mainline-runtime");
    expect(body.proof.controlledWrite.productionFilesChanged).toBe(false);
  });

  it("rejects unsafe write paths", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const response = await POST(request({ outputPath: "src/app/unsafe.md" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("MAINLINE_SAFE_DEMO_WRITE_OUTSIDE_EVIDENCE_DIR");
  });

  it("is deterministic enough for audit when using a fixed output path", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/safe-task-demo/route");
    const input = {
      request: "Phase 24 deterministic safe request",
      outputPath: "evidence/nano-mainline-runtime/phase-24-api-test.md",
    };
    const first = await (await POST(request(input))).json();
    const second = await (await POST(request(input))).json();

    expect(first).toEqual(second);
  });
});
