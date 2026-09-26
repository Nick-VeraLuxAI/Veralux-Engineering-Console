/**
 * Full robust engineering requalification runner (FAITHFUL Nano).
 *
 * Usage:
 *   npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts --hard
 *   npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts --matrix
 *   npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts --only=passing_wrong_auth
 *   npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts --hard --only-hard=bad_legacy_ledger
 */
import fs from "fs";
import os from "os";
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
import { resolveNanoRuntimeMode } from "../../../src/lib/engineer-console/autonomous-engineer/nano-faithful-invocation";
import {
  MATRIX_SPECIMENS,
  matrixCoverageIds,
  specimensForHardClass,
  type SpecimenDef,
} from "./robust-requal-specimens";

export type PrimaryFailureCategory =
  | "SUCCESS"
  | "GENERATION_BUDGET_EXHAUSTED"
  | "PLAN_REPAIR_EXHAUSTED"
  | "PRIMARY_QC_NONCONVERGENCE"
  | "POST_REVIEW_REPAIR_EXHAUSTED"
  | "MATERIAL_REVIEW_BLOCK"
  | "MODEL_OUTPUT_SCHEMA_FAILURE"
  | "AUTHORITY/POLICY_BLOCK"
  | "ENVIRONMENT_FAILURE"
  | "INVALID_QUALIFICATION_RUN"
  | "OTHER";

function classifyPrimaryFailure(input: {
  delivery: string | null | undefined;
  runtimeMode: string | null | undefined;
  result: Record<string, unknown>;
  state: ReturnType<typeof getAutonomousState>;
}): PrimaryFailureCategory {
  const mode = input.runtimeMode ?? input.state?.document.nanoRuntimeMode ?? null;
  if (mode === "DEGRADED" || mode === "CONTROL") return "INVALID_QUALIFICATION_RUN";
  if (input.delivery === "ready") return "SUCCESS";

  const failureClass = String(input.result.failureClass ?? input.state?.failureClass ?? "");
  const usage = input.state?.document.usage;
  const budget = input.state?.document.budget;
  const planRepairs = usage?.planRepairs ?? 0;
  const maxPlanRepairs = budget?.max_plan_repairs ?? 8;
  const postRepairs = usage?.postReviewRepairs ?? 0;
  const maxPost = budget?.max_post_review_repairs ?? 2;
  const history = input.state?.document.planRepairHistory ?? [];
  const histText = JSON.stringify(history);
  const reviews = input.state?.document.reviews ?? [];
  const qcPassed = Boolean(input.state?.document.qcDelta?.objectiveQcPassed);
  const unresolved = input.state?.document.unresolvedDefects ?? [];

  if (/GENERATION_BUDGET_EXHAUSTED/i.test(histText) || failureClass === "GENERATION_BUDGET_EXHAUSTED") {
    return "GENERATION_BUDGET_EXHAUSTED";
  }
  if (planRepairs >= maxPlanRepairs && !qcPassed) return "PLAN_REPAIR_EXHAUSTED";
  if (postRepairs >= maxPost) return "POST_REVIEW_REPAIR_EXHAUSTED";
  if (
    qcPassed &&
    (unresolved.some((d) => /block|material|high|critical/i.test(JSON.stringify(d))) ||
      reviews.some((r) => /BLOCK|FAIL|defect/i.test(JSON.stringify(r))))
  ) {
    return "MATERIAL_REVIEW_BLOCK";
  }
  if (!qcPassed && (failureClass === "BUDGET_EXHAUSTED" || input.result.state === "exhausted")) {
    return "PRIMARY_QC_NONCONVERGENCE";
  }
  if (failureClass === "MODEL_OUTPUT_FAILURE" || /schema|parse/i.test(histText)) {
    return "MODEL_OUTPUT_SCHEMA_FAILURE";
  }
  if (failureClass === "GOVERNANCE_BLOCK" || failureClass === "AUTHORITY_FAILURE") {
    return "AUTHORITY/POLICY_BLOCK";
  }
  if (/ECONNREFUSED|fetch failed|timeout|ENOTFOUND/i.test(String(input.result.message ?? ""))) {
    return "ENVIRONMENT_FAILURE";
  }
  return "OTHER";
}

