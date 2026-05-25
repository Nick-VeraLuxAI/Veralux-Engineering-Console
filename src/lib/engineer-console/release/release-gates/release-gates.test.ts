import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  closeEngineerConsoleDb,
  getEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { buildApprovalReport } from "../../approval/approval-report";
import { assessChangedFiles } from "../../governance/governance-engine";
import { AUDIT_ACTOR_TYPES, AUDIT_EVENT_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../../governance/audit-ledger/audit-ledger-manager";
import { createDecisionRecord } from "../../governance/decision-records/decision-record-manager";
import { refreshRunEvidenceBundle } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { runPolicyEvaluation } from "../../governance/policy-results/policy-result-manager";
import { runReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import {
  completeReviewStageAction,
  listReviewStagesForRun,
  reconcileReviewStagesForRun,
} from "../../governance/review-stages/review-stage-manager";
import { handleApprovalAction } from "../../orchestrator/run-orchestrator";
import { createRun, saveApprovalReport, saveQualityGateResults, updateRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import { listDeploymentEnvironments } from "../deployment-gates/deployment-environments";
import { setDeploymentProfilesForTests } from "../deployment-execution/deployment-profile-config";
import { createMergeRequest } from "../merge-controls/merge-request-manager";
import { runReleaseChecklistEvaluation } from "../release-checklist/release-checklist-manager";
import { createReleaseSignoff } from "../release-signoff/release-signoff-manager";
import {
  assertHardReleaseGateOrThrow,
  evaluateHardReleaseGate,
  ReleaseGateError,
} from "./release-gate-manager";

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

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-release-gates-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "release-gates-test";
  process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  setDeploymentProfilesForTests([TEST_PROFILE]);
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
  delete process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED;
  setDeploymentProfilesForTests([]);
});

async function seedApprovedRun() {
  const changedFiles = ["src/a.ts"];
  const governance = assessChangedFiles(changedFiles);
  const task = createTask({ title: "Gates", targetRepoPath: "/tmp/repo" });
  const run = createRun(task.id);
  updateRun(run.id, {
    status: "completed",
    branchName: "engineer/test-branch",
    riskLevel: governance.riskLevel,
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
      durationMs: 10,
      status: "passed",
      createdAt: new Date().toISOString(),
    },
  ]);
  const report = buildApprovalReport({
    task,
    run: { ...run, status: "completed", branchName: "engineer/test-branch" },
    changedFiles,
    diffSummary: "1 file",
    governance,
    qualityGateResults: [],
  });
  saveApprovalReport(run.id, JSON.stringify(report));
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  reconcileReviewStagesForRun(run.id, { audit: false });
  await refreshRunEvidenceBundle({ runId: run.id, changedFiles });
  await runReplayVerification(run.id, { persist: true, audit: false });
  ensureReplayStatusPassed(run.id);
  for (const stage of listReviewStagesForRun(run.id).filter((s) => s.required)) {
    completeReviewStageAction({
      stageId: stage.id,
      action: "approve",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "reviewer",
    });
  }
  runPolicyEvaluation(run.id, { persist: true, audit: false });
  createDecisionRecord({
    runId: run.id,
    decision: "approved",
    actorType: AUDIT_ACTOR_TYPES.HUMAN,
    actorLabel: "admin@example.com",
    rationale: "approved",
  });
  return { task, run };
}

function insertPrRequest(runId: string, taskId: string): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_pr_requests
        (id, run_id, task_id, registered_repo_id, branch_name, base_branch, status,
         readiness_status, readiness_json, pr_url, pr_number, commit_sha,
         actor_type, actor_label, created_at, updated_at)
       VALUES
        (@id, @run_id, @task_id, NULL, 'engineer/test', 'main', 'pr_created',
         'passed', '{}', 'https://example.com/pr/1', '1', 'sha',
         'human', 'admin', @created_at, @updated_at)`,
    )
    .run({ id, run_id: runId, task_id: taskId, created_at: now, updated_at: now });
  return id;
}

function ensureReplayStatusPassed(runId: string): void {
  const latest = getEngineerConsoleDb()
    .prepare(
      `SELECT id, result_json FROM engineer_replay_verifications WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as { id: string; result_json: string } | undefined;
  if (!latest) return;
  const parsed = JSON.parse(latest.result_json) as { status?: string };
  parsed.status = "passed";
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_replay_verifications SET status = 'passed', result_json = @json WHERE id = @id`,
    )
    .run({ id: latest.id, json: JSON.stringify(parsed) });
}

function blockPolicy(runId: string): void {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT id, result_json FROM engineer_governance_policy_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as { id: string; result_json: string };
  const parsed = JSON.parse(row.result_json) as Record<string, unknown>;
  parsed.status = "blocked";
  parsed.blockers = ["Policy blocked for gate test."];
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_governance_policy_results SET status = 'blocked', result_json = @json WHERE id = @id`,
    )
    .run({ id: row.id, json: JSON.stringify(parsed) });
}

async function persistBlockedChecklist(runId: string) {
  blockPolicy(runId);
  return runReleaseChecklistEvaluation(runId, { persist: true, audit: false });
}

describe("release gate config", () => {
  it("feature flag disabled preserves passed evaluation", async () => {
    const { run } = await seedApprovedRun();
    process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED = "false";
    const evaluation = evaluateHardReleaseGate(run.id, "merge");
    expect(evaluation.enabled).toBe(false);
    expect(evaluation.status).toBe("passed");
    expect(() =>
      assertHardReleaseGateOrThrow(run.id, "merge", {
        actorLabel: "admin",
        audit: false,
      }),
    ).not.toThrow();
  });
});

