import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createTask } from "../task-manager/task-manager";
import { getRunById } from "../run-manager/run-manager";
import { listWorkerPlansForRun } from "../worker-plan/worker-plan-manager";
import { getChangedFiles } from "../workspace/git-workspace";
import { createIsolatedRunWorktree, cleanupRunWorktree, WorktreeCleanupError } from "../workspace/run-worktree";
import { startAutonomousRun } from "./start-autonomous-run";
import { answerClarificationAndResume } from "./clarification";
import { getAutonomousState } from "./state-store";
import { getAutonomousCompletionPackage } from "./completion-package";
import { assertExecutorCannotSelfAuthorize } from "./authority";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { handleApprovalAction } from "../orchestrator/run-orchestrator";

let tmpDb: string;
let repoRoot: string;
let worktreeRoot: string;

function initRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "ae-specimen",
      scripts: { test: "node test.js" },
    }),
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
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
}

function passingPlan(runId: string): WorkerPlan {
  return {
    runId,
    summary: "Mark ready.txt ok",
    allowedFiles: ["src/ready.txt"],
    operations: [
      {
        type: "create_file",
        path: "src/ready.txt",
        content: "ok\n",
        reason: "Satisfy the specimen test",
      },
    ],
  };
}

function failingPlan(runId: string): WorkerPlan {
  return {
    runId,
    summary: "Mark ready.txt no",
    allowedFiles: ["src/ready.txt"],
    operations: [
      {
        type: "create_file",
        path: "src/ready.txt",
        content: "no\n",
        reason: "Incorrect first hypothesis",
      },
    ],
  };
}

function repairPlan(runId: string): WorkerPlan {
  return {
    runId,
    summary: "Repair ready.txt to ok",
    allowedFiles: ["src/ready.txt"],
    operations: [
      {
        type: "update_file",
        path: "src/ready.txt",
        content: "ok\n",
        reason: "Address previous QC failure",
      },
    ],
  };
}

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-ae-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ae-wt-"));
  process.env.ENGINEER_CONSOLE_WORKTREE_ROOT = worktreeRoot;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ae-repo-"));
  initRepo(repoRoot);
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

