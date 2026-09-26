/**
 * Live torture: bounded Memory-Module delivery against FAITHFUL Nano @ 8082.
 * Proves AE can reach waiting_for_approval on a real TypeScript repo.
 *
 *   npx tsx scripts/runtime/autonomous-engineer/live-memory-module-torture.ts
 */
import fs from "fs";
import path from "path";
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

const MEMORY_MODULE =
  process.env.AE_TORTURE_REPO ??
  "/home/ndesantis/Documents/GitHub/Veralux-System/Memory-Module";

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

const OBJECTIVE = `Add a tiny Memory Module version export on the existing TypeScript scaffold.

Required:
- Create src/version.ts that exports const MEMORY_MODULE_VERSION = "0.1.0" as a string.
- Export MEMORY_MODULE_VERSION from src/index.ts.
- Add src/version.test.ts with a vitest that asserts MEMORY_MODULE_VERSION === "0.1.0".
- Do not modify event-log, memory-record-store, context-assembler, or contracts.ts.
- npm test and npm run typecheck must pass.

Constraints:
- Do not create PR, merge, or deploy.
- Stay inside src/ only.
- Keep existing tests green.`;

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8082/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS ??= "600000";
  process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN ??= "262144";
  process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION ??= "true";
  process.env.ENGINEER_CONSOLE_GOVERNANCE_MODE ??= "build";
  process.env.ENGINEER_CONSOLE_AE_MAX_PLANS ??= "10";
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(30 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "24";
  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ??= "6";
  process.env.ENGINEER_CONSOLE_AE_MAX_PLAN_REPAIRS ??= "8";
  process.env.ENGINEER_CONSOLE_DB_PATH ??=
    "/home/ndesantis/.veralux-engineering-console/engineer-console-torture.db";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  if (!fs.existsSync(MEMORY_MODULE)) {
    throw new Error(`Memory-Module not found at ${MEMORY_MODULE}`);
  }

  initializeEngineerConsoleDatabase();
  const task = createTask({
    title: "Memory Module version export (torture)",
    description: OBJECTIVE,
    targetRepoPath: MEMORY_MODULE,
  });
  const started = Date.now();
  const run = createRun(task.id, "autonomous_engineer");
  createAutonomousState({
    runId: run.id,
    task,
    objective: OBJECTIVE,
    authorizedPathPrefixes: ["src/"],
    constraints: [
      "Do not create PR, merge, or deploy.",
      "Do not modify event-log, memory-record-store, context-assembler, or contracts.ts.",
      "Keep existing tests green.",
    ],
    acceptanceCriteria: [
      "src/version.ts exports MEMORY_MODULE_VERSION = \"0.1.0\"",
      "src/index.ts re-exports MEMORY_MODULE_VERSION",
      "vitest asserts the version string",
      "npm test and typecheck exit 0",
    ],
  });
  updateTask(task.id, { status: "running" });
  updateRun(run.id, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: new Date().toISOString(),
  });

  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "ae-memory-module-torture.json");
  console.log(JSON.stringify({ runId: run.id, taskId: task.id, repo: MEMORY_MODULE, status: "starting" }));

  const result = await executeAutonomousLoop(run.id);
  const state = getAutonomousState(run.id);
  const pkg = getAutonomousCompletionPackage(run.id);
  const plans = listWorkerPlansForRun(run.id);
  const wt = getRunWorktree(run.id);

  const proof = {
    at: new Date().toISOString(),
    kind: "memory-module-torture",
    elapsedMs: Date.now() - started,
    nanoBaseUrl: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL,
    maxModelLen: process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN,
    governanceMode: process.env.ENGINEER_CONSOLE_GOVERNANCE_MODE,
    runId: run.id,
    taskId: task.id,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    failureClass: state?.failureClass ?? result.failureClass,
    deliveryCandidateStatus: state?.deliveryCandidateStatus ?? result.deliveryCandidateStatus,
    nanoRuntimeMode: state?.document.nanoRuntimeMode ?? null,
    completionComplete: pkg?.completionEvaluation?.complete ?? null,
    unmetAcceptanceCriteria: pkg?.completionEvaluation?.unmetAcceptanceCriteria ?? [],
    qcObjectivePassed: pkg?.qcDelta?.objectiveQcPassed ?? null,
    qcSkippedCount: pkg?.qcDelta?.skipped?.length ?? null,
    planCount: plans.length,
    worktreePath: wt?.worktreePath ?? null,
    worktreeSrc: wt?.worktreePath
      ? fs.existsSync(path.join(wt.worktreePath, "src"))
        ? fs.readdirSync(path.join(wt.worktreePath, "src"))
        : []
      : [],
  };

  fs.writeFileSync(outFile, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ status: "done", outFile, ...proof }, null, 2));

  if (result.state !== "waiting_for_approval") {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
