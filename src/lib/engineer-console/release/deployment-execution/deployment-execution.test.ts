import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";
import {
  closeEngineerConsoleDb,
  getEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { buildApprovalReport } from "../../approval/approval-report";
import {
  createRun,
  saveApprovalReport,
  saveQualityGateResults,
  updateRun,
} from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { assessChangedFiles } from "../../governance/governance-engine";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../../governance/audit-ledger/audit-ledger-manager";
import { createDecisionRecord } from "../../governance/decision-records/decision-record-manager";
import { refreshRunEvidenceBundle } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { buildRunEvidenceBundle } from "../../governance/evidence-bundles/build-run-evidence-bundle";
import { runPolicyEvaluation } from "../../governance/policy-results/policy-result-manager";
import { runReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "../../governance/review-stages/review-stage-manager";
import { authorizeMutation } from "../../security/route-guards";
import { createOperatorAccount } from "../../security/operator-account-manager";
import { hashPassword } from "../../security/password-hashing";
import { createOperatorSession } from "../../security/session-manager";
import { CSRF_HEADER_NAME } from "../../security/csrf";
import { listDeploymentEnvironments } from "../deployment-gates/deployment-environments";
import {
  createDeploymentApproval,
  createDeploymentReadinessCheck,
} from "../deployment-gates/deployment-gate-manager";
import {
  setDeploymentProfilesForTests,
  listPublicDeploymentProfiles,
  resolveExecutableDeploymentProfile,
} from "./deployment-profile-config";
import { evaluateDeploymentExecutionReadiness } from "./evaluate-deployment-execution-readiness";
import {
  setControlledDeploymentExecutorForTests,
  type ControlledDeploymentExecutor,
} from "./execute-deployment-profile";
import { DeploymentExecutionError } from "./deployment-execution-types";
import {
  createDeploymentExecution,
  listDeploymentExecutionsForRun,
  toPublicDeploymentExecution,
} from "./deployment-execution-manager";
import { redactDeploymentOutput } from "./redact-deployment-output";

const TEST_PROFILE = {
  name: "staging-dashboard",
  environmentName: "staging",
  strategy: "fixed_command" as const,
  workingDirectory: "/tmp/deploy-workdir",
  command: "echo",
  args: ["deploy-ok"],
  allowed: true,
  timeoutMs: 5000,
};

const PRODUCTION_PROFILE = {
  ...TEST_PROFILE,
  name: "production-dashboard",
  environmentName: "production",
};

let tmpDb: string;
let spawnCalls: Array<{ command: string; args: string[]; shell?: boolean }> = [];

const mockExecutor: ControlledDeploymentExecutor = {
  exec: vi.fn(async (profile) => {
    spawnCalls.push({ command: profile.command, args: [...profile.args] });
    return {
      exitCode: 0,
      stdout: "deploy complete api_key=secret123",
      stderr: "",
      timedOut: false,
    };
  }),
};

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-deploy-exec-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "deployment-execution-test";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_SESSION_SECRET = "deploy-exec-secret";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  spawnCalls = [];
  setDeploymentProfilesForTests([TEST_PROFILE, PRODUCTION_PROFILE]);
  setControlledDeploymentExecutorForTests(mockExecutor);
  vi.mocked(mockExecutor.exec).mockClear();
});

afterEach(() => {
  setControlledDeploymentExecutorForTests(null);
  setDeploymentProfilesForTests(null);
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_SESSION_SECRET;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
});

