import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  runPrototypeControlledApplyV1,
  type PrototypeControlledApplyRequest,
} from "./prototype-controlled-apply";

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-controlled-apply-db-"));
  tempRoots.push(root);
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(root, "engineer-console.db");
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(async () => {
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-controlled-apply-repo-"));
  tempRoots.push(root);
  return root;
}

function request(repoRoot: string, overrides: Partial<PrototypeControlledApplyRequest> = {}): PrototypeControlledApplyRequest {
  return {
    apply_approval_decision_id: "apply-approval-decision-1",
    apply_proposal_id: "apply-proposal-1",
    implementation_plan_id: "implementation-plan-1",
    implementation_request_id: "impl-request-1",
    approval_decision_id: "approval-decision-1",
    task_id: "task-1",
    run_id: "run-1",
    evidence_path: path.join(repoRoot, "evidence", "prototype-loop-v1", "task-1.json"),
    plan_path: path.join(repoRoot, "evidence", "prototype-implementation-plans", "implementation-plan-1.json"),
    proposal_path: path.join(repoRoot, "evidence", "prototype-apply-proposals", "apply-proposal-1.json"),
    final_readiness_status: "ready_for_user_approval",
    production_mutation_allowed: false,
    apply_allowed: false,
    controlled_apply_allowed: true,
    user_approval_required: true,
    approval_required_before_apply: true,
    requested_controlled_apply_intent: "execute_controlled_apply_in_isolated_workspace",
    safety_constraints: [
      "Do not mutate production files in Phase 43.",
      "Do not mutate the main working tree.",
      "Do not merge, deploy, push, create PRs, commit, or run implementation executors.",
    ],
    user_note: "Execute controlled apply in isolated workspace only.",
    ...overrides,
  };
}

async function run(overrides: Partial<PrototypeControlledApplyRequest> = {}) {
  const repoRoot = await tempRepo();
  return runPrototypeControlledApplyV1(request(repoRoot, overrides), {
    repoRoot,
    now: new Date("2026-06-24T07:30:00.000Z"),
    controlledApplyId: () => "controlled-apply-1",
  });
}

describe("Prototype controlled apply v1", () => {
  it("completes controlled apply for valid approved apply lineage in an isolated workspace", async () => {
    const result = await run();

    expect(result.controlled_apply_status).toBe("controlled_apply_completed");
    expect(result.accepted).toBe(true);
    expect(result.workspace_path).toContain(`${path.sep}.controlled-apply${path.sep}controlled-apply-1`);
    expect(result.evidence_path).toContain(`${path.sep}evidence${path.sep}prototype-controlled-apply${path.sep}controlled-apply-1.json`);
    expect(result.files_changed).toEqual(expect.arrayContaining([
      "controlled-apply-manifest.json",
      "word-count-cli.mjs",
      "word-count-cli.test.mjs",
      "sample.txt",
    ]));
    expect(result.checks_passed).toBe(true);
    expect(result.review_required).toBe(true);
    expect(result.integration_allowed).toBe(false);
    expect(result.merge_allowed).toBe(false);
    expect(result.deploy_allowed).toBe(false);
    expect(result.pr_allowed).toBe(false);
    expect(result.production_mutation_allowed).toBe(false);
    await expect(fs.stat(path.join(result.workspace_path, "word-count-cli.mjs"))).resolves.toBeTruthy();
  });

  it("completes controlled apply with revision evidence lineage", async () => {
    const result = await run({
      revision_task_id: "task-revision",
      revision_run_id: "run-revision",
      revision_evidence_path: "evidence/prototype-loop-v1/task-revision.json",
      final_readiness_status: "passed_with_skips",
    });

    expect(result.controlled_apply_status).toBe("controlled_apply_completed");
    expect(result.revision_task_id).toBe("task-revision");
    const evidence = JSON.parse(await fs.readFile(result.evidence_path, "utf8")) as typeof result;
    expect(evidence.revision_run_id).toBe("run-revision");
    expect(evidence.revision_evidence_path).toBe("evidence/prototype-loop-v1/task-revision.json");
  });

  it("blocks missing apply approval decision id", async () => {
    expect((await run({ apply_approval_decision_id: "" })).blocked_reason).toContain("apply_approval_decision_id");
  });

  it("blocks missing apply proposal id", async () => {
    expect((await run({ apply_proposal_id: "" })).blocked_reason).toContain("apply_proposal_id");
  });

  it("blocks missing implementation plan id", async () => {
    expect((await run({ implementation_plan_id: "" })).blocked_reason).toContain("implementation_plan_id");
  });

  it("blocks missing implementation request id", async () => {
    expect((await run({ implementation_request_id: "" })).blocked_reason).toContain("implementation_request_id");
  });

  it("blocks missing approval decision id", async () => {
    expect((await run({ approval_decision_id: "" })).blocked_reason).toContain("approval_decision_id");
  });

  it("blocks missing task/run/evidence lineage", async () => {
    expect((await run({ task_id: "" })).blocked_reason).toContain("task_id");
    expect((await run({ run_id: "" })).blocked_reason).toContain("run_id");
    expect((await run({ evidence_path: "" })).blocked_reason).toContain("evidence_path");
  });

  it("blocks missing plan or proposal path", async () => {
    expect((await run({ plan_path: "" })).blocked_reason).toContain("plan_path");
    expect((await run({ proposal_path: "" })).blocked_reason).toContain("proposal_path");
  });

  it("blocks failed readiness", async () => {
    expect((await run({ final_readiness_status: "failed" })).blocked_reason).toContain("final_readiness_status");
  });

  it("blocks blocked readiness", async () => {
    expect((await run({ final_readiness_status: "blocked" })).blocked_reason).toContain("final_readiness_status");
  });

  it("blocks production mutation allowed", async () => {
    expect((await run({ production_mutation_allowed: true })).blocked_reason).toContain("production_mutation_allowed");
  });

  it("blocks controlled apply not allowed", async () => {
    expect((await run({ controlled_apply_allowed: false })).blocked_reason).toContain("controlled_apply_allowed");
  });

  it("blocks user approval not required", async () => {
    expect((await run({ user_approval_required: false })).blocked_reason).toContain("user_approval_required");
  });

  it("blocks approval not required before apply", async () => {
    expect((await run({ approval_required_before_apply: false })).blocked_reason).toContain("approval_required_before_apply");
  });

  it("blocks wrong requested intent", async () => {
    expect((await run({ requested_controlled_apply_intent: "merge_to_main" })).blocked_reason).toContain("requested_controlled_apply_intent");
  });

  it("blocks missing safety constraints", async () => {
    expect((await run({ safety_constraints: [] })).blocked_reason).toContain("safety_constraints");
  });

  it("blocks merge, deploy, push, PR, commit, direct-production, or main-tree requests", async () => {
    for (const action of ["merge", "deploy", "push", "PR", "commit", "direct production", "main working tree"]) {
      const result = await run({ user_note: `Please ${action} now.` });
      expect(result.blocked_reason).toContain("Phase 43 cannot");
    }
  });

  it("blocks contradictory safety constraints", async () => {
    expect((await run({ safety_constraints: ["Production mutation is allowed."] })).blocked_reason).toContain("contradictory");
  });

  it("guards workspace path generation", async () => {
    const repoRoot = await tempRepo();

    await expect(runPrototypeControlledApplyV1(request(repoRoot), {
      repoRoot,
      controlledApplyId: () => "../escape",
    })).rejects.toThrow("controlled_apply_id");
  });

  it("writes evidence artifact with lineage and manifest", async () => {
    const result = await run();
    const evidence = JSON.parse(await fs.readFile(result.evidence_path, "utf8")) as typeof result & {
      workspace_manifest: { controlled_apply_id: string };
      explicit_non_actions: string[];
    };

    expect(evidence.controlled_apply_id).toBe("controlled-apply-1");
    expect(evidence.apply_approval_decision_id).toBe("apply-approval-decision-1");
    expect(evidence.apply_proposal_id).toBe("apply-proposal-1");
    expect(evidence.implementation_plan_id).toBe("implementation-plan-1");
    expect(evidence.prototype_evidence_path).toContain("prototype-loop-v1");
    expect(evidence.workspace_manifest.controlled_apply_id).toBe("controlled-apply-1");
    expect(evidence.explicit_non_actions).toEqual(expect.arrayContaining([
      "No main tree mutation.",
      "No merge.",
      "No deploy.",
      "No pull request.",
      "No commit.",
      "No push.",
    ]));
  });

  it("records checks and review-required safety flags", async () => {
    const result = await run();

    expect(result.checks_run.map((check) => check.command)).toEqual([
      "node --check word-count-cli.mjs",
      "node --test word-count-cli.test.mjs",
    ]);
    expect(result.checks_run.every((check) => check.status === "passed")).toBe(true);
    expect(result.rollback_plan.steps.join("\n")).toContain("delete the .controlled-apply workspace");
    expect(result.review_required).toBe(true);
    expect(result.integration_allowed).toBe(false);
    expect(result.merge_allowed).toBe(false);
    expect(result.deploy_allowed).toBe(false);
    expect(result.pr_allowed).toBe(false);
  });

  it("records failed status when workspace checks fail", async () => {
    const repoRoot = await tempRepo();
    const result = await runPrototypeControlledApplyV1(request(repoRoot), {
      repoRoot,
      controlledApplyId: () => "controlled-apply-1",
      commandRunner: async (_cwd, command) => ({
        command,
        status: command.includes("--test") ? "failed" : "passed",
        exitCode: command.includes("--test") ? 1 : 0,
        stdout: "",
        stderr: command.includes("--test") ? "test failed" : "",
        durationMs: 1,
      }),
    });

    expect(result.controlled_apply_status).toBe("failed");
    expect(result.accepted).toBe(false);
    expect(result.failure_reason).toContain("checks failed");
  });

  it("does not mutate the main working tree", async () => {
    const repoRoot = await tempRepo();
    const productionFile = path.join(repoRoot, "src", "production.ts");
    await fs.mkdir(path.dirname(productionFile), { recursive: true });
    await fs.writeFile(productionFile, "production", "utf8");

    const result = await runPrototypeControlledApplyV1(request(repoRoot), {
      repoRoot,
      controlledApplyId: () => "controlled-apply-1",
    });

    await expect(fs.readFile(productionFile, "utf8")).resolves.toBe("production");
    for (const changedFile of result.files_changed) {
      const changedPath = path.resolve(result.workspace_path, changedFile);
      expect(changedPath.startsWith(path.resolve(result.workspace_path))).toBe(true);
    }
  });
});