describe("autonomous engineer integration", () => {
  it("objective → plan → execute → QC pass → delivery candidate", async () => {
    const task = createTask({
      title: "Ready flag",
      description: "Add src/ready.txt so the test script passes.",
      targetRepoPath: repoRoot,
    });
    const { runId, result } = await startAutonomousRun(
      { taskId: task.id },
      { generatePlan: async ({ runId: id }) => passingPlan(id) },
    );
    expect(result.state).toBe("waiting_for_approval");
    expect(result.deliveryCandidateStatus).toBe("ready");
    const run = getRunById(runId);
    expect(run?.status).toBe("waiting_for_approval");
    expect(fs.existsSync(path.join(repoRoot, "src/ready.txt"))).toBe(false);
    const pkg = getAutonomousCompletionPackage(runId);
    expect(pkg?.completionEvaluation?.complete).toBe(true);
    expect(pkg?.authorityEnvelope.canSelfApprove).toBe(false);
    expect(pkg?.qcBaseline).toBeTruthy();
    expect(pkg?.director.objectiveResult).toBe("SATISFIED");
    expect(pkg?.director.nextAction).toBe("Authorize PR");
  });

  it("failing first attempt persists observation, diagnoses, replans, and passes", async () => {
    const task = createTask({
      title: "Ready flag",
      description: "Add src/ready.txt so the test script passes.",
      targetRepoPath: repoRoot,
    });
    let calls = 0;
    const { runId, result } = await startAutonomousRun(
      { taskId: task.id },
      {
        generatePlan: async ({ runId: id }) => {
          calls += 1;
          return calls === 1 ? failingPlan(id) : repairPlan(id);
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.state).toBe("waiting_for_approval");
    const state = getAutonomousState(runId)!;
    expect(state.document.priorAttempts.length).toBeGreaterThanOrEqual(2);
    expect(state.document.priorAttempts[0]?.outcome).toBe("failed");
    expect(state.document.qcObservations[0]?.passed).toBe(false);
    expect(state.document.diagnosis?.whyPreviousFailed).toBeTruthy();
    expect(state.document.failedHypotheses.length).toBeGreaterThan(0);
    const plans = listWorkerPlansForRun(runId);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.some((plan) => plan.iterationNumber === 1)).toBe(true);
    expect(plans.some((plan) => plan.iterationNumber === 2)).toBe(true);
    expect(getRunById(runId)?.status).not.toBe("failed");
    expect(state.document.priorAttempts[0]?.failureClass).toBe("ENGINEERING_FAILURE");
  });

  it("Case 5: pre-existing repo-wide QC failure plus objective pass is a delivery candidate", async () => {
    fs.writeFileSync(
      path.join(repoRoot, "typecheck.js"),
      "console.error(\"src/lib/legacy.ts(1,1): error TS2307: Cannot find module 'airllm'.\");\nprocess.exit(1);\n",
    );
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "ae-specimen",
        scripts: {
          test: "node test.js",
          typecheck: "node typecheck.js",
        },
      }),
    );
    execSync("git add package.json typecheck.js", { cwd: repoRoot, stdio: "ignore" });
    execSync('git commit -m "add pre-existing typecheck failure"', { cwd: repoRoot, stdio: "ignore" });

    const task = createTask({
      title: "Ready flag",
      description: "Add src/ready.txt so the test script passes.",
      targetRepoPath: repoRoot,
    });
    const { runId, result } = await startAutonomousRun(
      { taskId: task.id },
      { generatePlan: async ({ runId: id }) => passingPlan(id) },
    );
    expect(result.state).toBe("waiting_for_approval");
    const pkg = getAutonomousCompletionPackage(runId);
    expect(pkg?.qcDelta?.preExistingFailures.length).toBeGreaterThan(0);
    expect(pkg?.qcDelta?.newFailures ?? []).toHaveLength(0);
    expect(pkg?.qcDelta?.objectiveQcPassed).toBe(true);
    expect(pkg?.director.objectiveResult).toBe("SATISFIED");
    expect(pkg?.openRisks.length).toBeGreaterThan(0);
  });

  it("discoverable uncertainty is investigated without a human question", async () => {
    const task = createTask({
      title: "Ready flag",
      description: "Add src/ready.txt so tests pass. What test scripts exist?",
      targetRepoPath: repoRoot,
    });
    const { result } = await startAutonomousRun(
      { taskId: task.id },
      { generatePlan: async ({ runId }) => passingPlan(runId) },
    );
    expect(result.state).not.toBe("waiting_for_director");
    expect(result.state).toBe("waiting_for_approval");
  });

  it("genuine product decision waits for director then resumes the same run", async () => {
    const task = createTask({
      title: "Ready flag",
      description:
        "Add src/ready.txt so tests pass. Should the public export be named foo or bar?",
      targetRepoPath: repoRoot,
    });
    const { runId, result } = await startAutonomousRun(
      { taskId: task.id },
      { generatePlan: async ({ runId: id }) => passingPlan(id) },
    );
    expect(result.state).toBe("waiting_for_director");
    expect(result.paused).toBe(true);
    const paused = getAutonomousState(runId)!;
    expect(paused.document.clarification?.question).toMatch(/foo or bar/i);

    const resumed = await answerClarificationAndResume(
      { runId, answer: "bar", actorLabel: "director" },
      { generatePlan: async ({ runId: id }) => passingPlan(id) },
    );
    expect(resumed.state).toBe("waiting_for_approval");
    expect(getAutonomousState(runId)?.runId).toBe(runId);
    expect(getAutonomousState(runId)?.document.clarification?.answer).toBe("bar");
  });

  it("protected governance action is blocked and executor cannot self-authorize", async () => {
    const task = createTask({
      title: "Ready flag",
      description: "Add src/ready.txt and merge this to main.",
      targetRepoPath: repoRoot,
    });
    const { runId, result } = await startAutonomousRun(
      { taskId: task.id },
      { generatePlan: async ({ runId: id }) => passingPlan(id) },
    );
    expect(result.failureClass).toBe("GOVERNANCE_AUTHORIZATION_REQUIRED");
    expect(result.state).toBe("failed");
    const state = getAutonomousState(runId)!;
    expect(assertExecutorCannotSelfAuthorize(state.document.authorityEnvelope, "merge").allowed).toBe(
      false,
    );
    await expect(handleApprovalAction(runId, "approve", { rationale: "self" })).rejects.toThrow();
  });

  it("two runs get two worktrees with no cross-run mutation of the director tree", async () => {
    const taskA = createTask({ title: "A", description: "Add src/ready.txt", targetRepoPath: repoRoot });
    const taskB = createTask({ title: "B", description: "Add src/ready.txt", targetRepoPath: repoRoot });
    const headBefore = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();

    const [a, b] = await Promise.all([
      startAutonomousRun(
        { taskId: taskA.id },
        { generatePlan: async ({ runId }) => passingPlan(runId) },
      ),
      startAutonomousRun(
        { taskId: taskB.id },
        { generatePlan: async ({ runId }) => passingPlan(runId) },
      ),
    ]);

    const wtA = getAutonomousCompletionPackage(a.runId)?.worktree?.path;
    const wtB = getAutonomousCompletionPackage(b.runId)?.worktree?.path;
    expect(wtA).toBeTruthy();
    expect(wtB).toBeTruthy();
    expect(wtA).not.toBe(wtB);
    expect(fs.existsSync(path.join(wtA!, "src/ready.txt"))).toBe(true);
    expect(fs.existsSync(path.join(wtB!, "src/ready.txt"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "src/ready.txt"))).toBe(false);
    const headAfter = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    expect(headAfter).toBe(headBefore);
    const mainChanged = await getChangedFiles(repoRoot);
    expect(mainChanged).not.toContain("src/ready.txt");
  });
});

describe("worktree isolation cleanup", () => {
  it("refuses to silently delete unrecorded dirty work", async () => {
    const task = createTask({ title: "WT", description: "iso", targetRepoPath: repoRoot });
    const { createRun } = await import("../run-manager/run-manager");
    const run = createRun(task.id);
    const record = await createIsolatedRunWorktree({
      runId: run.id,
      taskId: task.id,
      repoPath: repoRoot,
    });
    fs.writeFileSync(path.join(record.worktreePath, "scratch.txt"), "dirty");
    await expect(cleanupRunWorktree(run.id)).rejects.toBeInstanceOf(WorktreeCleanupError);
    expect(fs.existsSync(record.worktreePath)).toBe(true);
  });
});
