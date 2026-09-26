/**
 * Controlled robust-code / bad-code remediation qualification (injected plans).
 * Live Nano specimens run via scripts/runtime/autonomous-engineer/live-robust-qual.ts
 */
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createTask } from "../task-manager/task-manager";
import { getRunWorktree } from "../workspace/run-worktree";
import { startAutonomousRun } from "./start-autonomous-run";
import { getAutonomousState } from "./state-store";
import { mergeWorkerAdversarialReview, runAutonomousReviews } from "./reviews";
import { evaluateCompletion } from "./completion-evaluator";
import { buildAuthorityEnvelope } from "./authority";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import type { AutonomousDocument } from "./types";
import type { EngineeringTask } from "../types";

let tmpDb: string;
let repoRoot: string;
let worktreeRoot: string;

function initRepo(dir: string, files: Record<string, string>): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "ae-robust-qual", scripts: { test: "node test.js" } }),
  );
  fs.writeFileSync(
    path.join(dir, "test.js"),
    [
      "const fs = require('fs');",
      "const path = require('path');",
      "try {",
      "  const v = fs.readFileSync(path.join(__dirname, 'src/ready.txt'), 'utf8').trim();",
      "  process.exit(v === 'ok' ? 0 : 1);",
      "} catch {",
      "  process.exit(1);",
      "}",
      "",
    ].join("\n"),
  );
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
}

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-ae-robust-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ae-robust-wt-"));
  process.env.ENGINEER_CONSOLE_WORKTREE_ROOT = worktreeRoot;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ae-robust-repo-"));
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (fs.existsSync(worktreeRoot)) fs.rmSync(worktreeRoot, { recursive: true, force: true });
  if (fs.existsSync(repoRoot)) fs.rmSync(repoRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_WORKTREE_ROOT;
});

function plan(runId: string, ops: WorkerPlan["operations"], summary: string): WorkerPlan {
  return {
    runId,
    summary,
    allowedFiles: ops.map((op) => op.path),
    operations: ops,
  };
}

function baseDoc(task: EngineeringTask, prefixes: string[]): AutonomousDocument {
  return {
    version: 1,
    mode: "autonomous_engineer",
    originalObjective: "objective",
    interpretedObjective: {
      objectiveSummary: "objective",
      requirements: ["req"],
      acceptanceCriteria: ["ac"],
      constraints: [],
      assumptions: [],
      unknowns: [],
      clarificationRequired: false,
      clarificationQuestions: [],
      initialInvestigationTargets: [],
    },
    requirements: ["req"],
    acceptanceCriteria: ["ac"],
    constraints: [],
    assumptions: [],
    authorizedRepoPath: task.targetRepoPath ?? "/tmp/r",
    authorizedPathPrefixes: prefixes,
    authorityEnvelope: buildAuthorityEnvelope(task, prefixes),
    currentState: "reviewing",
    iterationNumber: 1,
    budget: {
      max_iterations: 2,
      max_plans: 2,
      max_model_calls: 4,
      max_changed_files: 10,
      max_changed_bytes: 10_000,
      max_runtime_ms: 10_000,
      max_investigation_reads: 10,
      max_context_bytes: 10_000,
    },
    usage: {
      iterations: 1,
      plans: 1,
      modelCalls: 1,
      changedFiles: 1,
      changedBytes: 10,
      runtimeMs: 1,
      investigationReads: 1,
      contextBytes: 10,
      planRepairs: 0,
      postReviewRepairs: 0,
    },
    strategy: null,
    observations: [],
    decisions: [],
    priorAttempts: [],
    failedHypotheses: [],
    currentPlanId: null,
    previousPlanId: null,
    qcObservations: [],
    qcBaseline: null,
    qcDelta: null,
    workerModel: null,
    unresolvedDefects: [],
    openRisks: [],
    clarification: null,
    escalationReason: null,
    failureClass: null,
    completionEvaluation: null,
    deliveryCandidateStatus: "pending",
    reviews: [],
    diagnosis: null,
    worktreeId: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pausedAt: null,
    directorAbortReason: null,
  };
}

