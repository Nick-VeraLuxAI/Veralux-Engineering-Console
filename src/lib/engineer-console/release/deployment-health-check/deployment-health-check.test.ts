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
import { setDeploymentProfilesForTests } from "../deployment-execution/deployment-profile-config";
import {
  setControlledDeploymentExecutorForTests,
  type ControlledDeploymentExecutor,
} from "../deployment-execution/execute-deployment-profile";
import { createDeploymentExecution } from "../deployment-execution/deployment-execution-manager";
import {
  setHealthCheckFetchForTests,
  type HealthCheckFetchFn,
} from "./execute-http-health-check";
import { evaluateDeploymentHealthCheckReadiness } from "./evaluate-deployment-health-check-readiness";
import { DeploymentHealthCheckError } from "./deployment-health-check-types";
import {
  createDeploymentHealthCheck,
  listDeploymentHealthChecksForRun,
  toPublicDeploymentHealthCheck,
} from "./deployment-health-check-manager";
import {
  listPublicHealthCheckProfiles,
  resolveExecutableHealthProfile,
  setHealthCheckProfilesForTests,
} from "./health-profile-config";

const DEPLOY_PROFILE = {
  name: "staging-dashboard",
  environmentName: "staging",
  strategy: "fixed_command" as const,
  workingDirectory: "/tmp/deploy-workdir",
  command: "echo",
  args: ["deploy-ok"],
  allowed: true,
  timeoutMs: 5000,
};

const HEALTH_PROFILE = {
  name: "dashboard-staging-health",
  environmentName: "staging",
  type: "http" as const,
  url: "https://staging.example.com/api/health",
  expectedStatus: 200,
  allowed: true,
  timeoutMs: 5000,
};

const PRODUCTION_HEALTH = {
  ...HEALTH_PROFILE,
  name: "dashboard-production-health",
  environmentName: "production",
  url: "https://production.example.com/api/health",
};

let tmpDb: string;
let fetchCalls: Array<{ url: string; method: string | undefined }> = [];

const mockDeployExecutor: ControlledDeploymentExecutor = {
  exec: vi.fn(async () => ({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
  })),
};

