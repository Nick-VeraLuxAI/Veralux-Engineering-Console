import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { saveApprovalReport, saveQualityGateResults, updateRun } from "../run-manager/run-manager";
import {
  createProject,
  createRequirement,
  createSpecification,
  getRequirementById,
  listAcceptanceCriteriaForRequirement,
  loadProjectState,
} from "./project-orchestration-manager";
import { startProject } from "./project-orchestrator";
import {
  buildWorkerAssignment,
  dispatchAttempt,
  evaluateAttempt,
  prepareAttempt,
  recoverInterruptedAttempts,
  scheduleRetry,
  verifyAttempt,
} from "./requirement-execution-controller";
import {
  createQualityBaseline,
  getQualityBaselineComparisonForAttempt,
  listAttemptsForRequirement,
  listVerificationDecisionsForRequirement,
} from "./requirement-execution-manager";
import {
  fingerprintFailure,
  normalizeFailureText,
  validateWorkerAssignment,
} from "./requirement-execution-policy";

let tmpDb = "";
let repoRoot = "";

function seedDb() {
  tmpDb = path.join(os.tmpdir(), `ec-requirement-exec-${Date.now()}-${Math.random()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "true";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-requirement-exec-repo-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "attempt-test", scripts: { test: "node -e \"process.exit(0)\"" } }),
  );
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
}

function seedProject() {
  const project = createProject({
    name: "Execution loop",
    description: "Run one bounded worker.",
    targetRepoPath: repoRoot,
    createdBy: "test",
  });
  createSpecification({
    projectId: project.id,
    title: "Execution spec",
    content: "Implement a bounded loop.",
  });
  const requirement = createRequirement({
    projectId: project.id,
    stableKey: "REQ-1",
    title: "Complete one requirement",
    description: "Use a durable attempt.",
    acceptanceCriteria: [
      {
        stableKey: "REQ-1.AC1",
        description: "Passing run evidence is attached.",
        verificationType: "test",
      },
    ],
  });
  startProject(project.id);
  return { project: loadProjectState(project.id).project, requirement };
}

beforeEach(() => {
  seedDb();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (repoRoot && fs.existsSync(repoRoot)) fs.rmSync(repoRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
});

describe("RequirementExecutionController attempts and assignments", () => {
  it("creates sequential attempts and validates bounded assignments", () => {
    const { requirement } = seedProject();
    const attempt = prepareAttempt(requirement.id);
    const assignment = buildWorkerAssignment(attempt.id);
    expect(attempt.attemptNumber).toBe(1);
    expect(assignment.acceptance_criteria).toHaveLength(1);
    expect(assignment.self_verification_allowed).toBe(false);
    expect(validateWorkerAssignment({ ...assignment, acceptance_criteria: [] })).toContain(
      "at least one acceptance criterion is required.",
    );
  });

  it("dispatches through engineering runs and prevents duplicate dispatch", async () => {
    const { requirement } = seedProject();
    const attempt = prepareAttempt(requirement.id);
    buildWorkerAssignment(attempt.id);
    const dispatched = await dispatchAttempt(attempt.id, {
      executeInline: false,
      deps: { executeRunFn: async () => undefined },
    });
    const duplicate = await dispatchAttempt(attempt.id, {
      executeInline: false,
      deps: { executeRunFn: async () => undefined },
    });
    expect(dispatched.runId).toBeTruthy();
    expect(duplicate.runId).toBe(dispatched.runId);
  });
});

describe("RequirementExecutionController evaluation, verification, and retry", () => {
  it("attaches passing evidence and completes through independent verification", async () => {
    const { requirement } = seedProject();
    const attempt = prepareAttempt(requirement.id);
    buildWorkerAssignment(attempt.id);
    const dispatched = await dispatchAttempt(attempt.id, {
      executeInline: true,
      deps: {
        executeRunFn: async (runId) => {
          updateRun(runId, {
            status: "waiting_for_approval",
            currentStep: "waiting_for_approval",
            startedAt: new Date().toISOString(),
          });
          saveQualityGateResults(runId, [
            { command: "npm test", stdout: "ok", stderr: "", exitCode: 0, durationMs: 1, status: "passed" },
          ]);
          saveApprovalReport(
            runId,
            JSON.stringify({
              changedFiles: ["src/example.ts"],
              canApprove: true,
              governanceIssues: [],
              recommendedNextAction: "verify",
              riskLevel: "low",
            }),
          );
        },
      },
    });
    const result = await evaluateAttempt(dispatched.id, {
      getChangedFilesFn: async () => ["src/example.ts"],
    });
    expect(result.failure).toBeNull();
    expect(result.attempt.status).toBe("verification");
    const verification = verifyAttempt(result.attempt.id);
    expect(verification.decision).toBe("accepted");
    expect(getRequirementById(requirement.id)?.status).toBe("completed");
    expect(listVerificationDecisionsForRequirement(requirement.id)).toHaveLength(1);
    expect(listAcceptanceCriteriaForRequirement(requirement.id)[0].status).toBe("satisfied");
  });

  it("classifies failed gates, fingerprints failures, and schedules bounded retry", async () => {
    const { requirement } = seedProject();
    const attempt = prepareAttempt(requirement.id);
    buildWorkerAssignment(attempt.id);
    const dispatched = await dispatchAttempt(attempt.id, {
      executeInline: true,
      deps: {
        executeRunFn: async (runId) => {
          updateRun(runId, {
            status: "failed",
            currentStep: "failed",
            agentMessage: "tests failed",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
          saveQualityGateResults(runId, [
            {
              command: "npm test",
              stdout: "FAIL test/a.test.ts:10:2",
              stderr: "",
              exitCode: 1,
              durationMs: 1,
              status: "failed",
            },
          ]);
        },
      },
    });
    const result = await evaluateAttempt(dispatched.id, { getChangedFilesFn: async () => [] });
    expect(result.failure?.category).toBe("test_failure");
    const retry = scheduleRetry(result.attempt.id, { maxAttempts: 3 });
    expect(retry.nextAttempt?.attemptNumber).toBe(2);
    expect(retry.nextAttempt?.strategy).toBe("repair_from_test_failure");
  });

  it("uses approved quality baseline fingerprints to separate existing failures from new failures", async () => {
    const { project, requirement } = seedProject();
    const fingerprint = fingerprintFailure({
      category: "typecheck_failure",
      command: "npm run typecheck",
      exitCode: 2,
      text: "TS2741 src/a.ts:10:5",
    });
    createQualityBaseline({
      projectId: project.id,
      baselineRevision: "baseline-1",
      baselineJson: JSON.stringify({ failures: [{ fingerprint }] }),
      repoPath: repoRoot,
      approvedBy: "operator",
    });
    const attempt = prepareAttempt(requirement.id);
    buildWorkerAssignment(attempt.id);
    const dispatched = await dispatchAttempt(attempt.id, {
      executeInline: true,
      deps: {
        executeRunFn: async (runId) => {
          updateRun(runId, { status: "failed", currentStep: "failed" });
          saveQualityGateResults(runId, [
            {
              command: "npm run typecheck",
              stdout: "TS2741 src/a.ts:99:5",
              stderr: "",
              exitCode: 2,
              durationMs: 1,
              status: "failed",
            },
          ]);
        },
      },
    });
    const result = await evaluateAttempt(dispatched.id, { getChangedFilesFn: async () => ["src/a.ts"] });
    expect(result.failure).toBeNull();
    expect(getQualityBaselineComparisonForAttempt(dispatched.id)?.status).toBe("passed");
  });

  it("recovers interrupted attempts idempotently without duplicate runs", async () => {
    const { project, requirement } = seedProject();
    const attempt = prepareAttempt(requirement.id);
    buildWorkerAssignment(attempt.id);
    const dispatched = await dispatchAttempt(attempt.id, {
      executeInline: false,
      deps: { executeRunFn: async () => undefined },
    });
    updateRun(dispatched.runId!, { status: "failed", currentStep: "failed" });
    const first = recoverInterruptedAttempts(project.id);
    const second = recoverInterruptedAttempts(project.id);
    expect(first[0].status).toBe("evaluating");
    expect(second).toHaveLength(1);
    expect(listAttemptsForRequirement(requirement.id)).toHaveLength(1);
  });

  it("recovers failed and indeterminate runs for deterministic evaluation", async () => {
    for (const runStatus of ["failed", "execution_indeterminate"] as const) {
      const { project, requirement } = seedProject();
      const attempt = prepareAttempt(requirement.id);
      buildWorkerAssignment(attempt.id);
      const dispatched = await dispatchAttempt(attempt.id, {
        executeInline: false,
        deps: { executeRunFn: async () => undefined },
      });
      updateRun(dispatched.runId!, { status: runStatus, currentStep: runStatus });

      const recovered = recoverInterruptedAttempts(project.id);

      expect(recovered[0].status).toBe("evaluating");
      expect(listAttemptsForRequirement(requirement.id)).toHaveLength(1);
    }
  });
});

describe("failure fingerprints", () => {
  it("normalizes unstable paths, IDs, timestamps, and line drift", () => {
    const first = normalizeFailureText("/tmp/a-123/file.ts:10:2 id 123e4567-e89b-12d3-a456-426614174000");
    const second = normalizeFailureText("/tmp/b-456/file.ts:99:7 id 123e4567-e89b-12d3-a456-426614174000");
    expect(first).toBe(second);
  });
});