async function runSpecimen(specimen: SpecimenDef): Promise<Record<string, unknown>> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `ae-requal-${specimen.id}-`));
  specimen.seed(repo);

  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS = String(specimen.maxIterations);

  const task = createTask({
    title: specimen.title,
    description: specimen.objective,
    targetRepoPath: repo,
  });
  const started = Date.now();
  const run = createRun(task.id, "autonomous_engineer");
  createAutonomousState({
    runId: run.id,
    task,
    objective: specimen.objective,
    authorizedPathPrefixes: specimen.authorizedPathPrefixes,
    constraints: specimen.constraints,
    acceptanceCriteria: specimen.acceptanceCriteria,
  });
  updateTask(task.id, { status: "running" });
  updateRun(run.id, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: new Date().toISOString(),
  });

  console.log(
    JSON.stringify({
      specimen: specimen.id,
      hardClass: specimen.hardClass ?? null,
      variant: specimen.variant ?? null,
      runId: run.id,
      maxIterations: specimen.maxIterations,
      status: "starting",
    }),
  );

  let result: Record<string, unknown>;
  try {
    result = (await executeAutonomousLoop(run.id)) as unknown as Record<string, unknown>;
  } catch (error) {
    result = {
      runId: run.id,
      state: "failed",
      failureClass: "ENVIRONMENT_FAILURE",
      deliveryCandidateStatus: "blocked",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const state = getAutonomousState(run.id);
  const pkg = getAutonomousCompletionPackage(run.id);
  const plans = listWorkerPlansForRun(run.id);
  const wt = getRunWorktree(run.id);
  const score = wt?.worktreePath
    ? specimen.score(wt.worktreePath)
    : {
        pass: false,
        notes: ["missing worktree"],
        robustScorecard: { functional_correctness: "FAIL" as const },
      };

  const runtimeMode =
    state?.document.nanoRuntimeMode ?? resolveNanoRuntimeMode(process.env as Record<string, string | undefined>);
  const delivery = (result.deliveryCandidateStatus as string) ?? state?.deliveryCandidateStatus;
  const primaryFailureCategory = classifyPrimaryFailure({
    delivery,
    runtimeMode,
    result,
    state,
  });

  return {
    specimenId: specimen.id,
    matrixClasses: specimen.matrixClasses,
    hardClass: specimen.hardClass ?? null,
    variant: specimen.variant ?? null,
    title: specimen.title,
    objective: specimen.objective,
    elapsedMs: Date.now() - started,
    taskId: task.id,
    runId: run.id,
    maxIterations: specimen.maxIterations,
    nanoRuntimeMode: runtimeMode,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    deliveryCandidateStatus: delivery,
    primaryFailureCategory,
    workerModel: state?.document.workerModel
      ? {
          route: state.document.workerModel.route,
          providerName: state.document.workerModel.providerName,
          modelName: state.document.workerModel.modelName,
          rolesInvoked: state.document.workerModel.rolesInvoked,
          lastInvocations: state.document.workerModel.lastInvocations ?? [],
        }
      : null,
    priorAttempts: state?.document.priorAttempts,
    failedHypotheses: state?.document.failedHypotheses,
    usage: state?.document.usage ?? null,
    budget: state?.document.budget ?? null,
    planRepairHistory: state?.document.planRepairHistory ?? [],
    lastIterationChargeKind: state?.document.lastIterationChargeKind ?? null,
    reviews: state?.document.reviews,
    unresolvedDefects: state?.document.unresolvedDefects,
    qcDelta: state?.document.qcDelta
      ? {
          new: state.document.qcDelta.newFailures.length,
          preExisting: state.document.qcDelta.preExistingFailures.length,
          changed: state.document.qcDelta.changedFailures.length,
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
    worktree: pkg?.worktree ?? null,
    score,
    humanCodingInterventions: 0,
    validQualificationRun: primaryFailureCategory !== "INVALID_QUALIFICATION_RUN",
  };
}

function applyFaithfulEnv(): void {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL =
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ?? "http://127.0.0.1:8082/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL =
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ?? "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN =
    process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN ?? "262144";
  // Faithful default ON — do not set false
  delete process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION;
  // Qualification must NOT force global reasoning budget (prior 4000 audit regressed sanity).
  delete process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET;
  // Conditional rescue remains available as default policy unless explicitly disabled.
  if (process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE === undefined) {
    process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE = "true";
  }
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS =
    process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS ?? "600000";
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(45 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "28";
  process.env.ENGINEER_CONSOLE_AE_MAX_PLAN_REPAIRS ??= "8";
  process.env.ENGINEER_CONSOLE_AE_MAX_POST_REVIEW_REPAIRS ??= "2";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");
}

function selectSpecimens(argv: string[]): SpecimenDef[] {
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const onlyHard = argv.find((a) => a.startsWith("--only-hard="))?.slice("--only-hard=".length);
  const hard = argv.includes("--hard");
  const matrix = argv.includes("--matrix");
  const all = argv.includes("--all");

  if (only) {
    const found = MATRIX_SPECIMENS.filter((s) => s.id === only);
    if (!found.length) throw new Error(`Unknown specimen id: ${only}`);
    return found;
  }

  if (hard || onlyHard) {
    const classes = onlyHard
      ? ([onlyHard] as Array<"bad_legacy_ledger" | "idempotent_job_runner">)
      : (["bad_legacy_ledger", "idempotent_job_runner"] as const);
    return classes.flatMap((c) => specimensForHardClass(c));
  }

  if (all) {
    return MATRIX_SPECIMENS.filter((s) => matrixCoverageIds().includes(s.id));
  }
  if (matrix) {
    // Hard classes are covered by --hard 3× protocol; matrix batch is remaining classes only.
    return MATRIX_SPECIMENS.filter((s) => !s.hardClass);
  }

  // default: hard repeatability first
  return specimensForHardClass("bad_legacy_ledger").concat(specimensForHardClass("idempotent_job_runner"));
}

async function main(): Promise<void> {
  applyFaithfulEnv();
  const mode = resolveNanoRuntimeMode(process.env as Record<string, string | undefined>);
  if (mode !== "FAITHFUL") {
    console.error(JSON.stringify({ error: "runtime not FAITHFUL", mode }));
    process.exit(2);
  }

  initializeEngineerConsoleDatabase();
  const selected = selectSpecimens(process.argv.slice(2));
  const outDirArg = process.argv.slice(2).find((a) => a.startsWith("--out-dir="))?.slice("--out-dir=".length);
  const outDir = path.isAbsolute(outDirArg ?? "")
    ? (outDirArg as string)
    : path.join(process.cwd(), outDirArg ?? "evidence/ae-robust-requalification");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const results: Record<string, unknown>[] = [];

  for (const specimen of selected) {
    const row = await runSpecimen(specimen);
    results.push(row);
    const perFile = path.join(outDir, `${specimen.id}-${String(row.runId).slice(0, 8)}.json`);
    fs.writeFileSync(perFile, JSON.stringify(row, null, 2));
    console.log(
      JSON.stringify({
        specimen: specimen.id,
        runId: row.runId,
        delivery: row.deliveryCandidateStatus,
        primaryFailureCategory: row.primaryFailureCategory,
        scorePass: (row.score as { pass?: boolean })?.pass,
        iterations: row.iterationNumber,
        elapsedMs: row.elapsedMs,
        evidence: perFile,
      }),
    );
  }

  const proof = {
    at: new Date().toISOString(),
    tipHint: "feature/autonomous-engineer-v1",
    worker: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL,
    endpoint: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL,
    maxModelLen: process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN,
    nanoRuntimeMode: mode,
    humanCodingInterventions: 0,
    specimens: results,
    summary: {
      total: results.length,
      validRuns: results.filter((r) => r.validQualificationRun).length,
      scorePass: results.filter((r) => (r.score as { pass?: boolean })?.pass).length,
      deliveryReady: results.filter((r) => r.deliveryCandidateStatus === "ready").length,
      byFailure: results.reduce<Record<string, number>>((acc, r) => {
        const k = String(r.primaryFailureCategory);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };

  const batchFile = path.join(outDir, `batch-${stamp}.json`);
  fs.writeFileSync(batchFile, JSON.stringify(proof, null, 2));
  // also refresh composite pointer
  fs.writeFileSync(path.join(outDir, "latest-batch.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ batchFile, summary: proof.summary }, null, 2));
}

void main();