const mockFetch: HealthCheckFetchFn = vi.fn(async (url, init) => {
  fetchCalls.push({ url, method: init.method });
  return new Response('{"status":"ok"}', {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-health-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "deployment-health-test";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
  process.env.ENGINEER_CONSOLE_SESSION_SECRET = "health-check-secret";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  fetchCalls = [];
  setDeploymentProfilesForTests([DEPLOY_PROFILE]);
  setHealthCheckProfilesForTests([HEALTH_PROFILE, PRODUCTION_HEALTH]);
  setControlledDeploymentExecutorForTests(mockDeployExecutor);
  setHealthCheckFetchForTests(mockFetch);
  vi.mocked(mockFetch).mockClear();
  vi.mocked(mockDeployExecutor.exec).mockClear();
});

afterEach(() => {
  setHealthCheckFetchForTests(null);
  setControlledDeploymentExecutorForTests(null);
  setHealthCheckProfilesForTests(null);
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
  const task = createTask({ title: "Health check", targetRepoPath: "/tmp/repo" });
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

async function seedSucceededDeployment(runId: string, taskId: string) {
  insertPrAndMerge(runId, taskId);
  const env = listDeploymentEnvironments().find((e) => e.name === "staging")!;
  const check = createDeploymentReadinessCheck({
    runId,
    environmentId: env.id,
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin",
  });
  const approval = await createDeploymentApproval({
    runId,
    readinessCheckId: check.id,
    decision: "approved",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin",
  });
  const execution = await createDeploymentExecution({
    runId,
    deploymentApprovalId: approval.id,
    deploymentProfile: "staging-dashboard",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin@example.com",
  });
  return execution;
}

describe("health profile configuration", () => {
  it("blocks when no health profiles configured", async () => {
    setHealthCheckProfilesForTests([]);
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    const readiness = evaluateDeploymentHealthCheckReadiness(
      run.id,
      execution.id,
      "dashboard-staging-health",
    );
    expect(readiness.status).toBe("blocked");
    setHealthCheckProfilesForTests([HEALTH_PROFILE, PRODUCTION_HEALTH]);
  });

  it("public profiles expose hostname only, not full url", () => {
    const json = JSON.stringify(listPublicHealthCheckProfiles());
    expect(json).not.toContain("staging.example.com/api/health");
    expect(json).not.toContain('"url"');
    expect(json).toContain("staging.example.com");
  });

  it("blocks unknown and disabled profiles", () => {
    setHealthCheckProfilesForTests([{ ...HEALTH_PROFILE, allowed: false }]);
    expect(() => resolveExecutableHealthProfile("dashboard-staging-health")).toThrow(
      DeploymentHealthCheckError,
    );
    setHealthCheckProfilesForTests([HEALTH_PROFILE, PRODUCTION_HEALTH]);
    expect(() => resolveExecutableHealthProfile("missing")).toThrow(DeploymentHealthCheckError);
  });

  it("blocks profile environment mismatch", async () => {
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    const readiness = evaluateDeploymentHealthCheckReadiness(
      run.id,
      execution.id,
      "dashboard-production-health",
    );
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.some((b) => b.includes("does not match"))).toBe(true);
  });
});

describe("deployment health check authorization", () => {
  it("rejects viewer for operator-only health check mutation", async () => {
    const hash = await hashPassword("pass");
    const viewer = createOperatorAccount({
      email: "viewer-hc@example.com",
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
      { minRole: "operator" },
    );
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });
});

describe("deployment health checks", () => {
  it("blocks when deployment execution is missing", async () => {
    const { run } = await seedApprovedRun();
    await expect(
      createDeploymentHealthCheck({
        runId: run.id,
        deploymentExecutionId: uuidv4(),
        healthProfile: "dashboard-staging-health",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "op@example.com",
      }),
    ).rejects.toThrow(DeploymentHealthCheckError);
  });

  it("blocks when deployment execution failed", async () => {
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_deployment_executions SET status = 'failed' WHERE id = ?`)
      .run(execution.id);
    await expect(
      createDeploymentHealthCheck({
        runId: run.id,
        deploymentExecutionId: execution.id,
        healthProfile: "dashboard-staging-health",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "op@example.com",
      }),
    ).rejects.toThrow(DeploymentHealthCheckError);
  });

  it("runs healthy check after successful deployment using configured URL only", async () => {
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    const record = await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    expect(record.status).toBe("healthy");
    expect(fetchCalls).toEqual([
      { url: HEALTH_PROFILE.url, method: "GET" },
    ]);
    expect(record.responseStatus).toBe(200);
  });

  it("persists unhealthy when response status mismatches", async () => {
    vi.mocked(mockFetch).mockResolvedValueOnce(
      new Response("error", { status: 503 }),
    );
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    const record = await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    expect(record.status).toBe("unhealthy");
    expect(record.errorMessage).toContain("503");
  });

  it("persists failed on timeout", async () => {
    vi.mocked(mockFetch).mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    const record = await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    expect(record.status).toBe("failed");
  });

  it("does not store full response body or secrets", async () => {
    const largeBody = `ok token=secret123 ${"x".repeat(20_000)}`;
    vi.mocked(mockFetch).mockResolvedValueOnce(new Response(largeBody, { status: 200 }));
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    const record = await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    const row = getEngineerConsoleDb()
      .prepare(`SELECT output_summary FROM engineer_deployment_health_checks WHERE id = ?`)
      .get(record.id) as { output_summary: string };
    expect(row.output_summary).not.toContain("secret123");
    expect(row.output_summary.length).toBeLessThanOrEqual(900);
    const pub = toPublicDeploymentHealthCheck(record);
    expect(JSON.stringify(pub)).not.toContain("secret123");
    expect(pub).not.toHaveProperty("checkedUrl");
  });

  it("emits health check audit events", async () => {
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_CHECK_STARTED);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_CHECK_HEALTHY);
  });

  it("allows rerun after prior healthy check", async () => {
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    expect(listDeploymentHealthChecksForRun(run.id).length).toBe(2);
  });

  it("models cannot run health checks", async () => {
    await expect(
      createDeploymentHealthCheck({
        runId: "x",
        deploymentExecutionId: "y",
        healthProfile: "dashboard-staging-health",
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).rejects.toThrow(DeploymentHealthCheckError);
  });

  it("updates evidence bundle health summary", async () => {
    const { run, task } = await seedApprovedRun();
    const execution = await seedSucceededDeployment(run.id, task.id);
    await createDeploymentHealthCheck({
      runId: run.id,
      deploymentExecutionId: execution.id,
      healthProfile: "dashboard-staging-health",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "op@example.com",
    });
    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.deploymentHealthChecks?.latestStatus).toBe("healthy");
  });
});
