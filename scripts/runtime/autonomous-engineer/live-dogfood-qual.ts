/**
 * Qualification live dogfood — distinct objective for release torture.
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
  "Directors need a tiny pure helper that turns a boolean deliveryCandidateReady flag into the exact director label 'ready' or 'not ready'. Add a small tested helper inside the autonomous-engineer library only. Do not open a PR or deploy.";

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(90 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "32";
  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ??= "8";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  initializeEngineerConsoleDatabase();
  const repoPath = process.cwd();
  const task = createTask({
    title: "Delivery candidate label helper",
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
      "Prefer create_file for a new small helper + Vitest test. Do not rewrite large modules.",
    ],
    acceptanceCriteria: [
      "A reusable helper maps deliveryCandidateReady boolean to 'ready' or 'not ready'.",
      "Unit tests cover both boolean cases.",
      "No pull request is created.",
    ],
  });
  updateTask(task.id, { status: "running" });
  updateRun(run.id, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ runId: run.id, taskId: task.id, status: "starting" }));
  const result = await executeAutonomousLoop(run.id);
  const state = getAutonomousState(run.id);
  const pkg = getAutonomousCompletionPackage(run.id);
  const plans = listWorkerPlansForRun(run.id);
  const proof = {
    at: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    objective: OBJECTIVE,
    taskId: task.id,
    runId: run.id,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    workerModel: state?.document.workerModel
      ? {
          route: state.document.workerModel.route,
          providerName: state.document.workerModel.providerName,
          modelName: state.document.workerModel.modelName,
          mockBypassed: state.document.workerModel.mockBypassed,
          rolesInvoked: state.document.workerModel.rolesInvoked,
        }
      : null,
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
  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "ae-v1-qual-live-dogfood.json");
  fs.writeFileSync(outFile, JSON.stringify(proof, null, 2));
  console.log(
    JSON.stringify(
      {
        outFile,
        runId: run.id,
        state: result.state,
        delivery: result.deliveryCandidateStatus,
        worker: state?.document.workerModel?.modelName,
        provider: state?.document.workerModel?.providerName,
        iterations: state?.document.iterationNumber,
        newFailures: proof.qcDelta?.new,
      },
      null,
      2,
    ),
  );
  if (result.deliveryCandidateStatus !== "ready") process.exitCode = 1;
}

void main();
