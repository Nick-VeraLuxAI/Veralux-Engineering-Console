import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import type { PrototypeImplementationPlanningRequest } from "./prototype-implementation-planning";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-implementation-planning-api-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-implementation-planning-api-repo-"));
  tempRoots.push(root);
  return root;
}

function apiRequest(body: unknown): Request {
  return new Request("http://localhost/api/engineer-console/prototype-loop/implementation-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(repoRoot: string, overrides: Partial<PrototypeImplementationPlanningRequest> = {}): PrototypeImplementationPlanningRequest {
  return {
    implementation_request_id: "impl-request-1",
    approval_decision_id: "approval-decision-1",
    task_id: "task-1",
    run_id: "run-1",
    evidence_path: path.join(repoRoot, "evidence", "prototype-loop-v1", "task-1.json"),
    final_readiness_status: "ready_for_user_approval",
    requested_implementation_intent: "prepare_governed_implementation_plan",
    production_mutation_allowed: false,
    safety_constraints: [
      "Do not mutate production files in Phase 37.",
      "Do not copy generated prototype files into production.",
      "Do not merge, deploy, apply patches, or run implementation executors.",
    ],
    ...overrides,
  };
}

describe("Prototype implementation planning API", () => {
  it("returns implementation plan recorded for a valid request", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/implementation-plan/route");

    const response = await POST(apiRequest(body(repoRoot)));
    const parsed = await response.json() as {
      planning_status: string;
      plan_path: string;
      production_mutation_allowed: boolean;
      approval_required_before_apply: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.planning_status).toBe("implementation_plan_recorded");
    expect(parsed.production_mutation_allowed).toBe(false);
    expect(parsed.approval_required_before_apply).toBe(true);
    await expect(fs.stat(parsed.plan_path)).resolves.toBeTruthy();
  });

  it("returns blocked for invalid requests", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/implementation-plan/route");

    const response = await POST(apiRequest(body(repoRoot, { final_readiness_status: "failed" })));
    const parsed = await response.json() as { planning_status: string; blocked_reason: string };

    expect(response.status).toBe(200);
    expect(parsed.planning_status).toBe("blocked");
    expect(parsed.blocked_reason).toContain("final_readiness_status");
  });

  it("does not call apply, merge, deploy, patch, or copy code hooks", async () => {
    const repoRoot = await tempRepo();
    const hooks = {
      apply: vi.fn(),
      merge: vi.fn(),
      deploy: vi.fn(),
      patch: vi.fn(),
      copy: vi.fn(),
    };
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/implementation-plan/route");

    await POST(apiRequest({
      ...body(repoRoot),
      apply: hooks.apply,
      merge: hooks.merge,
      deploy: hooks.deploy,
      patch: hooks.patch,
      copy: hooks.copy,
    }));

    expect(hooks.apply).not.toHaveBeenCalled();
    expect(hooks.merge).not.toHaveBeenCalled();
    expect(hooks.deploy).not.toHaveBeenCalled();
    expect(hooks.patch).not.toHaveBeenCalled();
    expect(hooks.copy).not.toHaveBeenCalled();
  });
});
