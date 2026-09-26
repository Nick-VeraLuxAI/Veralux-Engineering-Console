/**
 * Run Memory Module northstar milestones sequentially via live AE.
 *
 *   npx tsx scripts/runtime/autonomous-engineer/live-memory-module-northstar-loop.ts
 *   AE_NORTHSTAR_FROM=m03-explain-provenance npx tsx ...  # resume from milestone
 *   AE_NORTHSTAR_ONLY=m01-memory-taxonomy npx tsx ...     # single milestone
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { initializeEngineerConsoleDatabase } from "../../../src/lib/engineer-console/db/init";
import { createTask, updateTask } from "../../../src/lib/engineer-console/task-manager/task-manager";
import { createRun, updateRun } from "../../../src/lib/engineer-console/run-manager/run-manager";
import {
  createAutonomousState,
  getAutonomousState,
} from "../../../src/lib/engineer-console/autonomous-engineer/state-store";
import { executeAutonomousLoop } from "../../../src/lib/engineer-console/autonomous-engineer/loop";
import { getAutonomousCompletionPackage } from "../../../src/lib/engineer-console/autonomous-engineer/completion-package";
import { listWorkerPlansForRun } from "../../../src/lib/engineer-console/worker-plan/worker-plan-manager";
import { getRunWorktree } from "../../../src/lib/engineer-console/workspace/run-worktree";
import {
  NORTHSTAR_MEMORY_MILESTONES,
  type NorthstarMilestone,
} from "./northstar-memory-milestones";

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const MEMORY_MODULE =
  process.env.AE_TORTURE_REPO ??
  "/home/ndesantis/Documents/GitHub/Veralux-System/Memory-Module";

function configureEnv(): void {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8082/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS ??= "600000";
  process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN ??= "262144";
  process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION ??= "true";
  process.env.ENGINEER_CONSOLE_GOVERNANCE_MODE ??= "build";
  process.env.ENGINEER_CONSOLE_AE_MAX_PLANS ??= "12";
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(45 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "64";
  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ??= String(
    Number(process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ?? "12"),
  );
  process.env.ENGINEER_CONSOLE_AE_MAX_PLAN_REPAIRS ??= "15";
  process.env.ENGINEER_CONSOLE_AE_MAX_POST_REVIEW_REPAIRS ??= "8";
  process.env.ENGINEER_CONSOLE_DB_PATH =
    process.env.AE_NORTHSTAR_DB_PATH ??
    "/home/ndesantis/.veralux-engineering-console/engineer-console-northstar.db";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");
}

function selectMilestones(): NorthstarMilestone[] {
  const only = process.env.AE_NORTHSTAR_ONLY?.trim();
  if (only) {
    const hit = NORTHSTAR_MEMORY_MILESTONES.find((m) => m.id === only);
    if (!hit) throw new Error(`Unknown AE_NORTHSTAR_ONLY=${only}`);
    return [hit];
  }
  const from = process.env.AE_NORTHSTAR_FROM?.trim();
  if (from) {
    const idx = NORTHSTAR_MEMORY_MILESTONES.findIndex((m) => m.id === from);
    if (idx < 0) throw new Error(`Unknown AE_NORTHSTAR_FROM=${from}`);
    return NORTHSTAR_MEMORY_MILESTONES.slice(idx);
  }
  return NORTHSTAR_MEMORY_MILESTONES;
}

async function runMilestone(milestone: NorthstarMilestone): Promise<{
  ok: boolean;
  runId: string;
  proof: Record<string, unknown>;
}> {
  if (milestone.maxIterations) {
    process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS = String(milestone.maxIterations);
  }

  const task = createTask({
    title: `Northstar: ${milestone.title}`,
    description: milestone.objective,
    targetRepoPath: MEMORY_MODULE,
  });
  const started = Date.now();
  const run = createRun(task.id, "autonomous_engineer");
  createAutonomousState({
    runId: run.id,
    task,
    objective: milestone.objective,
    authorizedPathPrefixes: milestone.authorizedPathPrefixes,
    constraints: milestone.constraints,
    acceptanceCriteria: milestone.acceptanceCriteria,
  });
  updateTask(task.id, { status: "running" });
  updateRun(run.id, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: new Date().toISOString(),
  });

  console.log(JSON.stringify({ milestone: milestone.id, runId: run.id, status: "starting" }));

  const result = await executeAutonomousLoop(run.id);
  const state = getAutonomousState(run.id);
  const pkg = getAutonomousCompletionPackage(run.id);
  const plans = listWorkerPlansForRun(run.id);
  const wt = getRunWorktree(run.id);

  const ok = result.state === "waiting_for_approval";
  const proof: Record<string, unknown> = {
    milestoneId: milestone.id,
    milestoneTitle: milestone.title,
    elapsedMs: Date.now() - started,
    runId: run.id,
    taskId: task.id,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    failureClass: state?.failureClass ?? result.failureClass,
    deliveryCandidateStatus: state?.deliveryCandidateStatus ?? result.deliveryCandidateStatus,
    qcObjectivePassed: pkg?.qcDelta?.objectiveQcPassed ?? null,
    planCount: plans.length,
    worktreePath: wt?.worktreePath ?? null,
    seniorReviewStatus: state?.document.seniorReview?.latestStatus ?? null,
  };

  return { ok, runId: run.id, proof };
}

function mergeWorktreeToHost(worktreePath: string, hostRepo: string): void {
  for (const rel of ["src", "benchmark"]) {
    const from = path.join(worktreePath, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(hostRepo, rel);
    fs.cpSync(from, to, { recursive: true });
  }
  for (const file of ["package.json"]) {
    const from = path.join(worktreePath, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(hostRepo, file));
  }
}

async function main(): Promise<void> {
  configureEnv();

  if (!fs.existsSync(MEMORY_MODULE)) {
    throw new Error(`Memory-Module not found at ${MEMORY_MODULE}`);
  }

  const milestones = selectMilestones();
  initializeEngineerConsoleDatabase();

  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const summaryFile = path.join(outDir, "ae-memory-northstar-loop.json");
  const results: Record<string, unknown>[] = [];
  let failedAt: string | null = null;

  for (const milestone of milestones) {
    console.log(`\n========== ${milestone.id}: ${milestone.title} ==========\n`);
    const { ok, proof } = await runMilestone(milestone);
    results.push(proof);
    fs.writeFileSync(summaryFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));

    if (!ok) {
      failedAt = milestone.id;
      console.error(JSON.stringify({ failedAt, proof }, null, 2));
      process.exitCode = 2;
      break;
    }

    const wtPath = proof.worktreePath;
    if (typeof wtPath === "string" && fs.existsSync(wtPath)) {
      mergeWorktreeToHost(wtPath, MEMORY_MODULE);
      const verify = execSync("npm test && npm run typecheck", {
        cwd: MEMORY_MODULE,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      console.log(JSON.stringify({ mergedToHost: MEMORY_MODULE, verify: verify.slice(-200) }));
    }

    console.log(JSON.stringify({ passed: milestone.id, delivery: proof.deliveryCandidateStatus }));
  }

  if (!failedAt) {
    console.log(JSON.stringify({ status: "NORTHSTAR_COMPLETE", milestones: milestones.length, summaryFile }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
