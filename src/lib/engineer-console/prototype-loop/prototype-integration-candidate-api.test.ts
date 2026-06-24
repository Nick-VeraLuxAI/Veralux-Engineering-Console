import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import type { PrototypeIntegrationCandidateRequest } from "./prototype-integration-candidate";

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-integration-candidate-api-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-integration-candidate-api-repo-"));
  tempRoots.push(root);
  return root;
}

function apiRequest(body: unknown): Request {
  return new Request("http://localhost/api/engineer-console/prototype-loop/integration-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(repoRoot: string, overrides: Partial<PrototypeIntegrationCandidateRequest> = {}): PrototypeIntegrationCandidateRequest {
  return {
    controlled_apply_review_decision_id: "controlled-apply-review-decision-1",
    controlled_apply_id: "controlled-apply-1",
    controlled_apply_evidence_path: path.join(repoRoot, "evidence", "prototype-controlled-apply", "controlled-apply-1.json"),
    controlled_apply_workspace_path: path.join(repoRoot, ".controlled-apply", "controlled-apply-1"),
    apply_approval_decision_id: "apply-approval-decision-1",
    apply_proposal_id: "apply-proposal-1",
    implementation_plan_id: "implementation-plan-1",
    implementation_request_id: "impl-request-1",
    approval_decision_id: "approval-decision-1",
    task_id: "task-1",
    run_id: "run-1",
    prototype_evidence_path: path.join(repoRoot, "evidence", "prototype-loop-v1", "task-1.json"),
    plan_path: path.join(repoRoot, "evidence", "prototype-implementation-plans", "implementation-plan-1.json"),
    proposal_path: path.join(repoRoot, "evidence", "prototype-apply-proposals", "apply-proposal-1.json"),
    controlled_apply_status: "controlled_apply_completed",
    checks_passed: true,
    review_required: true,
    integration_allowed: false,
    production_integration_intent_recorded: true,
    merge_allowed: false,
    deploy_allowed: false,
    pr_allowed: false,
    production_mutation_allowed: false,
    requested_integration_intent: "prepare_integration_candidate_in_isolated_workspace",
    safety_constraints: [
      "Do not mutate production files in Phase 46.",
      "Do not mutate the main working tree.",
      "Do not merge, deploy, push, create PRs, commit, or run production release actions.",
    ],
    ...overrides,
  };
}

describe("Prototype integration candidate API", () => {
  it("returns integration candidate recorded for a valid request", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/integration-candidate/route");

    const response = await POST(apiRequest(body(repoRoot)));
    const parsed = await response.json() as {
      integration_candidate_status: string;
      workspace_path: string;
      evidence_path: string;
      review_required: boolean;
      final_integration_approval_required: boolean;
      main_tree_mutated: boolean;
      merge_allowed: boolean;
      deploy_allowed: boolean;
      push_allowed: boolean;
      pr_allowed: boolean;
      commit_allowed: boolean;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.integration_candidate_status).toBe("integration_candidate_recorded");
    expect(parsed.workspace_path).toContain(".integration-candidates");
    expect(parsed.evidence_path).toContain("prototype-integration-candidates");
    expect(parsed.review_required).toBe(true);
    expect(parsed.final_integration_approval_required).toBe(true);
    expect(parsed.main_tree_mutated).toBe(false);
    expect(parsed.merge_allowed).toBe(false);
    expect(parsed.deploy_allowed).toBe(false);
    expect(parsed.push_allowed).toBe(false);
    expect(parsed.pr_allowed).toBe(false);
    expect(parsed.commit_allowed).toBe(false);
    await expect(fs.stat(parsed.evidence_path)).resolves.toBeTruthy();
  });

  it("returns blocked for invalid requests", async () => {
    const repoRoot = await tempRepo();
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/integration-candidate/route");

    const response = await POST(apiRequest(body(repoRoot, { production_integration_intent_recorded: false })));
    const parsed = await response.json() as { integration_candidate_status: string; blocked_reason: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(parsed.integration_candidate_status).toBe("blocked");
    expect(parsed.blocked_reason).toContain("production_integration_intent_recorded");
  });

  it("does not call merge, deploy, push, PR, or commit code hooks", async () => {
    const repoRoot = await tempRepo();
    const hooks = {
      merge: vi.fn(),
      deploy: vi.fn(),
      push: vi.fn(),
      pr: vi.fn(),
      commit: vi.fn(),
    };
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/integration-candidate/route");

    await POST(apiRequest({
      ...body(repoRoot),
      merge: hooks.merge,
      deploy: hooks.deploy,
      push: hooks.push,
      pr: hooks.pr,
      commit: hooks.commit,
    }));

    expect(hooks.merge).not.toHaveBeenCalled();
    expect(hooks.deploy).not.toHaveBeenCalled();
    expect(hooks.push).not.toHaveBeenCalled();
    expect(hooks.pr).not.toHaveBeenCalled();
    expect(hooks.commit).not.toHaveBeenCalled();
  });

  it("preserves Console mutation authorization pattern", async () => {
    const repoRoot = await tempRepo();
    const routeGuards = await import("@/lib/engineer-console/security/route-guards");
    const { POST } = await import("@/app/api/engineer-console/prototype-loop/integration-candidate/route");

    await POST(apiRequest(body(repoRoot)));

    expect(routeGuards.authorizeMutation).toHaveBeenCalledWith(expect.any(Request), { minRole: "operator" });
  });
});
