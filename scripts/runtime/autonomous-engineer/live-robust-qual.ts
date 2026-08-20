/**
 * Live Robust Code & Bad-Code Remediation qualification against Nano 30B.
 * Mutations stay in isolated worktrees. No PR / merge / deploy.
 *
 * Specimens (high-level director objectives only; do not tip what is "bad"):
 *  1. Bad-code remediation — legacy ledger with duplication / swallowed errors
 *  2. Passing-but-wrong — green tests + success-fallback auth hole
 *  3. Failure recovery / idempotency — half-built job runner with duplicate apply risk
 *  4. Console dogfood — bounded robust feature on Engineering Console (optional via --console)
 */
import { execSync } from "child_process";
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

type SpecimenId = "bad_legacy_ledger" | "passing_wrong_auth" | "idempotent_job_runner" | "console_feature";

interface SpecimenDef {
  id: SpecimenId;
  title: string;
  class: "bad_code_remediation" | "passing_but_wrong" | "failure_recovery" | "robust_new_feature";
  objective: string;
  acceptanceCriteria: string[];
  constraints: string[];
  authorizedPathPrefixes: string[];
  seed: (repo: string) => void;
  score: (worktreePath: string) => {
    pass: boolean;
    notes: string[];
    robustScorecard: Record<string, "PASS" | "FAIL" | "PARTIAL" | "N/A">;
    badCodeScorecard?: Record<string, "PASS" | "FAIL" | "PARTIAL" | "N/A">;
  };
}

function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function initGit(repo: string): void {
  execSync("git init", { cwd: repo, stdio: "ignore" });
  execSync('git config user.email "robust-qual@veralux.local"', { cwd: repo, stdio: "ignore" });
  execSync('git config user.name "AE Robust Qual"', { cwd: repo, stdio: "ignore" });
  execSync("git add .", { cwd: repo, stdio: "ignore" });
  execSync('git commit -m "specimen seed"', { cwd: repo, stdio: "ignore" });
}

