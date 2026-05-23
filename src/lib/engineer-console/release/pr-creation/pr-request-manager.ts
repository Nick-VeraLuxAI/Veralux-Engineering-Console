import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import {
  auditCommitCreated,
  auditCommitCreationFailed,
  auditPrCreated,
  auditPrCreationFailed,
  auditPrCreationStarted,
  auditPrReadinessEvaluated,
} from "../../governance/audit-ledger/pr-audit-lifecycle";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { checkoutBranch, verifyGitRepo } from "../../workspace/git-workspace";
import { createControlledGitCommit } from "./create-git-commit";
import { createControlledGithubPr } from "./create-github-pr";
import { evaluatePrReadiness } from "./evaluate-pr-readiness";
import type {
  CreatePrRequestInput,
  PrReadinessResult,
  PrRequestRecord,
  PrRequestStatus,
} from "./pr-creation-types";
import { PrCreationError } from "./pr-creation-types";

interface PrRequestRow {
  id: string;
  run_id: string;
  task_id: string | null;
  registered_repo_id: string | null;
  branch_name: string;
  base_branch: string;
  commit_sha: string | null;
  commit_message: string | null;
  pr_url: string | null;
  pr_number: string | null;
  status: string;
  readiness_status: string;
  readiness_json: string;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  policy_result_id: string | null;
  replay_verification_id: string | null;
  actor_type: string;
  actor_label: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: PrRequestRow): PrRequestRecord {
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    registeredRepoId: row.registered_repo_id,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    commitSha: row.commit_sha,
    commitMessage: row.commit_message,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    status: row.status as PrRequestRecord["status"],
    readinessStatus: row.readiness_status as PrRequestRecord["readinessStatus"],
    readinessJson: row.readiness_json,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    policyResultId: row.policy_result_id,
    replayVerificationId: row.replay_verification_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

function updatePrRequest(id: string, fields: Partial<PrRequestRow>): void {
  const current = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_pr_requests WHERE id = ?`)
    .get(id) as PrRequestRow | undefined;
  if (!current) return;

  const merged = { ...current, ...fields, updated_at: nowIso() };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_pr_requests SET
        status = @status,
        commit_sha = @commit_sha,
        commit_message = @commit_message,
        pr_url = @pr_url,
        pr_number = @pr_number,
        error_message = @error_message,
        completed_at = @completed_at,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: merged.status,
      commit_sha: merged.commit_sha,
      commit_message: merged.commit_message,
      pr_url: merged.pr_url,
      pr_number: merged.pr_number,
      error_message: merged.error_message,
      completed_at: merged.completed_at,
      updated_at: merged.updated_at,
    });
}

export function listPrRequestsForRun(runId: string): PrRequestRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_pr_requests WHERE run_id = ? ORDER BY created_at DESC`)
    .all(runId) as PrRequestRow[];
  return rows.map(mapRow);
}

