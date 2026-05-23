import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  closeEngineerConsoleDb,
  getEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../../governance/audit-ledger/audit-ledger-manager";
import { buildRunEvidenceBundle } from "../../governance/evidence-bundles/build-run-evidence-bundle";
import { buildRedactedReplayPackage } from "../../governance/replay-verification/replay-package-builder";
import { createRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { listDeploymentEnvironments } from "../deployment-gates/deployment-environments";
import { setDeploymentProfilesForTests } from "../deployment-execution/deployment-profile-config";
import {
  setControlledDeploymentExecutorForTests,
  type ControlledDeploymentExecutor,
} from "../deployment-execution/execute-deployment-profile";
import { setHealthCheckFetchForTests } from "../deployment-health-check/execute-http-health-check";
import { setHealthCheckProfilesForTests } from "../deployment-health-check/health-profile-config";
import { evaluateDeploymentHealthPolicy } from "./evaluate-deployment-health-policy";
import { DEFAULT_DEPLOYMENT_HEALTH_POLICY } from "./default-deployment-health-policy";
import { hashDeploymentHealthPolicyDefinition } from "./hash-deployment-health-policy";
import { DeploymentHealthPolicyError } from "./deployment-health-policy-types";
import {
  listDeploymentHealthPolicyResultsForRun,
  runDeploymentHealthPolicyEvaluation,
  toPublicDeploymentHealthPolicyResult,
} from "./deployment-health-policy-manager";

let tmpDb: string;

const mockDeployExecutor: ControlledDeploymentExecutor = {
  exec: vi.fn(async () => ({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    timedOut: false,
  })),
};

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-health-policy-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "deployment-health-policy-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  setDeploymentProfilesForTests([]);
  setHealthCheckProfilesForTests([]);
  setControlledDeploymentExecutorForTests(mockDeployExecutor);
  setHealthCheckFetchForTests(async () => new Response("ok", { status: 200 }));
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
});

function insertSucceededExecution(
  runId: string,
  environmentName: string,
): string {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const now = new Date().toISOString();
  const readinessId = uuidv4();
  const approvalId = uuidv4();
  const id = uuidv4();

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_readiness_checks
        (id, run_id, environment_id, status, readiness_json, actor_type, actor_label, created_at)
       VALUES (@id, @run_id, @env_id, 'passed', '{}', 'human', 'admin', @created_at)`,
    )
    .run({ id: readinessId, run_id: runId, env_id: env.id, created_at: now });

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_approvals
        (id, run_id, readiness_check_id, environment_id, decision, actor_type, actor_label, created_at)
       VALUES (@id, @run_id, @readiness_id, @env_id, 'approved', 'human', 'admin', @created_at)`,
    )
    .run({
      id: approvalId,
      run_id: runId,
      readiness_id: readinessId,
      env_id: env.id,
      created_at: now,
    });

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_executions
        (id, run_id, deployment_approval_id, readiness_check_id, environment_id, deployment_profile, status,
         actor_type, actor_label, created_at, updated_at, completed_at)
       VALUES
        (@id, @run_id, @approval_id, @readiness_id, @env_id, 'profile', 'succeeded',
         'human', 'admin', @created_at, @created_at, @completed_at)`,
    )
    .run({
      id,
      run_id: runId,
      approval_id: approvalId,
      readiness_id: readinessId,
      env_id: env.id,
      created_at: now,
      completed_at: now,
    });
  return id;
}

function insertHealthCheck(
  runId: string,
  executionId: string,
  status: string,
  environmentName: string,
): string {
  const env = listDeploymentEnvironments().find((e) => e.name === environmentName)!;
  const id = uuidv4();
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_checks
        (id, run_id, deployment_execution_id, environment_id, health_profile, status,
         response_status, response_time_ms, output_summary, output_hash,
         actor_type, actor_label, created_at, completed_at)
       VALUES
        (@id, @run_id, @exec_id, @env_id, 'health-profile', @status,
         200, 50, '[redacted]', 'abc123', 'human', 'op', @created_at, @completed_at)`,
    )
    .run({
      id,
      run_id: runId,
      exec_id: executionId,
      env_id: env.id,
      status,
      created_at: now,
      completed_at: now,
    });
  return id;
}