const SPECIMENS: SpecimenDef[] = [
  {
    id: "bad_legacy_ledger",
    title: "Legacy ledger reliability",
    class: "bad_code_remediation",
    objective:
      "Directors need the payment ledger under src/ledger to apply payments correctly, record outcomes, and never silently treat failures as success. Improve the existing ledger so production can trust applyPayment, and add tests that cover success and failure cases. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "applyPayment is reliable for success and failure cases",
      "Failures are recorded, not swallowed",
      "Unit tests cover success and at least one failure path",
      "No pull request is created",
    ],
    constraints: [
      "Stay inside src/ledger/",
      "Do not change PR, merge, or deploy behavior",
    ],
    authorizedPathPrefixes: ["src/ledger/"],
    seed(repo) {
      write(
        repo,
        "package.json",
        JSON.stringify(
          {
            name: "ae-robust-bad-ledger",
            type: "module",
            scripts: { test: "node --test src/ledger/ledger.test.js" },
          },
          null,
          2,
        ),
      );
      write(
        repo,
        "src/ledger/ledger.js",
        [
          "const STATUS = { OK: 'ok', FAIL: 'fail' };",
          "let last = null;",
          "export function applyPayment(id, amount, store) {",
          "  // nested / duplicated / magic-string heavy path",
          "  if (id) {",
          "    if (amount) {",
          "      if (store) {",
          "        try {",
          "          if (store[id] && store[id] === 'paid') {",
          "            return true;",
          "          } else {",
          "            if (amount > 0) {",
          "              store[id] = 'paid';",
          "              last = { id, amount, status: STATUS.OK };",
          "              return true;",
          "            } else {",
          "              if (amount <= 0) {",
          "                try { store[id] = 'paid'; return true; } catch (e) { }",
          "              }",
          "            }",
          "          }",
          "        } catch (e) {",
          "          return true;",
          "        }",
          "      }",
          "    }",
          "  }",
          "  return true;",
          "}",
          "export function getLast() { return last; }",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/ledger/ledger.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { applyPayment } from './ledger.js';",
          "test('happy path marks paid', () => {",
          "  const store = {};",
          "  assert.equal(applyPayment('p1', 10, store), true);",
          "  assert.equal(store.p1, 'paid');",
          "});",
          "",
        ].join("\n"),
      );
      write(repo, "src/unrelated/smell.js", "export const unused = () => { try { throw new Error('x') } catch {} }\n");
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/ledger/ledger.js"), "utf8");
      const testSrc = fs.existsSync(path.join(wt, "src/ledger/ledger.test.js"))
        ? fs.readFileSync(path.join(wt, "src/ledger/ledger.test.js"), "utf8")
        : "";
      const notes: string[] = [];
      const noEmptyCatch = !/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(src);
      const noSuccessFallback = !/catch\s*(?:\([^)]*\))?\s*\{\s*return\s+true/.test(src);
      const noWorkaround = !/WORKAROUND|HACK/i.test(src);
      const rejectsNonPositive =
        /amount\s*<=\s*0|amount\s*<\s*1|!amount|amount\s*>\s*0/.test(src) &&
        !/amount\s*<=\s*0[\s\S]{0,80}return\s+true/.test(src);
      const recordsFailure = /fail|error|status/i.test(src) && /return\s+(?:false|\{)/.test(src);
      const failureTest = /fail|invalid|reject|non.?positive|zero|throw/i.test(testSrc);
      const unrelatedUntouched =
        fs.existsSync(path.join(wt, "src/unrelated/smell.js")) &&
        /catch\s*\{\s*\}/.test(fs.readFileSync(path.join(wt, "src/unrelated/smell.js"), "utf8"));
      const noVitestInProd = !/from\s+['"]vitest['"]/.test(src);
      if (!noEmptyCatch) notes.push("empty catch remains");
      if (!noSuccessFallback) notes.push("success-fallback catch remains");
      if (!noWorkaround) notes.push("workaround marker present");
      if (!noVitestInProd) notes.push("vitest imported in production source");
      if (!recordsFailure) notes.push("failures not clearly recorded");
      if (!failureTest) notes.push("missing failure-path test");
      if (!unrelatedUntouched) notes.push("unrelated smell unexpectedly changed");
      const pass =
        noEmptyCatch &&
        noSuccessFallback &&
        noWorkaround &&
        noVitestInProd &&
        recordsFailure &&
        failureTest &&
        unrelatedUntouched;
      return {
        pass,
        notes,
        robustScorecard: {
          functional_correctness: recordsFailure && rejectsNonPositive ? "PASS" : "FAIL",
          error_handling: noEmptyCatch && noSuccessFallback ? "PASS" : "FAIL",
          tests_negative_path: failureTest ? "PASS" : "FAIL",
          scope_discipline: unrelatedUntouched ? "PASS" : "FAIL",
          no_workaround_stack: noWorkaround ? "PASS" : "FAIL",
        },
        badCodeScorecard: {
          identified_underlying_defect: noSuccessFallback && noEmptyCatch ? "PASS" : "FAIL",
          repaired_design_not_hack: noWorkaround && recordsFailure ? "PASS" : "FAIL",
          removed_obsolete_patterns: noEmptyCatch ? "PASS" : "FAIL",
          regression_coverage: failureTest ? "PASS" : "FAIL",
          left_subsystem_healthier: pass ? "PASS" : "FAIL",
        },
      };
    },
  },
  {
    id: "passing_wrong_auth",
    title: "Authorization helper",
    class: "passing_but_wrong",
    objective:
      "Operators need authorizeAction(user, action) to decide access for console tools. Keep the helper under src/auth, make authorization trustworthy for production, and ensure tests cover both allow and deny cases. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "authorizeAction allows only when the user has the action",
      "Deny/fail-closed behavior for invalid callers",
      "Tests cover allow and deny",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/auth/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/auth/"],
    seed(repo) {
      write(
        repo,
        "package.json",
        JSON.stringify(
          {
            name: "ae-robust-auth",
            type: "module",
            scripts: { test: "node --test src/auth/authorize.test.js" },
          },
          null,
          2,
        ),
      );
      write(
        repo,
        "src/auth/authorize.js",
        [
          "export function authorizeAction(user, action) {",
          "  try {",
          "    return user.roles.includes(action);",
          "  } catch (e) {",
          "    return true;",
          "  }",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/auth/authorize.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { authorizeAction } from './authorize.js';",
          "test('allows listed action', () => {",
          "  assert.equal(authorizeAction({ roles: ['read'] }, 'read'), true);",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/auth/authorize.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/auth/authorize.test.js"), "utf8");
      const notes: string[] = [];
      const noSuccessFallback = !/catch\s*(?:\([^)]*\))?\s*\{\s*return\s+true/.test(src);
      const failClosed =
        (/return\s+false/.test(src) || /throw\s+new\s+Error/.test(src)) &&
        (/!user|user\s*==\s*null|!Array\.isArray|typeof user/.test(src) || /roles/.test(src));
      const denyTest = /deny|false|missing|invalid|null|undefined|fail/i.test(testSrc);
      if (!noSuccessFallback) notes.push("success-fallback still present");
      if (!failClosed) notes.push("not clearly fail-closed");
      if (!denyTest) notes.push("no deny-path test");
      const pass = noSuccessFallback && failClosed && denyTest;
      return {
        pass,
        notes,
        robustScorecard: {
          functional_correctness: failClosed ? "PASS" : "FAIL",
          security_authorization: noSuccessFallback && failClosed ? "PASS" : "FAIL",
          tests_negative_path: denyTest ? "PASS" : "FAIL",
          hidden_defect_detected: noSuccessFallback ? "PASS" : "FAIL",
        },
      };
    },
  },
  {
    id: "idempotent_job_runner",
    title: "Job apply resume",
    class: "failure_recovery",
    objective:
      "Directors need a small job apply helper under src/jobs that can apply a job by id once, survive retries after a partial failure, and never double-apply the same job id. Complete the half-built module into a coherent tested vertical slice. Do not open a PR or deploy.",
    acceptanceCriteria: [
      "applyJob is idempotent for the same job id",
      "Partial failure leaves a recoverable recorded state",
      "Tests cover first apply, duplicate apply, and a failure/resume case",
      "No pull request is created",
    ],
    constraints: ["Stay inside src/jobs/", "Do not change PR, merge, or deploy behavior"],
    authorizedPathPrefixes: ["src/jobs/"],
    seed(repo) {
      write(
        repo,
        "package.json",
        JSON.stringify(
          {
            name: "ae-robust-jobs",
            type: "module",
            scripts: { test: "node --test src/jobs/jobs.test.js" },
          },
          null,
          2,
        ),
      );
      write(
        repo,
        "src/jobs/jobs.js",
        [
          "// Half-built: only first success path sketched.",
          "export const store = { applied: {}, pending: {} };",
          "export function applyJob(id, work) {",
          "  // TODO: resume / duplicate / failure recording",
          "  const result = work();",
          "  store.applied[id] = (store.applied[id] || 0) + 1;",
          "  return result;",
          "}",
          "",
        ].join("\n"),
      );
      write(
        repo,
        "src/jobs/jobs.test.js",
        [
          "import test from 'node:test';",
          "import assert from 'node:assert/strict';",
          "import { applyJob, store } from './jobs.js';",
          "test('applies once', () => {",
          "  Object.keys(store.applied).forEach((k) => delete store.applied[k]);",
          "  assert.equal(applyJob('j1', () => 1), 1);",
          "});",
          "",
        ].join("\n"),
      );
      initGit(repo);
    },
    score(wt) {
      const src = fs.readFileSync(path.join(wt, "src/jobs/jobs.js"), "utf8");
      const testSrc = fs.readFileSync(path.join(wt, "src/jobs/jobs.test.js"), "utf8");
      const notes: string[] = [];
      const idempotent =
        /applied\[id\]|already|idempot|duplicate|if\s*\(.*applied/.test(src) &&
        !/\+\s*1;\s*$/m.test(src.split("\n").find((l) => /applied\[id\]/.test(l)) ?? "+ 1;");
      // simpler heuristic:
      const guardsDuplicate = /if\s*\([^)]*applied[^)]*\)/.test(src) || /already applied|idempot/i.test(src);
      const recordsPartial = /pending|failed|error|status|resume/i.test(src);
      const testsDup = /duplicate|twice|second|idempot|again/i.test(testSrc);
      const testsFail = /fail|throw|error|resume|partial/i.test(testSrc);
      if (!guardsDuplicate) notes.push("no duplicate guard");
      if (!recordsPartial) notes.push("no failure/resume recording");
      if (!testsDup) notes.push("no duplicate test");
      if (!testsFail) notes.push("no failure/resume test");
      const pass = guardsDuplicate && recordsPartial && testsDup && testsFail;
      void idempotent;
      return {
        pass,
        notes,
        robustScorecard: {
          functional_correctness: guardsDuplicate ? "PASS" : "FAIL",
          failure_recovery: recordsPartial && testsFail ? "PASS" : "FAIL",
          idempotency: guardsDuplicate && testsDup ? "PASS" : "FAIL",
          vertical_slice_complete: pass ? "PASS" : "PARTIAL",
        },
      };
    },
  },
];

async function runSpecimen(specimen: SpecimenDef): Promise<Record<string, unknown>> {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `ae-robust-${specimen.id}-`));
  specimen.seed(repo);
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
  console.log(JSON.stringify({ specimen: specimen.id, runId: run.id, status: "starting" }));
  const result = await executeAutonomousLoop(run.id);
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
  return {
    specimenId: specimen.id,
    class: specimen.class,
    title: specimen.title,
    objective: specimen.objective,
    elapsedMs: Date.now() - started,
    taskId: task.id,
    runId: run.id,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    deliveryCandidateStatus: result.deliveryCandidateStatus,
    workerModel: state?.document.workerModel
      ? {
          route: state.document.workerModel.route,
          providerName: state.document.workerModel.providerName,
          modelName: state.document.workerModel.modelName,
          rolesInvoked: state.document.workerModel.rolesInvoked,
        }
      : null,
    priorAttempts: state?.document.priorAttempts,
    failedHypotheses: state?.document.failedHypotheses,
    usage: state?.document.usage ?? null,
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
  };
}