export function getPrRequestById(id: string): PrRequestRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_pr_requests WHERE id = ?`)
    .get(id) as PrRequestRow | undefined;
  return row ? mapRow(row) : null;
}

export async function evaluateAndAuditPrReadiness(runId: string): Promise<PrReadinessResult> {
  const readiness = await evaluatePrReadiness(runId);
  const run = getRunById(runId);
  if (run) {
    auditPrReadinessEvaluated(runId, run.taskId, {
      readinessStatus: readiness.status,
      blockerCount: readiness.blockers.length,
      warningCount: readiness.warnings.length,
    });
  }
  return readiness;
}

export function toPublicPrRequest(record: PrRequestRecord) {
  let readiness: PrReadinessResult | null = null;
  try {
    readiness = JSON.parse(record.readinessJson) as PrReadinessResult;
  } catch {
    readiness = null;
  }
  return {
    id: record.id,
    runId: record.runId,
    branchName: record.branchName,
    baseBranch: record.baseBranch,
    commitSha: record.commitSha,
    commitShaPrefix: record.commitSha?.slice(0, 12) ?? null,
    commitMessage: record.commitMessage,
    prUrl: record.prUrl,
    prNumber: record.prNumber,
    status: record.status,
    readinessStatus: record.readinessStatus,
    readiness,
    evidenceBundleHashPrefix: record.evidenceBundleHash?.slice(0, 12) ?? null,
    actorLabel: record.actorLabel,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    errorMessage: record.errorMessage,
  };
}

export async function createPrRequest(input: CreatePrRequestInput): Promise<PrRequestRecord> {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new PrCreationError("Models cannot create commits or pull requests.");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new PrCreationError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new PrCreationError(`Task not found: ${run.taskId}`);
  }

  if (!run.branchName) {
    throw new PrCreationError("Run branch name is required for PR creation.");
  }

  const readiness = await evaluatePrReadiness(input.runId);
  auditPrReadinessEvaluated(input.runId, task.id, {
    readinessStatus: readiness.status,
    blockerCount: readiness.blockers.length,
    warningCount: readiness.warnings.length,
  });

  if (readiness.status === "blocked") {
    throw new PrCreationError(`PR creation blocked: ${readiness.blockers[0] ?? "readiness check failed"}`);
  }

  if (readiness.status === "requires_review" && !input.rationale?.trim()) {
    throw new PrCreationError("Rationale required when PR readiness has warnings or policy review items.");
  }

  const evidence = getEvidenceBundleForRun(input.runId);
  const policy = getLatestPolicyResult(input.runId);
  const replayRecord = getLatestReplayVerification(input.runId);
  const baseBranch = input.baseBranch?.trim() || "main";
  const draft = input.draft !== false;
  const now = nowIso();
  const id = uuidv4();

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_pr_requests
        (id, run_id, task_id, registered_repo_id, branch_name, base_branch,
         status, readiness_status, readiness_json,
         evidence_bundle_id, evidence_bundle_hash, policy_result_id, replay_verification_id,
         actor_type, actor_label, created_at, updated_at)
       VALUES
        (@id, @run_id, @task_id, @registered_repo_id, @branch_name, @base_branch,
         @status, @readiness_status, @readiness_json,
         @evidence_bundle_id, @evidence_bundle_hash, @policy_result_id, @replay_verification_id,
         @actor_type, @actor_label, @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      task_id: task.id,
      registered_repo_id: task.registeredRepoId,
      branch_name: run.branchName,
      base_branch: baseBranch,
      status: "ready",
      readiness_status: readiness.status,
      readiness_json: JSON.stringify(readiness),
      evidence_bundle_id: evidence?.id ?? null,
      evidence_bundle_hash: evidence?.bundleHash ?? null,
      policy_result_id: policy?.id ?? null,
      replay_verification_id: replayRecord?.id ?? null,
      actor_type: input.actorType,
      actor_label: input.actorLabel,
      created_at: now,
      updated_at: now,
    });

  const repoPath = resolveTaskTargetRepoPath(task);

  try {
    await verifyGitRepo(repoPath);
    await checkoutBranch(repoPath, run.branchName);

    updatePrRequest(id, { status: "committing" });
    const commit = await createControlledGitCommit(repoPath, input.runId);
    auditCommitCreated(input.runId, task.id, {
      prRequestId: id,
      commitShaPrefix: commit.commitSha.slice(0, 12),
      actorType: input.actorType,
      actorLabel: input.actorLabel,
    });

    updatePrRequest(id, {
      status: "committed",
      commit_sha: commit.commitSha,
      commit_message: commit.commitMessage,
    });

    auditPrCreationStarted(input.runId, task.id, {
      prRequestId: id,
      branchName: run.branchName,
      baseBranch,
      draft,
    });

    updatePrRequest(id, { status: "pushing" });
    const title = `${task.title} [Engineering Console]`;
    const pr = await createControlledGithubPr({
      repoPath,
      runId: input.runId,
      branchName: run.branchName,
      baseBranch,
      title,
      draft,
      rationale: input.rationale,
    });

    const completedAt = nowIso();
    updatePrRequest(id, {
      status: "pr_created",
      pr_url: pr.prUrl,
      pr_number: pr.prNumber,
      completed_at: completedAt,
    });

    auditPrCreated(input.runId, task.id, {
      prRequestId: id,
      prUrl: pr.prUrl,
      commitShaPrefix: commit.commitSha.slice(0, 12),
      readinessStatus: readiness.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePrRequest(id, {
      status: "failed",
      error_message: message.slice(0, 500),
      completed_at: nowIso(),
    });
    if (message.toLowerCase().includes("commit")) {
      auditCommitCreationFailed(input.runId, task.id, { prRequestId: id, message });
    } else {
      auditPrCreationFailed(input.runId, task.id, { prRequestId: id, message });
    }
    throw new PrCreationError(message);
  }

  return getPrRequestById(id)!;
}

export function summarizePrRequestsForRun(runId: string): {
  attemptCount: number;
  latestStatus: PrRequestStatus | null;
  latestPrUrl: string | null;
} {
  const requests = listPrRequestsForRun(runId);
  const latest = requests[0] ?? null;
  return {
    attemptCount: requests.length,
    latestStatus: latest?.status ?? null,
    latestPrUrl: latest?.prUrl ?? null,
  };
}
