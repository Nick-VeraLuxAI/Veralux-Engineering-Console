import { mkdtemp, readFile, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PHASE_26_DOC_RELATIVE_PATH,
  PHASE_26_EVIDENCE_RELATIVE_PATH,
  PHASE_26_SAFE_REQUEST,
} from "./mainline-governed-change-demo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/engineer-console/server", () => ({
  ensureEngineerConsoleReady: vi.fn(),
}));
vi.mock("@/lib/engineer-console/security/route-guards", () => ({
  authorizeMutation: vi.fn(async () => ({ operator: { id: "local", role: "operator" } })),
}));

const tempRoots: string[] = [];

function request(body?: unknown): Request {
  return new Request("http://localhost/api/engineer-console/mainline-runtime/governed-change-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "phase-27-governed-api-"));
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

describe("Phase 27 governed change demo API trigger", () => {
  it("returns success for the default safe request and writes approved docs/evidence", async () => {
    const repoRoot = await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");

    const response = await POST(request());
    const body = await response.json();
    const docPath = path.join(repoRoot, PHASE_26_DOC_RELATIVE_PATH);
    const evidencePath = path.join(repoRoot, PHASE_26_EVIDENCE_RELATIVE_PATH);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.status).toBe("governed_code_change_api_ui_trigger_passed_awaiting_user_approval");
    expect(body.proof.request).toBe(PHASE_26_SAFE_REQUEST);
    await expect(stat(docPath)).resolves.toBeTruthy();
    await expect(stat(evidencePath)).resolves.toBeTruthy();
    await expect(readFile(docPath, "utf8")).resolves.toContain("Phase 26");
    await expect(readFile(evidencePath, "utf8")).resolves.toContain("real_governed_code_change_demo_passed_awaiting_user_approval");
  });

  it("returns the Phase 20 Nano mainline contract in the proof", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.runtimeContract.contractSchema).toBe("mainline_runtime.phase_20.v1");
    expect(body.proof.runtimeContract.status).toBe("usable_without_senior_runtime");
  });

  it("includes Vera Nano endpoint 8081 and Console Nano endpoint 8082", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.runtimeContract.activeRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "vera_command", endpoint: "http://127.0.0.1:8081/v1" }),
      expect.objectContaining({ roleId: "console_default_worker", endpoint: "http://127.0.0.1:8082/v1" }),
    ]));
  });

  it("includes changed files", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.changedFiles).toEqual([
      PHASE_26_DOC_RELATIVE_PATH,
      PHASE_26_EVIDENCE_RELATIVE_PATH,
    ]);
  });

  it("records checks and tests", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.checks).toHaveLength(1);
    expect(body.proof.checks[0]).toMatchObject({
      status: "recorded",
      expectedResult: "passed",
    });
    expect(body.proof.checks[0].command).toContain("mainline-governed-change-demo.test.ts");
  });

  it("reaches awaiting user approval through the required lifecycle", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
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

  it("reports approval required and no integration", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.approvalRequired).toBe(true);
    expect(body.proof.safetyInvariants.integrationPerformed).toBe(false);
  });

  it("reports PR and merge were not performed", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.prCreated).toBe(false);
    expect(body.proof.safetyInvariants.mergePerformed).toBe(false);
  });

  it("reports no fallback or Qwen usage", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.fallbackUsed).toBe(false);
    expect(body.proof.safetyInvariants.qwenUsed).toBe(false);
  });

  it("reports Super, Mixtral, and AirLLM are not required or used", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const body = await (await POST(request())).json();

    expect(body.proof.safetyInvariants.superRequired).toBe(false);
    expect(body.proof.safetyInvariants.mixtralRequired).toBe(false);
    expect(body.proof.safetyInvariants.airllmUsed).toBe(false);
  });

  it("rejects unsafe documentation paths", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const response = await POST(request({ docPath: "src/app/unsafe.tsx" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("MAINLINE_GOVERNED_DEMO_DOC_PATH_NOT_ALLOWED");
  });

  it("rejects unsafe evidence paths", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const response = await POST(request({ evidencePath: "evidence/nano-mainline-runtime/other.md" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("MAINLINE_GOVERNED_DEMO_EVIDENCE_PATH_NOT_ALLOWED");
  });

  it("is deterministic enough for audit with fixed request", async () => {
    await useTempRepoCwd();
    const { POST } = await import("@/app/api/engineer-console/mainline-runtime/governed-change-demo/route");
    const input = { request: "Phase 27 deterministic governed request" };
    const first = await (await POST(request(input))).json();
    const second = await (await POST(request(input))).json();

    expect(first).toEqual(second);
  });
});