describe("hard release gates enabled", () => {
  beforeEach(() => {
    process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED = "true";
  });

  it("blocks merge on blocked policy", async () => {
    const { run, task } = await seedApprovedRun();
    const prId = insertPrRequest(run.id, task.id);
    blockPolicy(run.id);
    const evaluation = evaluateHardReleaseGate(run.id, "merge");
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.blockers.some((b) => b.includes("policy"))).toBe(true);
    await expect(
      createMergeRequest({
        runId: run.id,
        prRequestId: prId,
        mergeMethod: "squash",
        actorType: AUDIT_ACTOR_TYPES.HUMAN,
        actorLabel: "admin",
      }),
    ).rejects.toThrow(/hard release gates/i);
  });

  it("blocks deployment execution on blocked checklist", async () => {
    const { run } = await seedApprovedRun();
    await persistBlockedChecklist(run.id);
    const evaluation = evaluateHardReleaseGate(run.id, "deployment_execution");
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.blockers.some((b) => b.toLowerCase().includes("checklist"))).toBe(true);
  });

  it("blocks deployment execution when sign-off rejected", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrRequest(run.id, task.id);
    await runReleaseChecklistEvaluation(run.id, { persist: true, audit: false });
    createReleaseSignoff({
      runId: run.id,
      decision: "rejected",
      rationale: "Not ready",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin",
    });

    const evaluation = evaluateHardReleaseGate(run.id, "deployment_execution");
    expect(evaluation.blockers.some((b) => b.includes("rejected"))).toBe(true);
  });

  it("allows completed_with_exceptions with needs_attention and rationale", async () => {
    const { run, task } = await seedApprovedRun();
    insertPrRequest(run.id, task.id);
    const checklist = await runReleaseChecklistEvaluation(run.id, { persist: true, audit: false });
    expect(checklist.status).toBe("needs_attention");

    const evaluation = evaluateHardReleaseGate(
      run.id,
      "release_signoff_completed_with_exceptions",
      { signoffRationale: "Documented waiver" },
    );
    expect(evaluation.status).toBe("passed");
  });

  it("blocks completed_with_exceptions without rationale", async () => {
    const { run } = await seedApprovedRun();
    await runReleaseChecklistEvaluation(run.id, { persist: true, audit: false });

    const evaluation = evaluateHardReleaseGate(run.id, "release_signoff_completed_with_exceptions", {
      signoffRationale: "",
    });
    expect(evaluation.status).toBe("blocked");
  });

  it("blocks completed sign-off when health policy unhealthy", async () => {
    const { run } = await seedApprovedRun();
    const env = listDeploymentEnvironments().find((e) => e.name === "staging")!;
    const now = new Date().toISOString();
    getEngineerConsoleDb()
      .prepare(
        `INSERT INTO engineer_deployment_health_policy_results
          (id, run_id, deployment_execution_id, environment_id, status, policy_version, policy_hash,
           result_json, actor_type, actor_label, created_at)
         VALUES
          (@id, @run_id, NULL, @env_id, 'unhealthy', '1.0.0', 'abc', '{}', 'human', 'op', @created_at)`,
      )
      .run({
        id: uuidv4(),
        run_id: run.id,
        env_id: env.id,
        created_at: now,
      });

    expect(() =>
      assertHardReleaseGateOrThrow(run.id, "release_signoff_completed", {
        actorLabel: "admin",
        audit: false,
      }),
    ).toThrow(ReleaseGateError);
  });

  it("emits HARD_RELEASE_GATE_PASSED when gate passes", async () => {
    const { run } = await seedApprovedRun();
    assertHardReleaseGateOrThrow(run.id, "merge", { actorLabel: "admin@example.com" });
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_EVALUATED);
    expect(types).toContain(AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_PASSED);
    const payloads = JSON.stringify(listAuditEventsForRun(run.id).map((e) => e.payload));
    expect(payloads).not.toMatch(/password|secret|stdout/i);
  });

  it("emits HARD_RELEASE_GATE_BLOCKED when gate blocks", async () => {
    const { run } = await seedApprovedRun();
    blockPolicy(run.id);
    try {
      assertHardReleaseGateOrThrow(run.id, "merge", { actorLabel: "admin" });
    } catch {
      /* expected */
    }
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).toContain(AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_BLOCKED);
  });

  it("returns clear blocker message from assertHardReleaseGateOrThrow", async () => {
    const { run } = await seedApprovedRun();
    getEngineerConsoleDb()
      .prepare(`DELETE FROM engineer_run_evidence_bundles WHERE run_id = ?`)
      .run(run.id);
    try {
      assertHardReleaseGateOrThrow(run.id, "merge", { actorLabel: "admin", audit: false });
      expect.fail("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ReleaseGateError);
      expect((error as ReleaseGateError).message).toMatch(/Evidence bundle/i);
    }
  });
});

describe("approval actions unaffected", () => {
  it("request_fix and stop do not invoke hard release gates", async () => {
    process.env.ENGINEER_CONSOLE_RELEASE_GATES_ENABLED = "true";
    const { run } = await seedApprovedRun();
    blockPolicy(run.id);
    const fix = await handleApprovalAction(run.id, "request_fix", {
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "operator",
      rationale: "needs work",
    });
    expect(fix).toBeTruthy();
    const types = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(types).not.toContain(AUDIT_EVENT_TYPES.HARD_RELEASE_GATE_BLOCKED);
  });
});

describe("release gates module safety", () => {
  it("does not use fetch or shell in release-gates sources", () => {
    const dir = path.join(__dirname);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/child_process|exec\(|spawn\(/);
    }
  });
});
