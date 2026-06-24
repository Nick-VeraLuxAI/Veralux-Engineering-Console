import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  runPrototypeImplementationPlanningV1,
  type PrototypeImplementationPlanningRequest,
} from "./prototype-implementation-planning";

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-implementation-planning-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-implementation-planning-repo-"));
  tempRoots.push(root);
  return root;
}

function request(repoRoot: string, overrides: Partial<PrototypeImplementationPlanningRequest> = {}): PrototypeImplementationPlanningRequest {
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
    user_note: "Prepare implementation planning.",
    ...overrides,
  };
}

async function run(overrides: Partial<PrototypeImplementationPlanningRequest> = {}) {
  const repoRoot = await tempRepo();
  return runPrototypeImplementationPlanningV1(request(repoRoot, overrides), {
    repoRoot,
    now: new Date("2026-06-24T00:10:00.000Z"),
    planId: () => "implementation-plan-1",
  });
}

describe("Prototype implementation planning v1", () => {
  it("records an implementation plan for a valid handoff", async () => {
    const result = await run();

    expect(result.planning_status).toBe("implementation_plan_recorded");
    expect(result.accepted).toBe(true);
    expect(result.next_action).toBe("awaiting_user_plan_approval");
    expect(result.production_mutation_allowed).toBe(false);
    expect(result.approval_required_before_apply).toBe(true);
    await expect(fs.stat(result.plan_path)).resolves.toBeTruthy();
  });

  it("records an implementation plan with revision lineage", async () => {
    const result = await run({
      revision_task_id: "task-revision",
      revision_run_id: "run-revision",
      revision_evidence_path: "evidence/prototype-loop-v1/task-revision.json",
      final_readiness_status: "passed_with_skips",
    });

    expect(result.planning_status).toBe("implementation_plan_recorded");
    expect(result.revision_task_id).toBe("task-revision");
    expect(result.plan_artifact.revision_run_id).toBe("run-revision");
    expect(result.plan_artifact.final_readiness_status).toBe("passed_with_skips");
  });

  it("blocks missing implementation request id", async () => {
    expect((await run({ implementation_request_id: "" })).blocked_reason).toContain("implementation_request_id");
  });

  it("blocks missing approval decision id", async () => {
    expect((await run({ approval_decision_id: "" })).blocked_reason).toContain("approval_decision_id");
  });

  it("blocks missing task id", async () => {
    expect((await run({ task_id: "" })).blocked_reason).toContain("task_id");
  });

  it("blocks missing run id", async () => {
    expect((await run({ run_id: "" })).blocked_reason).toContain("run_id");
  });

  it("blocks missing evidence path", async () => {
    expect((await run({ evidence_path: "" })).blocked_reason).toContain("evidence_path");
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

  it("blocks apply/merge/deploy/patch/copy intent", async () => {
    expect((await run({ requested_implementation_intent: "apply_patch_now" })).blocked_reason).toContain("requested_implementation_intent");
    expect((await run({ user_note: "Please merge and deploy immediately." })).blocked_reason).toContain("cannot apply");
  });

  it("blocks missing safety constraints", async () => {
    expect((await run({ safety_constraints: [] })).blocked_reason).toContain("safety_constraints");
  });

  it("blocks contradictory safety constraints", async () => {
    expect((await run({ safety_constraints: ["Production mutation is allowed."] })).blocked_reason).toContain("contradictory");
  });

  it("writes plan artifact with lineage", async () => {
    const result = await run();
    const artifact = JSON.parse(await fs.readFile(result.plan_path, "utf8")) as typeof result.plan_artifact;

    expect(artifact).toEqual(result.plan_artifact);
    expect(artifact.implementation_request_id).toBe("impl-request-1");
    expect(artifact.approval_decision_id).toBe("approval-decision-1");
    expect(artifact.task_id).toBe("task-1");
    expect(artifact.run_id).toBe("run-1");
  });

  it("writes proposed test plan and risk notes", async () => {
    const result = await run();

    expect(result.plan_artifact.proposed_test_plan.join("\n")).toContain("word count");
    expect(result.plan_artifact.risk_impact_notes.join("\n")).toContain("Production file targets are not selected");
  });

  it("writes approval and mutation safety fields", async () => {
    const result = await run();

    expect(result.plan_artifact.approval_required_before_apply).toBe(true);
    expect(result.plan_artifact.production_mutation_allowed).toBe(false);
    expect(result.plan_artifact.explicit_non_actions).toContain("No files changed.");
  });

  it("does not mutate production files", async () => {
    const repoRoot = await tempRepo();
    const productionFile = path.join(repoRoot, "src", "production.ts");
    const prototypeFile = path.join(repoRoot, ".prototype-loop", "task-1", "word-count-cli.mjs");
    await fs.mkdir(path.dirname(productionFile), { recursive: true });
    await fs.mkdir(path.dirname(prototypeFile), { recursive: true });
    await fs.writeFile(productionFile, "production", "utf8");
    await fs.writeFile(prototypeFile, "prototype", "utf8");

    await runPrototypeImplementationPlanningV1(request(repoRoot), {
      repoRoot,
      now: new Date("2026-06-24T00:10:00.000Z"),
      planId: () => "implementation-plan-1",
    });

    await expect(fs.readFile(productionFile, "utf8")).resolves.toBe("production");
    await expect(fs.readFile(prototypeFile, "utf8")).resolves.toBe("prototype");
  });
});
