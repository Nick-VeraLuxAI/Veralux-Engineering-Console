import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/engineer-console/server", () => ({
  ensureEngineerConsoleReady: vi.fn(),
}));
vi.mock("@/lib/engineer-console/security/route-guards", () => ({
  authorizeMutation: vi.fn(async () => ({ operator: { id: "local", role: "operator" } })),
}));

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "phase-29a-api-"));
  tempRoots.push(root);
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(root, "engineer-console.db");
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (originalDbPath === undefined) {
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
  } else {
    process.env.ENGINEER_CONSOLE_DB_PATH = originalDbPath;
  }
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "phase-29a-api-repo-"));
  tempRoots.push(root);
  return root;
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/engineer-console/prototype-loop/phase-29a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Phase 29A Prototype Loop API trigger", () => {
  it("runs the vertical slice and returns evidence plus approval summary", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/phase-29a/route");

    const response = await POST(request({
      repoRoot,
      request: "Build a tiny CLI tool that reads a text file and returns word count, character count, and top 5 repeated words.",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.status).toBe("phase_29a_prototype_loop_ready_for_user_approval");
    expect(body.result.structured_build_spec.task_type).toBe("build_prototype");
    expect(body.result.console_tracking.task_id).toBeTruthy();
    expect(body.result.console_tracking.run_id).toBeTruthy();
    expect(body.result.workspace_path).toContain(".prototype-loop");
    expect(body.result.evidence_path).toContain("evidence/prototype-loop-v1");
    expect(body.result.vera_summary.approval_question).toBe(
      "Do you want to approve implementation, request a revision, or discard this prototype?",
    );
    await expect(fs.stat(body.result.evidence_path)).resolves.toBeTruthy();
  });
});
