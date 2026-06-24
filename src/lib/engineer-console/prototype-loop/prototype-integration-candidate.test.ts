import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  runPrototypeIntegrationCandidateV1,
  type PrototypeIntegrationCandidateRequest,
} from "./prototype-integration-candidate";

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-integration-candidate-db-"));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-integration-candidate-repo-"));
  tempRoots.push(root);
  await fs.writeFile(path.join(root, ".gitignore"), "/.integration-candidates/\n", "utf8");
  return root;
}

function request(repoRoot: string, overrides: Partial<PrototypeIntegrationCandidateRequest> = {}): PrototypeIntegrationCandidateRequest {
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
    user_note: "Prepare integration candidate in isolated workspace only.",
    ...overrides,
  };
}

async function run(overrides: Partial<PrototypeIntegrationCandidateRequest> = {}) {
  const repoRoot = await tempRepo();
  return runPrototypeIntegrationCandidateV1(request(repoRoot, overrides), {
    repoRoot,
    now: new Date("2026-06-24T18:30:00.000Z"),
    integrationCandidateId: () => "integration-candidate-1",
  });
}

describe("Prototype integration candidate v1", () => {
  it("records an integration candidate for valid accepted controlled-apply review lineage", async () => {
    const result = await run();

    expect(result.integration_candidate_status).toBe("integration_candidate_recorded");
    expect(result.accepted).toBe(true);
    expect(result.workspace_path).toContain(`${path.sep}.integration-candidates${path.sep}integration-candidate-1`);
    expect(result.evidence_path).toContain(`${path.sep}evidence${path.sep}prototype-integration-candidates${path.sep}integration-candidate-1.json`);
    expect(result.files_changed).toEqual(expect.arrayContaining([
      "integration-candidate-manifest.json",
      "intended-production-targets.json",
      path.join("candidate-files", "word-count-cli.mjs"),
      path.join("candidate-files", "word-count-cli.test.mjs"),
      path.join("candidate-files", "sample.txt"),
    ]));
    expect(result.checks_passed).toBe(true);
    expect(result.review_required).toBe(true);
    expect(result.final_integration_approval_required).toBe(true);
    expect(result.main_tree_mutated).toBe(false);
    expect(result.merge_allowed).toBe(false);
    expect(result.deploy_allowed).toBe(false);
    expect(result.push_allowed).toBe(false);
    expect(result.pr_allowed).toBe(false);
    expect(result.commit_allowed).toBe(false);
    expect(result.production_mutation_allowed).toBe(false);
    await expect(fs.stat(path.join(result.workspace_path, "candidate-files", "word-count-cli.mjs"))).resolves.toBeTruthy();
  });

  it("records an integration candidate with revision evidence lineage", async () => {
    const result = await run({
      revision_task_id: "task-revision",
      revision_run_id: "run-revision",
      revision_evidence_path: "evidence/prototype-loop-v1/task-revision.json",
    });

    expect(result.integration_candidate_status).toBe("integration_candidate_recorded");
    expect(result.revision_task_id).toBe("task-revision");
    const evidence = JSON.parse(await fs.readFile(result.evidence_path, "utf8")) as typeof result;
    expect(evidence.revision_run_id).toBe("run-revision");
    expect(evidence.revision_evidence_path).toBe("evidence/prototype-loop-v1/task-revision.json");
  });

  it("blocks missing controlled apply review and controlled apply lineage", async () => {
    expect((await run({ controlled_apply_review_decision_id: "" })).blocked_reason).toContain("controlled_apply_review_decision_id");
    expect((await run({ controlled_apply_id: "" })).blocked_reason).toContain("controlled_apply_id");
    expect((await run({ controlled_apply_evidence_path: "" })).blocked_reason).toContain("controlled_apply_evidence_path");
    expect((await run({ controlled_apply_workspace_path: "" })).blocked_reason).toContain("controlled_apply_workspace_path");
  });

  it("blocks missing apply approval, proposal, plan, request, and approval ids", async () => {
    expect((await run({ apply_approval_decision_id: "" })).blocked_reason).toContain("apply_approval_decision_id");
    expect((await run({ apply_proposal_id: "" })).blocked_reason).toContain("apply_proposal_id");
    expect((await run({ implementation_plan_id: "" })).blocked_reason).toContain("implementation_plan_id");
    expect((await run({ implementation_request_id: "" })).blocked_reason).toContain("implementation_request_id");
    expect((await run({ approval_decision_id: "" })).blocked_reason).toContain("approval_decision_id");
  });

  it("blocks missing task/run/prototype evidence and plan/proposal paths", async () => {
    expect((await run({ task_id: "" })).blocked_reason).toContain("task_id");
    expect((await run({ run_id: "" })).blocked_reason).toContain("run_id");
    expect((await run({ prototype_evidence_path: "" })).blocked_reason).toContain("prototype_evidence_path");
    expect((await run({ plan_path: "" })).blocked_reason).toContain("plan_path");
    expect((await run({ proposal_path: "" })).blocked_reason).toContain("proposal_path");
  });

  it("blocks blocked or failed controlled apply status", async () => {
    expect((await run({ controlled_apply_status: "blocked" })).blocked_reason).toContain("blocked or failed");
    expect((await run({ controlled_apply_status: "failed" })).blocked_reason).toContain("blocked or failed");
  });

  it("blocks failed checks, missing review, or missing production integration intent", async () => {
    expect((await run({ checks_passed: false })).blocked_reason).toContain("checks_passed");
    expect((await run({ review_required: false })).blocked_reason).toContain("review_required");
    expect((await run({ production_integration_intent_recorded: false })).blocked_reason).toContain("production_integration_intent_recorded");
  });

  it("blocks unsafe integration, merge, deploy, PR, or production mutation flags", async () => {
    expect((await run({ integration_allowed: true })).blocked_reason).toContain("integration_allowed");
    expect((await run({ merge_allowed: true })).blocked_reason).toContain("merge_allowed");
    expect((await run({ deploy_allowed: true })).blocked_reason).toContain("deploy_allowed");
    expect((await run({ pr_allowed: true })).blocked_reason).toContain("pr_allowed");
    expect((await run({ production_mutation_allowed: true })).blocked_reason).toContain("production_mutation_allowed");
  });

  it("blocks wrong requested intent and missing safety constraints", async () => {
    expect((await run({ requested_integration_intent: "merge_to_main" })).blocked_reason).toContain("requested_integration_intent");
    expect((await run({ safety_constraints: [] })).blocked_reason).toContain("safety_constraints");
  });

  it("blocks merge, deploy, push, PR, commit, direct-main, or main-tree requests", async () => {
    for (const action of ["merge", "deploy", "push", "PR", "commit", "direct main", "main working tree"]) {
      const result = await run({ user_note: `Please ${action} now.` });
      expect(result.blocked_reason).toContain("Phase 46 cannot");
    }
  });

  it("blocks bypass attempts and contradictory safety constraints", async () => {
    expect((await run({ user_note: "bypass evidence" })).blocked_reason).toContain("cannot bypass");
    expect((await run({ user_note: "skip final approval" })).blocked_reason).toContain("cannot bypass");
    expect((await run({ safety_constraints: ["Production mutation is allowed."] })).blocked_reason).toContain("contradictory");
  });

  it("guards workspace path generation", async () => {
    const repoRoot = await tempRepo();

    await expect(runPrototypeIntegrationCandidateV1(request(repoRoot), {
      repoRoot,
      integrationCandidateId: () => "../escape",
    })).rejects.toThrow("integration_candidate_id");
  });

  it("keeps .integration-candidates gitignored", async () => {
    const gitignore = await fs.readFile(path.join(process.cwd(), ".gitignore"), "utf8");

    expect(gitignore).toContain("/.integration-candidates/");
  });

  it("writes evidence artifact with lineage, non-actions, and intended target metadata", async () => {
    const result = await run();
    const evidence = JSON.parse(await fs.readFile(result.evidence_path, "utf8")) as typeof result & {
      intended_production_targets: string[];
      workspace_manifest: { integration_candidate_id: string; intended_production_targets: string[] };
      explicit_non_actions: string[];
    };

    expect(evidence.integration_candidate_id).toBe("integration-candidate-1");
    expect(evidence.controlled_apply_review_decision_id).toBe("controlled-apply-review-decision-1");
    expect(evidence.controlled_apply_id).toBe("controlled-apply-1");
    expect(evidence.prototype_evidence_path).toContain("prototype-loop-v1");
    expect(evidence.intended_production_targets).toEqual(expect.arrayContaining([
      "src/prototypes/word-count-cli.mjs",
      "src/prototypes/word-count-cli.test.mjs",
    ]));
    expect(evidence.workspace_manifest.integration_candidate_id).toBe("integration-candidate-1");
    expect(evidence.explicit_non_actions).toEqual(expect.arrayContaining([
      "No main tree mutation.",
      "No production patch applied.",
      "No prototype files copied into production.",
      "No commit.",
      "No push.",
      "No pull request.",
      "No merge.",
      "No deploy.",
    ]));
  });

  it("records checks and final-review-required safety flags", async () => {
    const result = await run();

    expect(result.checks_run.map((check) => check.command)).toEqual([
      "node --check candidate-files/word-count-cli.mjs",
      "node --test candidate-files/word-count-cli.test.mjs",
    ]);
    expect(result.checks_run.every((check) => check.status === "passed")).toBe(true);
    expect(result.rollback_plan.steps.join("\n")).toContain("delete the .integration-candidates workspace");
    expect(result.review_required).toBe(true);
    expect(result.final_integration_approval_required).toBe(true);
    expect(result.main_tree_mutated).toBe(false);
  });

  it("records failed status when integration candidate workspace checks fail", async () => {
    const repoRoot = await tempRepo();
    const result = await runPrototypeIntegrationCandidateV1(request(repoRoot), {
      repoRoot,
      integrationCandidateId: () => "integration-candidate-1",
      commandRunner: async (_cwd, command) => ({
        command,
        status: command.includes("--test") ? "failed" : "passed",
        exitCode: command.includes("--test") ? 1 : 0,
        stdout: "",
        stderr: command.includes("--test") ? "test failed" : "",
        durationMs: 1,
      }),
    });

    expect(result.integration_candidate_status).toBe("failed");
    expect(result.accepted).toBe(false);
    expect(result.failure_reason).toContain("checks failed");
  });

  it("does not mutate the main working tree", async () => {
    const repoRoot = await tempRepo();
    const productionFile = path.join(repoRoot, "src", "production.ts");
    await fs.mkdir(path.dirname(productionFile), { recursive: true });
    await fs.writeFile(productionFile, "production", "utf8");

    const result = await runPrototypeIntegrationCandidateV1(request(repoRoot), {
      repoRoot,
      integrationCandidateId: () => "integration-candidate-1",
    });

    await expect(fs.readFile(productionFile, "utf8")).resolves.toBe("production");
    for (const changedFile of result.files_changed) {
      const changedPath = path.resolve(result.workspace_path, changedFile);
      expect(changedPath.startsWith(path.resolve(result.workspace_path))).toBe(true);
    }
    for (const intendedTarget of ["src/prototypes/word-count-cli.mjs", "src/prototypes/word-count-cli.test.mjs"]) {
      await expect(fs.stat(path.join(repoRoot, intendedTarget))).rejects.toThrow();
    }
  });
});
