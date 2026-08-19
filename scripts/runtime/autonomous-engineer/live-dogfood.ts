/**
 * Live Autonomous Engineer dogfood against Engineering Console.
 * Mutations stay in an isolated worktree. No PR, merge, or deploy.
 */
import fs from "fs";
import path from "path";
import { initializeEngineerConsoleDatabase } from "../../../src/lib/engineer-console/db/init";
import { createTask, updateTask } from "../../../src/lib/engineer-console/task-manager/task-manager";
import { createRun, updateRun } from "../../../src/lib/engineer-console/run-manager/run-manager";
import { createAutonomousState, getAutonomousState } from "../../../src/lib/engineer-console/autonomous-engineer/state-store";
import { executeAutonomousLoop } from "../../../src/lib/engineer-console/autonomous-engineer/loop";
import { getAutonomousCompletionPackage } from "../../../src/lib/engineer-console/autonomous-engineer/completion-package";
import { listWorkerPlansForRun } from "../../../src/lib/engineer-console/worker-plan/worker-plan-manager";

const OBJECTIVE =
  "Directors need a one-line QC-versus-baseline sentence they can trust: new regressions, pre-existing failures, and resolved baseline items. Add a small tested helper that formats that sentence from counts already known to the autonomous loop, and keep the change inside the autonomous-engineer library. Do not open a PR or deploy.";

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(90 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "32";
  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ??= "10";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  initializeEngineerConsoleDatabase();
  const repoPath = process.cwd();
  const task = createTask({
    title: "QC versus baseline director label",
    description: OBJECTIVE,
    targetRepoPath: repoPath,
  });
  const started = Date.now();
  const run = createRun(task.id, "autonomous_engineer");
  createAutonomousState({
    runId: run.id,
    task,
    objective: OBJECTIVE,
    authorizedPathPrefixes: ["src/lib/engineer-console/autonomous-engineer/"],
    constraints: [
      "Stay inside the autonomous-engineer library.",
      "Do not change PR, merge, or deploy behavior.",
      "Do not modify Super/AirLLM experimental code.",
    ],
    acceptanceCriteria: [
      "A reusable helper formats a QC-versus-baseline sentence from new, pre-existing, and resolved counts.",
      "Unit tests cover empty, new-regression, and pre-existing-only cases.",
      "No pull request is created.",
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
  fs.writeFileSync(
    path.join(outDir, "ae-v1-live-dogfood-run.json"),
    JSON.stringify({ runId: run.id, taskId: task.id, objective: OBJECTIVE }, null, 2),
  );
  console.log(JSON.stringify({ runId: run.id, taskId: task.id, status: "starting" }));
  const result = await executeAutonomousLoop(run.id);
  const runId = run.id;
  const state = getAutonomousState(runId);
  const pkg = getAutonomousCompletionPackage(runId);
  const plans = listWorkerPlansForRun(runId);
  const proof = {
    at: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    objective: OBJECTIVE,
    taskId: task.id,
    runId,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    workerModel: state?.document.workerModel,
    priorAttempts: state?.document.priorAttempts,
    failedHypotheses: state?.document.failedHypotheses,
    diagnosis: state?.document.diagnosis
      ? {
          whyPreviousFailed: state.document.diagnosis.whyPreviousFailed,
          suggestedStrategy: state.document.diagnosis.suggestedStrategy,
        }
      : null,
    qcBaselineFailureCount: state?.document.qcBaseline?.failures.length ?? 0,
    qcDelta: state?.document.qcDelta
      ? {
          new: state.document.qcDelta.newFailures.length,
          preExisting: state.document.qcDelta.preExistingFailures.length,
          changed: state.document.qcDelta.changedFailures.length,
          resolved: state.document.qcDelta.resolvedBaselineFailures.length,
          owned: state.document.qcDelta.ownedIterationFailures.length,
          objectiveQcPassed: state.document.qcDelta.objectiveQcPassed,
        }
      : null,
    plans: plans.map((plan) => ({
      id: plan.id,
      summary: plan.summary,
      iterationNumber: plan.iterationNumber,
      validationStatus: plan.validationStatus,
      executionStatus: plan.executionStatus,
    })),
    director: pkg?.director ?? null,
    deliveryCandidateStatus: result.deliveryCandidateStatus,
    worktree: pkg?.worktree ?? null,
  };
  const outFile = path.join(outDir, "ae-v1-live-dogfood.json");
  fs.writeFileSync(outFile, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({
    outFile,
    runId,
    state: result.state,
    delivery: result.deliveryCandidateStatus,
    worker: state?.document.workerModel?.modelName,
    provider: state?.document.workerModel?.providerName,
    iterations: state?.document.iterationNumber,
  }, null, 2));
}

void main();