async function seedApprovedRun() {
  const changedFiles = ["src/a.ts"];
  const governance = assessChangedFiles(changedFiles);
  const task = createTask({ title: "Deploy exec", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  updateRun(run.id, {
    status: "completed",
    branchName: "engineer/test-branch",
    governanceNotes: JSON.stringify(governance),
    completedAt: new Date().toISOString(),
  });
  saveQualityGateResults(run.id, [
    {
      id: "g1",
      runId: run.id,
      command: "npm test",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      status: "passed",
      createdAt: new Date().toISOString(),
    },
  ]);
  const report = buildApprovalReport({
    task,
    run: { ...run, status: "completed", branchName: "engineer/test-branch" },
    changedFiles,
    diffSummary: "1",
    governance,
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  reconcileReviewStagesForRun(run.id, { audit: false });
  await refreshRunEvidenceBundle({ runId: run.id, changedFiles });
  await runReplayVerification(run.id, { persist: true, audit: false });
  ensureReplayPassed(run.id);
  for (const stage of listReviewStagesForRun(run.id).filter((s) => s.required)) {
    completeReviewStageAction({
      stageId: stage.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "reviewer",
    });
  }
  createDecisionRecord({
    runId: run.id,
    decision: "approved",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin",
    rationale: "ok",
  });
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  return { run, task };
}

function ensureReplayPassed(runId: string): void {
  const latest = getEngineerConsoleDb()
    .prepare(
      `SELECT id, result_json FROM engineer_replay_verifications WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as { id: string; result_json: string } | undefined;
  if (!latest) return;
  const parsed = JSON.parse(latest.result_json) as { status?: string };
  parsed.status = "passed";
  getEngineerConsoleDb()
    .prepare(`UPDATE engineer_replay_verifications SET status = 'passed', result_json = @json WHERE id = @id`)
    .run({ id: latest.id, json: JSON.stringify(parsed) });
}

function insertPrAndMerge(runId: string, taskId: string) {
  const now = new Date().toISOString();
  const prId = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_pr_requests
        (id, run_id, task_id, branch_name, base_branch, status, readiness_status, readiness_json,
         pr_url, pr_number, actor_type, actor_label, created_at, updated_at)
       VALUES (@id, @run_id, @task_id, 'engineer/test', 'main', 'pr_created', 'passed', '{}',
         'https://github.com/o/r/pull/1', '1', 'human', 'admin', @created_at, @updated_at)`,
    )
    .run({ id: prId, run_id: runId, task_id: taskId, created_at: now, updated_at: now });
  const mergeId = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_merge_requests
        (id, run_id, pr_request_id, status, readiness_status, readiness_json,
         merge_sha, actor_type, actor_label, created_at, updated_at, completed_at)
       VALUES (@id, @run_id, @pr_id, 'merged', 'passed', '{}', 'mergeabc123',
         'human', 'admin', @created_at, @updated_at, @completed_at)`,
    )
    .run({
      id: mergeId,
      run_id: runId,
      pr_id: prId,
      created_at: now,
      updated_at: now,
      completed_at: now,
    });
}

async function seedApprovedDeployment(runId: string, environmentName: string) {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const check = createDeploymentReadinessCheck({
    runId,
    environmentId: env.id,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin@example.com",
  });
  const approval = await createDeploymentApproval({
    runId,
    readinessCheckId: check.id,
    decision: "approved",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin@example.com",
    rationale: environmentName === "production" ? "Production deploy approved." : undefined,
  });
  return { check, approval, env };
}

describe("deployment profile configuration", () => {
  it("blocks execution when no profiles configured", async () => {
    setDeploymentProfilesForTests([]);
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const readiness = evaluateDeploymentExecutionReadiness(
      run.id,
      approval.id,
      "staging-dashboard",
    );
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("No deployment profiles"))).toBe(true);
    setDeploymentProfilesForTests([TEST_PROFILE, PRODUCTION_PROFILE]);
  });

  it("blocks when profile environment mismatches approval environment", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const readiness = evaluateDeploymentExecutionReadiness(
      run.id,
      approval.id,
      "production-dashboard",
    );
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("does not match"))).toBe(true);
  });

  it("public profiles API shape excludes command and args", () => {
    const json = JSON.stringify(listPublicDeploymentProfiles());
    expect(json).not.toMatch(/workingDirectory|\/tmp\/deploy/);
    expect(json).not.toContain('"command"');
    expect(json).not.toContain('"args"');
  });

  it("blocks disabled profile at execution resolve", () => {
    setDeploymentProfilesForTests([{ ...TEST_PROFILE, allowed: false }]);
    expect(() => resolveExecutableDeploymentProfile("staging-dashboard")).toThrow(
      DeploymentExecutionError,
    );
    setDeploymentProfilesForTests([TEST_PROFILE, PRODUCTION_PROFILE]);
  });

  it("blocks unknown profile at execution resolve", () => {
    expect(() => resolveExecutableDeploymentProfile("does-not-exist")).toThrow(
      DeploymentExecutionError,
    );
  });

  it("blocks github_actions_future strategy even when allowed in JSON", () => {
    setDeploymentProfilesForTests([
      {
        ...TEST_PROFILE,
        name: "gha-future",
        strategy: "github_actions_future",
        allowed: true,
      },
    ]);
    const publicProfiles = listPublicDeploymentProfiles();
    expect(publicProfiles.find((p) => p.name === "gha-future")?.enabled).toBe(false);
    expect(() => resolveExecutableDeploymentProfile("gha-future")).toThrow(
      DeploymentExecutionError,
    );
    setDeploymentProfilesForTests([TEST_PROFILE, PRODUCTION_PROFILE]);
  });

  it("blocks unknown profile name in readiness evaluation", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const readiness = evaluateDeploymentExecutionReadiness(
      run.id,
      approval.id,
      "unknown-profile",
    );
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("not found"))).toBe(true);
  });
});

describe("deployment execution authorization", () => {
  it("rejects viewer for admin-only execution mutation", async () => {
    const hash = await hashPassword("pass");
    const viewer = createOperatorAccount({
      email: "viewer@example.com",
      displayName: "Viewer",
      passwordHash: hash,
      role: "viewer",
    });
    const session = createOperatorSession(viewer.id);
    const result = await authorizeMutation(
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          cookie: `ec_session=${encodeURIComponent(session.sessionToken)}`,
          [CSRF_HEADER_NAME]: session.csrfToken,
        },
      }),
      { minRole: "admin" },
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("rejects operator for admin-only execution mutation", async () => {
    const hash = await hashPassword("pass");
    const op = createOperatorAccount({
      email: "op@example.com",
      displayName: "Op",
      passwordHash: hash,
      role: "operator",
    });
    const session = createOperatorSession(op.id);
    const result = await authorizeMutation(
      new Request("http://localhost/", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          cookie: `ec_session=${encodeURIComponent(session.sessionToken)}`,
          [CSRF_HEADER_NAME]: session.csrfToken,
        },
      }),
      { minRole: "admin" },
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });
});

describe("deployment execution", () => {
  it("admin can execute approved deployment with configured command + args", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const record = await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(record.status).toBe("succeeded");
    expect(spawnCalls).toEqual([{ command: "echo", args: ["deploy-ok"] }]);
    expect(record.exitCode).toBe(0);
    expect(record.outputHash).toBeTruthy();
  });

  it("blocks execution when deployment approval is not approved", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const env = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const check = createDeploymentReadinessCheck({
      runId: run.id,
      environmentId: env.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin",
    });
    await expect(
      createDeploymentExecution({
        runId: run.id,
        deploymentApprovalId: (
          await createDeploymentApproval({
            runId: run.id,
            readinessCheckId: check.id,
            decision: "rejected",
            actorType: AUDIT_ACTOR_TYPES.HUMAN,
            actorLabel: "admin",
          })
        ).id,
        deploymentProfile: "staging-dashboard",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin",
      }),
    ).rejects.toThrow(DeploymentExecutionError);
  });

  it("blocks when readiness is blocked", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    getEngineerConsoleDb()
      .prepare(
        `UPDATE engineer_deployment_readiness_checks SET status = 'blocked' WHERE id = ?`,
      )
      .run(approval.readinessCheckId);
    await expect(
      createDeploymentExecution({
        runId: run.id,
        deploymentApprovalId: approval.id,
        deploymentProfile: "staging-dashboard",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin",
      }),
    ).rejects.toThrow(DeploymentExecutionError);
  });

  it("redacts secrets from output summary", () => {
    const summary = redactDeploymentOutput(
      "deploy complete api_key=secret123 token=abc password=pass authorization=Bearer xyz cookie=sess private_key=pk",
    );
    expect(summary).not.toContain("secret123");
    expect(summary).not.toContain("Bearer xyz");
    expect(summary).toContain("[redacted]");
  });

  it("does not persist raw secrets in database output columns", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const record = await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const row = getEngineerConsoleDb()
      .prepare(`SELECT output_summary, output_hash FROM engineer_deployment_executions WHERE id = ?`)
      .get(record.id) as { output_summary: string; output_hash: string };
    expect(row.output_summary).not.toContain("secret123");
    expect(row.output_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.output_summary.length).toBeLessThanOrEqual(900);
  });

  it("does not store full raw logs in public execution shape", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const record = await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const pub = toPublicDeploymentExecution(record);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("secret123");
    expect(pub).not.toHaveProperty("commandLabel");
    expect(json).not.toMatch(/"command"|"args"|workingDirectory/);
  });

  it("persists failed execution with error message", async () => {
    vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "deploy failed",
      timedOut: false,
    });
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const record = await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(record.status).toBe("failed");
    expect(record.errorMessage).toContain("exited");
  });

  it("emits deployment execution audit events on success", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const events = listAuditEventsForRun(run.id).filter((e) =>
      [
        AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_STARTED,
        AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_SUCCEEDED,
        AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_FAILED,
      ].includes(e.eventType),
    );
    const types = events.map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_SUCCEEDED);
    const payloads = JSON.stringify(events.map((e) => e.payload));
    expect(payloads).not.toContain("secret123");
    expect(payloads).not.toMatch(/stdout|stderr/);
  });

  it("emits DEPLOYMENT_EXECUTION_FAILED on timeout exit", async () => {
    vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
      exitCode: 124,
      stdout: "",
      stderr: "timed out",
      timedOut: true,
    });
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    const record = await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(record.status).toBe("failed");
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_FAILED);
  });

  it("emits DEPLOYMENT_EXECUTION_FAILED on non-zero exit", async () => {
    vi.mocked(mockExecutor.exec).mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "deploy failed",
      timedOut: false,
    });
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_EXECUTION_FAILED);
  });

  it("prevents duplicate successful execution for same approval", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    await expect(
      createDeploymentExecution({
        runId: run.id,
        deploymentApprovalId: approval.id,
        deploymentProfile: "staging-dashboard",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin@example.com",
      }),
    ).rejects.toThrow(DeploymentExecutionError);
  });

  it("models cannot execute deployment", async () => {
    await expect(
      createDeploymentExecution({
        runId: "x",
        deploymentApprovalId: "y",
        deploymentProfile: "staging-dashboard",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).rejects.toThrow(DeploymentExecutionError);
  });

  it("rejects client-supplied command override via profile name only", async () => {
    setDeploymentProfilesForTests([
      {
        ...TEST_PROFILE,
        name: "safe-profile",
        command: "echo",
        args: ["from-config"],
      },
    ]);
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "safe-profile",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(spawnCalls).toEqual([{ command: "echo", args: ["from-config"] }]);
    setDeploymentProfilesForTests([TEST_PROFILE, PRODUCTION_PROFILE]);
  });

  it("blocks execution when disabled profile selected in readiness", async () => {
    setDeploymentProfilesForTests([{ ...TEST_PROFILE, allowed: false }]);
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    await expect(
      createDeploymentExecution({
        runId: run.id,
        deploymentApprovalId: approval.id,
        deploymentProfile: "staging-dashboard",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin",
      }),
    ).rejects.toThrow(DeploymentExecutionError);
    setDeploymentProfilesForTests([TEST_PROFILE, PRODUCTION_PROFILE]);
  });

  it("updates evidence bundle deployment execution summary", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrAndMerge(run.id, task.id);
    const { approval } = await seedApprovedDeployment(run.id, "staging");
    await createDeploymentExecution({
      runId: run.id,
      deploymentApprovalId: approval.id,
      deploymentProfile: "staging-dashboard",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(listDeploymentExecutionsForRun(run.id).length).toBe(1);
    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.deploymentExecutions?.latestStatus).toBe("succeeded");
  });
});
