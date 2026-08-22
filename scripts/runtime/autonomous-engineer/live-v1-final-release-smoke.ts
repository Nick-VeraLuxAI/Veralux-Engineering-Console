/**
 * V1 final-release live smoke: ordinary (not torture) engineering task.
 * FAITHFUL Nano @ 8082. SkillOpt capture+shadow ON, injection OFF.
 * Mutations stay in an isolated worktree. No PR/merge/deploy.
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
import { seedSkillOptCorpus } from "../../../src/lib/engineer-console/skillopt/seed-corpus";
import {
  listShadowRetrievals,
  listSkills,
} from "../../../src/lib/engineer-console/skillopt";
import { collectSkillOptMetrics } from "../../../src/lib/engineer-console/skillopt/skill-metrics";

const OBJECTIVE =
  "Directors need a one-line QC-versus-baseline sentence they can trust: new regressions, pre-existing failures, and resolved baseline items. Add a small tested helper that formats that sentence from counts already known to the autonomous loop, and keep the change inside the autonomous-engineer library. Do not open a PR or deploy.";

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL = "http://127.0.0.1:8082/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL = "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN = "262144";
  process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION = "true";
  delete process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET;
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(90 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "24";
  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ??= "8";
  process.env.ENGINEER_CONSOLE_SKILLOPT_CAPTURE = "true";
  process.env.ENGINEER_CONSOLE_SKILLOPT_EXTRACTION = "true";
  process.env.ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL = "true";
  process.env.ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION = "false";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  initializeEngineerConsoleDatabase();
  seedSkillOptCorpus();

  const repoPath = process.cwd();
  const task = createTask({
    title: "V1 final-release smoke: QC versus baseline director label",
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
      "Do not change SkillOpt injection (must remain off).",
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

  const outDir = path.join(process.cwd(), "evidence/ae-v1-final-release");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "live-smoke-start.json"),
    JSON.stringify(
      {
        runId: run.id,
        taskId: task.id,
        objective: OBJECTIVE,
        baseUrl: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL,
        faithful: process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION,
        skilloptInjection: process.env.ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ runId: run.id, taskId: task.id, status: "starting" }));

  const result = await executeAutonomousLoop(run.id);
  const state = getAutonomousState(run.id);
  const pkg = getAutonomousCompletionPackage(run.id);
  const plans = listWorkerPlansForRun(run.id);
  const shadows = listShadowRetrievals(run.id);
  const hashMismatches = shadows.filter((s) => s.promptHashBefore !== s.promptHashAfter);
  const injected = shadows.filter((s) => s.actuallyInjected);

  const proof = {
    at: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    objective: OBJECTIVE,
    taskId: task.id,
    runId: run.id,
    result,
    nanoRuntimeMode: state?.document.nanoRuntimeMode ?? null,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    workerModel: state?.document.workerModel,
    deliveryCandidateStatus: result.deliveryCandidateStatus,
    director: pkg?.director ?? null,
    worktree: pkg?.worktree ?? null,
    qcDelta: state?.document.qcDelta
      ? {
          new: state.document.qcDelta.newFailures.length,
          preExisting: state.document.qcDelta.preExistingFailures.length,
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
    skillopt: {
      capture: process.env.ENGINEER_CONSOLE_SKILLOPT_CAPTURE,
      extraction: process.env.ENGINEER_CONSOLE_SKILLOPT_EXTRACTION,
      shadowRetrieval: process.env.ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL,
      promptInjection: process.env.ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION,
      aePromptsModifiedBySkillOpt: injected.length,
      shadowRows: shadows.length,
      promptHashEqual: hashMismatches.length === 0,
      actuallyInjectedAny: injected.length > 0,
      matchedSkillIds: shadows.flatMap((s) => s.matchedSkillIds),
      snapshot: collectSkillOptMetrics(),
      validatedCount: listSkills({ status: "validated" }).length,
      candidateCount: listSkills({ status: "candidate" }).length,
    },
    humanCodingInterventions: 0,
  };

  const outFile = path.join(outDir, "live-smoke.json");
  fs.writeFileSync(outFile, JSON.stringify(proof, null, 2));
  console.log(
    JSON.stringify(
      {
        outFile,
        runId: run.id,
        state: result.state,
        delivery: result.deliveryCandidateStatus,
        nanoRuntimeMode: proof.nanoRuntimeMode,
        iterations: state?.document.iterationNumber,
        skilloptShadows: shadows.length,
        hashesEqual: proof.skillopt.promptHashEqual,
        actuallyInjected: proof.skillopt.actuallyInjectedAny,
      },
      null,
      2,
    ),
  );
}

void main();