describe("deployment health policy evaluation", () => {
  it("returns not_checked when no successful deployment exists", () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const result = evaluateDeploymentHealthPolicy({ runId: run.id });
    expect(result.status).toBe("not_checked");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns not_checked for staging execution without health check", () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    const result = evaluateDeploymentHealthPolicy({
      runId: run.id,
      deploymentExecutionId: execId,
    });
    expect(result.status).toBe("not_checked");
  });

  it("returns needs_attention for production without health check", () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "production");
    const result = evaluateDeploymentHealthPolicy({
      runId: run.id,
      deploymentExecutionId: execId,
    });
    expect(result.status).toBe("needs_attention");
    expect(result.warnings.some((w) => w.includes("Production"))).toBe(true);
  });

  it("maps healthy health check to healthy policy status", () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "healthy", "staging");
    const result = evaluateDeploymentHealthPolicy({ runId: run.id });
    expect(result.status).toBe("healthy");
    expect(result.healthCheckId).toBeTruthy();
  });

  it("maps unhealthy health check to unhealthy policy status", () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "unhealthy", "staging");
    const result = evaluateDeploymentHealthPolicy({ runId: run.id });
    expect(result.status).toBe("unhealthy");
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("maps failed health check to needs_attention", () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "failed", "staging");
    const result = evaluateDeploymentHealthPolicy({ runId: run.id });
    expect(result.status).toBe("needs_attention");
  });

  it("produces stable policy hash", () => {
    const a = hashDeploymentHealthPolicyDefinition(DEFAULT_DEPLOYMENT_HEALTH_POLICY);
    const b = hashDeploymentHealthPolicyDefinition(DEFAULT_DEPLOYMENT_HEALTH_POLICY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("deployment health policy manager", () => {
  it("persists append-only policy history", async () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "healthy", "staging");

    await runDeploymentHealthPolicyEvaluation(run.id, {
      persist: true,
      audit: false,
      actorLabel: "op@example.com",
      refreshEvidence: false,
    });
    await runDeploymentHealthPolicyEvaluation(run.id, {
      persist: true,
      audit: false,
      actorLabel: "op@example.com",
      refreshEvidence: false,
    });

    const history = listDeploymentHealthPolicyResultsForRun(run.id);
    expect(history.length).toBe(2);
    expect(history[0].createdAt >= history[1].createdAt).toBe(true);
  });

  it("emits audit event on evaluation", async () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "healthy", "staging");

    await runDeploymentHealthPolicyEvaluation(run.id, {
      persist: true,
      audit: true,
      actorLabel: "op@example.com",
      refreshEvidence: false,
    });

    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.DEPLOYMENT_HEALTH_POLICY_EVALUATED);
    const payloads = JSON.stringify(listAuditEventsForRun(run.id).map((e) => e.payload));
    expect(payloads).not.toContain("secret");
    expect(payloads).not.toMatch(/output_summary|response body/i);
  });

  it("public result excludes full response bodies", async () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "healthy", "staging");

    await runDeploymentHealthPolicyEvaluation(run.id, {
      persist: true,
      audit: false,
      refreshEvidence: false,
    });

    const pub = toPublicDeploymentHealthPolicyResult(
      listDeploymentHealthPolicyResultsForRun(run.id)[0]!,
    );
    const json = JSON.stringify(pub);
    expect(json).not.toContain("output_summary");
    expect(json).not.toContain("checked_url");
    expect(pub).toHaveProperty("policyHashPrefix");
  });

  it("models cannot evaluate policy", async () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    await expect(
      runDeploymentHealthPolicyEvaluation(run.id, {
        actorType: AUDIT_ACTOR_TYPES.MODEL,
        actorLabel: "model",
      }),
    ).rejects.toThrow(DeploymentHealthPolicyError);
  });

  it("includes policy summary in evidence and replay package", async () => {
    const task = createTask({ title: "Policy", targetRepoPath: "/tmp" });
    const run = createRun(task.id);
    const execId = insertSucceededExecution(run.id, "staging");
    insertHealthCheck(run.id, execId, "healthy", "staging");

    await runDeploymentHealthPolicyEvaluation(run.id, {
      persist: true,
      audit: false,
      refreshEvidence: false,
    });

    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.deploymentHealthPolicy?.latestStatus).toBe("healthy");

    const replay = buildRedactedReplayPackage(run.id);
    expect(replay.deploymentHealthPolicy?.latestStatus).toBe("healthy");
    expect(JSON.stringify(replay.deploymentHealthPolicy)).not.toContain("output_summary");
  });
});
