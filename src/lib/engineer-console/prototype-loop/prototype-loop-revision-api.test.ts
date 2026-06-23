import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { runPhase29APrototypeLoop } from "./phase-29a-prototype-loop";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-loop-revision-api-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-loop-revision-api-repo-"));
  tempRoots.push(root);
  return root;
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/engineer-console/prototype-loop/revision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Prototype Loop revision API trigger", () => {
  it("returns a revision result with task/run/evidence identifiers", async () => {
    const repoRoot = await tempRepo();
    const parent = await runPhase29APrototypeLoop({ repoRoot });
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/revision/route");

    const response = await POST(request({
      parent_task_id: parent.console_tracking.task_id,
      parent_run_id: parent.console_tracking.run_id,
      parent_evidence_path: parent.evidence_path,
      revision_request: {
        reason: "Repair the failed task_tests gate in the isolated prototype.",
        failed_gates: ["task_tests"],
        acceptance_criteria_not_met: ["Relevant tests/checks run."],
        requested_changes: ["Revise only the isolated prototype CLI test fixture."],
        safety_notes: ["Do not write outside .prototype-loop."],
      },
      max_revision_rounds: 1,
    }));
    const body = await response.json() as {
      status: string;
      revision_tracking: {
        parent_task_id: string;
        parent_run_id: string;
        revision_task_id: string;
        revision_run_id: string;
      };
      evidence_path: string;
      workspace_path: string;
      approval_required: boolean;
      integration_allowed: boolean;
      threshold_engine_output: { status: string };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.status).toBe("passed_with_skips");
    expect(body.revision_tracking.parent_task_id).toBe(parent.console_tracking.task_id);
    expect(body.revision_tracking.parent_run_id).toBe(parent.console_tracking.run_id);
    expect(body.revision_tracking.revision_task_id).toBeTruthy();
    expect(body.revision_tracking.revision_run_id).toBeTruthy();
    expect(body.workspace_path).toContain(".prototype-loop");
    expect(body.evidence_path).toContain("evidence/prototype-loop-v1");
    expect(body.threshold_engine_output.status).toBe("passed_with_skips");
    expect(body.approval_required).toBe(true);
    expect(body.integration_allowed).toBe(false);
    await expect(fs.stat(body.evidence_path)).resolves.toBeTruthy();
  });

  it("returns blocked response for invalid request", async () => {
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/revision/route");

    const response = await POST(request({
      parent_task_id: "",
      parent_run_id: "",
      parent_evidence_path: "",
      revision_request: {
        reason: "",
        failed_gates: [],
        acceptance_criteria_not_met: [],
        requested_changes: [],
        safety_notes: [],
      },
      max_revision_rounds: 2,
    }));
    const body = await response.json() as {
      status: string;
      blocked_reason: string;
      approval_required: boolean;
      integration_allowed: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("blocked");
    expect(body.blocked_reason).toBeTruthy();
    expect(body.approval_required).toBe(true);
    expect(body.integration_allowed).toBe(false);
  });
});
