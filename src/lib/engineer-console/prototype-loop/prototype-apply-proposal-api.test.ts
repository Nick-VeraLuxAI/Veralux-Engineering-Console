import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import type { PrototypeApplyProposalRequest } from "./prototype-apply-proposal";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-apply-proposal-api-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-apply-proposal-api-repo-"));
  tempRoots.push(root);
  return root;
}

function apiRequest(body: unknown): Request {
  return new Request("http://localhost/api/engineer-console/prototype-loop/apply-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(repoRoot: string, overrides: Partial<PrototypeApplyProposalRequest> = {}): PrototypeApplyProposalRequest {
  return {
    implementation_plan_id: "implementation-plan-1",
    implementation_request_id: "impl-request-1",
    approval_decision_id: "approval-decision-1",
    task_id: "task-1",
    run_id: "run-1",
    evidence_path: path.join(repoRoot, "evidence", "prototype-loop-v1", "task-1.json"),
    plan_path: path.join(repoRoot, "evidence", "prototype-implementation-plans", "implementation-plan-1.json"),
    final_readiness_status: "ready_for_user_approval",
    production_mutation_allowed: false,
    approval_required_before_apply: true,
    requested_apply_intent: "prepare_governed_apply_proposal",
    safety_constraints: [
      "Do not mutate production files in Phase 40.",
      "Do not copy generated prototype files into production.",
      "Do not merge, deploy, apply patches, commit, push, or run implementation executors.",
    ],
    ...overrides,
  };
}

describe("Prototype apply proposal API", () => {
  it("returns apply proposal recorded for a valid request", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/apply-proposal/route");

    const response = await POST(apiRequest(body(repoRoot)));
    const parsed = await response.json() as {
      apply_proposal_status: string;
      proposal_path: string;
      production_mutation_allowed: boolean;
      apply_allowed: boolean;
      user_approval_required: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.apply_proposal_status).toBe("apply_proposal_recorded");
    expect(parsed.production_mutation_allowed).toBe(false);
    expect(parsed.apply_allowed).toBe(false);
    expect(parsed.user_approval_required).toBe(true);
    await expect(fs.stat(parsed.proposal_path)).resolves.toBeTruthy();
  });

  it("returns blocked for invalid requests", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/apply-proposal/route");

    const response = await POST(apiRequest(body(repoRoot, { final_readiness_status: "failed" })));
    const parsed = await response.json() as { apply_proposal_status: string; blocked_reason: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.apply_proposal_status).toBe("blocked");
    expect(parsed.blocked_reason).toContain("final_readiness_status");
  });

  it("does not call apply, merge, deploy, patch, copy, commit, push, or PR code hooks", async () => {
    const repoRoot = await tempRepo();
    const hooks = {
      apply: vi.fn(),
      merge: vi.fn(),
      deploy: vi.fn(),
      patch: vi.fn(),
      copy: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      pr: vi.fn(),
    };
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/apply-proposal/route");

    await POST(apiRequest({
      ...body(repoRoot),
      apply: hooks.apply,
      merge: hooks.merge,
      deploy: hooks.deploy,
      patch: hooks.patch,
      copy: hooks.copy,
      commit: hooks.commit,
      push: hooks.push,
      pr: hooks.pr,
    }));

    expect(hooks.apply).not.toHaveBeenCalled();
    expect(hooks.merge).not.toHaveBeenCalled();
    expect(hooks.deploy).not.toHaveBeenCalled();
    expect(hooks.patch).not.toHaveBeenCalled();
    expect(hooks.copy).not.toHaveBeenCalled();
    expect(hooks.commit).not.toHaveBeenCalled();
    expect(hooks.push).not.toHaveBeenCalled();
    expect(hooks.pr).not.toHaveBeenCalled();
  });

  it("preserves Console mutation authorization pattern", async () => {
    const repoRoot = await tempRepo();
    const routeGuards = await import("@/lib/engineer-console/security/route-guards");
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/apply-proposal/route");

    await POST(apiRequest(body(repoRoot)));

    expect(routeGuards.authorizeMutation).toHaveBeenCalledWith(expect.any(Request), { minRole: "operator" });
  });
});