async function runConsoleFeature(): Promise<Record<string, unknown>> {
  const OBJECTIVE =
    "Directors need a small tested helper that formats an autonomous-run risk line from severity and summary strings already known to the director package (example: '[high] incomplete auth'), fail-closed when severity is missing, and stay inside the autonomous-engineer library. Do not open a PR or deploy.";
  const task = createTask({
    title: "Director risk line helper",
    description: OBJECTIVE,
    targetRepoPath: process.cwd(),
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
      "Prefer a new small helper + Vitest test; do not rewrite large modules.",
    ],
    acceptanceCriteria: [
      "Helper formats '[severity] summary' and rejects missing severity.",
      "Unit tests cover happy and missing-severity cases.",
      "No pull request is created.",
    ],
  });
  updateTask(task.id, { status: "running" });
  updateRun(run.id, {
    status: "preparing_workspace",
    currentStep: "preparing_workspace",
    startedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ specimen: "console_feature", runId: run.id, status: "starting" }));
  const result = await executeAutonomousLoop(run.id);
  const state = getAutonomousState(run.id);
  const wt = getRunWorktree(run.id);
  let scorePass = false;
  const notes: string[] = [];
  if (wt?.worktreePath) {
    const changed = execSync("git status --porcelain", { cwd: wt.worktreePath, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const helperLine = changed.find((line) => /risk|director/i.test(line) && line.endsWith(".ts"));
    if (!helperLine) notes.push("no obvious risk helper file in git status");
    else {
      const rel = helperLine.replace(/^[A-Z?]+\s+/, "");
      const content = fs.readFileSync(path.join(wt.worktreePath, rel), "utf8");
      const hasFailClosed = /throw|missing|required|severity/i.test(content);
      const hasFormat = /severity|summary/i.test(content);
      scorePass = hasFailClosed && hasFormat && result.deliveryCandidateStatus === "ready";
      if (!hasFailClosed) notes.push("helper may not fail-closed");
      if (result.deliveryCandidateStatus !== "ready") notes.push(`delivery=${result.deliveryCandidateStatus}`);
    }
  } else notes.push("no worktree");
  return {
    specimenId: "console_feature",
    class: "robust_new_feature",
    title: "Director risk line helper",
    objective: OBJECTIVE,
    elapsedMs: Date.now() - started,
    runId: run.id,
    result,
    currentState: state?.currentState,
    iterationNumber: state?.document.iterationNumber,
    deliveryCandidateStatus: result.deliveryCandidateStatus,
    workerModel: state?.document.workerModel,
    priorAttempts: state?.document.priorAttempts,
    failedHypotheses: state?.document.failedHypotheses,
    plans: listWorkerPlansForRun(run.id).map((plan) => ({
      id: plan.id,
      summary: plan.summary,
      iterationNumber: plan.iterationNumber,
      validationStatus: plan.validationStatus,
      executionStatus: plan.executionStatus,
    })),
    reviews: state?.document.reviews,
    unresolvedDefects: state?.document.unresolvedDefects,
    qcDelta: state?.document.qcDelta
      ? {
          new: state.document.qcDelta.newFailures.length,
          preExisting: state.document.qcDelta.preExistingFailures.length,
          owned: state.document.qcDelta.ownedIterationFailures.length,
          objectiveQcPassed: state.document.qcDelta.objectiveQcPassed,
        }
      : null,
    worktree: getAutonomousCompletionPackage(run.id)?.worktree ?? null,
    score: {
      pass: scorePass,
      notes,
      robustScorecard: {
        functional_correctness: scorePass ? "PASS" : "FAIL",
        validation_error_handling: scorePass ? "PASS" : "PARTIAL",
        delivery: result.deliveryCandidateStatus === "ready" ? "PASS" : "FAIL",
      },
    },
    humanCodingInterventions: 0,
  };
}

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  process.env.ENGINEER_CONSOLE_AE_MAX_RUNTIME_MS ??= String(45 * 60 * 1000);
  process.env.ENGINEER_CONSOLE_AE_MAX_MODEL_CALLS ??= "28";
  process.env.ENGINEER_CONSOLE_AE_MAX_ITERATIONS ??= "6";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  initializeEngineerConsoleDatabase();
  const includeConsole = process.argv.includes("--console");
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);

  const selected = SPECIMENS.filter((specimen) => !only || specimen.id === only);
  const results: Record<string, unknown>[] = [];
  for (const specimen of selected) {
    results.push(await runSpecimen(specimen));
  }
  if (includeConsole && (!only || only === "console_feature")) {
    results.push(await runConsoleFeature());
  }

  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const proof = {
    at: new Date().toISOString(),
    worker: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL,
    endpoint: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL,
    humanCodingInterventions: 0,
    specimens: results,
    summary: {
      total: results.length,
      scorePass: results.filter((r) => (r.score as { pass?: boolean })?.pass).length,
      deliveryReady: results.filter((r) => r.deliveryCandidateStatus === "ready").length,
    },
  };
  const outFile = path.join(outDir, "ae-v1-robust-live-qual.json");
  fs.writeFileSync(outFile, JSON.stringify(proof, null, 2));
  console.log(
    JSON.stringify(
      {
        outFile,
        summary: proof.summary,
        per: results.map((r) => ({
          id: r.specimenId,
          delivery: r.deliveryCandidateStatus,
          scorePass: (r.score as { pass?: boolean })?.pass,
          iterations: r.iterationNumber,
          notes: (r.score as { notes?: string[] })?.notes,
        })),
      },
      null,
      2,
    ),
  );
  if (proof.summary.scorePass < Math.min(3, results.length)) process.exitCode = 1;
}

void main();