describe("AE robust qualification — controlled scenarios", () => {
  it("S2/S13: workaround + empty-catch delivery is blocked by engineering_quality review", async () => {
    initRepo(repoRoot, {
      "src/legacy.ts": "export function apply(x){ return x }\n",
    });
    const task = createTask({
      title: "Repair ledger",
      description: "Make apply reliable.",
      targetRepoPath: repoRoot,
    });
    let calls = 0;
    const { runId } = await startAutonomousRun(
      { taskId: task.id },
      {
        generatePlan: async ({ runId: id }) => {
          calls += 1;
          if (calls === 1) {
            return plan(
              id,
              [
                {
                  type: "create_file",
                  path: "src/ready.txt",
                  content: "ok\n",
                  reason: "tests",
                },
                {
                  type: "update_file",
                  path: "src/legacy.ts",
                  content:
                    "// WORKAROUND until tests pass\nexport function apply(x){ try { return x } catch { } }\n",
                  reason: "stack hack",
                },
              ],
              "Stack workaround",
            );
          }
          return plan(
            id,
            [
              {
                type: "update_file",
                path: "src/ready.txt",
                content: "ok\n",
                reason: "keep tests",
              },
              {
                type: "update_file",
                path: "src/legacy.ts",
                content:
                  "export function apply(x){\n  if (x == null) throw new Error('invalid');\n  return { ok: true, value: x };\n}\n",
                reason: "repair underlying design",
              },
            ],
            "Repair underlying defect",
          );
        },
      },
    );
    const state = getAutonomousState(runId);
    expect(state?.currentState).toBe("waiting_for_approval");
    expect(state?.document.deliveryCandidateStatus).toBe("ready");
    expect(calls).toBeGreaterThanOrEqual(2);
    const wt = getRunWorktree(runId);
    const legacy = fs.readFileSync(path.join(wt!.worktreePath, "src/legacy.ts"), "utf8");
    expect(legacy).not.toMatch(/WORKAROUND/);
    expect(legacy).not.toMatch(/catch\s*\{\s*\}/);
  });

  it("S3/S8/S13: success-fallback auth is blocked then repaired fail-closed", async () => {
    initRepo(repoRoot, {});
    const task = createTask({
      title: "Auth helper",
      description: "Authorize actions fail-closed.",
      targetRepoPath: repoRoot,
    });
    let calls = 0;
    const { runId } = await startAutonomousRun(
      { taskId: task.id },
      {
        generatePlan: async ({ runId: id }) => {
          calls += 1;
          if (calls === 1) {
            return plan(
              id,
              [
                {
                  type: "create_file",
                  path: "src/ready.txt",
                  content: "ok\n",
                  reason: "green tests",
                },
                {
                  type: "create_file",
                  path: "src/authorize.ts",
                  content:
                    "export function authorize(user, action){ try { return user.roles.includes(action) } catch { return true } }\n",
                  reason: "hidden success fallback",
                },
              ],
              "Green but wrong auth",
            );
          }
          return plan(
            id,
            [
              {
                type: "update_file",
                path: "src/ready.txt",
                content: "ok\n",
                reason: "keep",
              },
              {
                type: "update_file",
                path: "src/authorize.ts",
                content:
                  "export function authorize(user, action){\n  if (!user || !Array.isArray(user.roles)) return false;\n  return user.roles.includes(action);\n}\n",
                reason: "fail closed",
              },
            ],
            "Repair fail-closed auth",
          );
        },
      },
    );
    const state = getAutonomousState(runId);
    expect(state?.currentState).toBe("waiting_for_approval");
    expect(calls).toBeGreaterThanOrEqual(2);
    const auth = fs.readFileSync(path.join(getRunWorktree(runId)!.worktreePath, "src/authorize.ts"), "utf8");
    expect(auth).not.toMatch(/catch\s*\{[^}]*return true/);
    expect(auth).toMatch(/return false/);
  });

  it("S12: unrelated smell is recorded as open risk without forcing out-of-scope mutation", () => {
    const task: EngineeringTask = {
      id: "t",
      title: "t",
      description: "d",
      targetRepoPath: "/tmp/r",
      registeredRepoId: null,
      status: "draft",
      priority: "normal",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const document = baseDoc(task, ["src/feature/"]);
    document.openRisks = [
      {
        id: "recorded-unrelated",
        summary: "Unrelated smell in src/other/legacy.ts recorded, not touched",
        class: "scope",
      },
    ];
    const reviews = runAutonomousReviews({
      document,
      changedFiles: ["src/feature/a.ts"],
      diffSummary: "feature only",
      qcPassed: true,
      fileContents: { "src/feature/a.ts": "export const a = 1;\n" },
    });
    expect(reviews.find((r) => r.review === "scope")?.passed).toBe(true);
    expect(document.openRisks[0]?.summary).toMatch(/Unrelated smell/);
  });

  it("S3 merge path: adversarial defect prevents completion until cleared", () => {
    const task: EngineeringTask = {
      id: "t2",
      title: "t",
      description: "d",
      targetRepoPath: "/tmp/r",
      registeredRepoId: null,
      status: "draft",
      priority: "normal",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const document = baseDoc(task, ["src/"]);
    const base = runAutonomousReviews({
      document,
      changedFiles: ["src/ledger.ts"],
      diffSummary: "ledger",
      qcPassed: true,
      fileContents: { "src/ledger.ts": "export const ok = true;\n" },
    });
    const blocked = mergeWorkerAdversarialReview(base, {
      passed: false,
      findings: ["lost update under concurrent apply"],
      actionableDefects: ["Race: shared transfer state mutated without revision check under concurrent transfer"],
    });
    const incomplete = evaluateCompletion({
      document,
      qcPassed: true,
      changedFiles: ["src/ledger.ts"],
      reviews: blocked,
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.defectsBlocking.join(" ")).toMatch(/Race/);
  });
});
