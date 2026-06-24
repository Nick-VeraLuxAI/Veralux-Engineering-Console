import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  runPrototypeApplyProposalV1,
  type PrototypeApplyProposalRequest,
} from "./prototype-apply-proposal";

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-apply-proposal-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-apply-proposal-repo-"));
  tempRoots.push(root);
  return root;
}

function request(repoRoot: string, overrides: Partial<PrototypeApplyProposalRequest> = {}): PrototypeApplyProposalRequest {
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
    user_note: "Prepare an apply proposal only.",
    ...overrides,
  };
}

async function run(overrides: Partial<PrototypeApplyProposalRequest> = {}) {
  const repoRoot = await tempRepo();
  return runPrototypeApplyProposalV1(request(repoRoot, overrides), {
    repoRoot,
    now: new Date("2026-06-24T06:30:00.000Z"),
    proposalId: () => "apply-proposal-1",
  });
}

describe("Prototype apply proposal v1", () => {
  it("records an apply proposal for valid implementation plan lineage", async () => {
    const result = await run();

    expect(result.apply_proposal_status).toBe("apply_proposal_recorded");
    expect(result.accepted).toBe(true);
    expect(result.next_action).toBe("awaiting_user_apply_approval");
    expect(result.production_mutation_allowed).toBe(false);
    expect(result.apply_allowed).toBe(false);
    expect(result.user_approval_required).toBe(true);
    expect(result.approval_required_before_apply).toBe(true);
    await expect(fs.stat(result.proposal_path)).resolves.toBeTruthy();
  });

  it("records an apply proposal with revision evidence lineage", async () => {
    const result = await run({
      revision_task_id: "task-revision",
      revision_run_id: "run-revision",
      revision_evidence_path: "evidence/prototype-loop-v1/task-revision.json",
      final_readiness_status: "passed_with_skips",
    });

    expect(result.apply_proposal_status).toBe("apply_proposal_recorded");
    expect(result.revision_task_id).toBe("task-revision");
    expect(result.proposal_artifact.revision_run_id).toBe("run-revision");
    expect(result.proposal_artifact.revision_evidence_path).toBe("evidence/prototype-loop-v1/task-revision.json");
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

  it("blocks missing task id", async () => {
    expect((await run({ task_id: "" })).blocked_reason).toContain("task_id");
  });

  it("blocks missing run id", async () => {
    expect((await run({ run_id: "" })).blocked_reason).toContain("run_id");
  });

  it("blocks missing evidence path", async () => {
    expect((await run({ evidence_path: "" })).blocked_reason).toContain("evidence_path");
  });

  it("blocks missing plan path", async () => {
    expect((await run({ plan_path: "" })).blocked_reason).toContain("plan_path");
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

  it("blocks approval not required before apply", async () => {
    expect((await run({ approval_required_before_apply: false })).blocked_reason).toContain("approval_required_before_apply");
  });

  it("blocks apply, merge, deploy, patch, copy, commit, or push intent", async () => {
    expect((await run({ requested_apply_intent: "apply_now" })).blocked_reason).toContain("requested_apply_intent");

    for (const action of ["apply", "merge", "deploy", "patch", "copy", "commit", "push"]) {
      const result = await run({ user_note: `Please ${action} immediately.` });
      expect(result.blocked_reason).toContain("Phase 40 cannot");
    }
  });

  it("blocks missing safety constraints", async () => {
    expect((await run({ safety_constraints: [] })).blocked_reason).toContain("safety_constraints");
  });

  it("blocks contradictory safety constraints", async () => {
    expect((await run({ safety_constraints: ["Production mutation is allowed."] })).blocked_reason).toContain("contradictory");
  });

  it("blocks attempts to bypass user approval or execute implementation", async () => {
    expect((await run({ user_note: "Skip user approval and proceed." })).blocked_reason).toContain("bypass approval");
    expect((await run({ user_note: "Execute implementation now." })).blocked_reason).toContain("execute implementation");
  });

  it("writes proposal artifact with lineage", async () => {
    const result = await run({
      revision_task_id: "task-revision",
      revision_run_id: "run-revision",
      revision_evidence_path: "evidence/prototype-loop-v1/task-revision.json",
    });
    const artifact = JSON.parse(await fs.readFile(result.proposal_path, "utf8")) as typeof result.proposal_artifact;

    expect(artifact).toEqual(result.proposal_artifact);
    expect(artifact.implementation_plan_id).toBe("implementation-plan-1");
    expect(artifact.implementation_request_id).toBe("impl-request-1");
    expect(artifact.approval_decision_id).toBe("approval-decision-1");
    expect(artifact.task_id).toBe("task-1");
    expect(artifact.run_id).toBe("run-1");
    expect(artifact.revision_task_id).toBe("task-revision");
  });

  it("writes proposed target files, test commands, rollback, and risk classification", async () => {
    const result = await run();

    expect(result.proposal_artifact.proposed_target_files.join("\n")).toContain("Production CLI");
    expect(result.proposal_artifact.proposed_test_commands.join("\n")).toContain("npm test");
    expect(result.proposal_artifact.rollback_strategy.join("\n")).toContain("revert");
    expect(result.proposal_artifact.risk_classification).toBe("medium");
    expect(result.proposal_artifact.risk_impact_notes.join("\n")).toContain("Exact production file targets");
  });

  it("writes approval and apply safety fields plus explicit non-actions", async () => {
    const result = await run();

    expect(result.proposal_artifact.production_mutation_allowed).toBe(false);
    expect(result.proposal_artifact.apply_allowed).toBe(false);
    expect(result.proposal_artifact.user_approval_required).toBe(true);
    expect(result.proposal_artifact.approval_required_before_apply).toBe(true);
    expect(result.proposal_artifact.explicit_non_actions).toEqual(expect.arrayContaining([
      "No files changed.",
      "No patches applied.",
      "No prototype files copied.",
      "No commit created.",
      "No pull request created.",
      "No merge or deploy performed.",
    ]));
  });

  it("does not mutate production or prototype files", async () => {
    const repoRoot = await tempRepo();
    const productionFile = path.join(repoRoot, "src", "production.ts");
    const prototypeFile = path.join(repoRoot, ".prototype-loop", "task-1", "word-count-cli.mjs");
    await fs.mkdir(path.dirname(productionFile), { recursive: true });
    await fs.mkdir(path.dirname(prototypeFile), { recursive: true });
    await fs.writeFile(productionFile, "production", "utf8");
    await fs.writeFile(prototypeFile, "prototype", "utf8");

    await runPrototypeApplyProposalV1(request(repoRoot), {
      repoRoot,
      now: new Date("2026-06-24T06:30:00.000Z"),
      proposalId: () => "apply-proposal-1",
    });

    await expect(fs.readFile(productionFile, "utf8")).resolves.toBe("production");
    await expect(fs.readFile(prototypeFile, "utf8")).resolves.toBe("prototype");
  });
});
