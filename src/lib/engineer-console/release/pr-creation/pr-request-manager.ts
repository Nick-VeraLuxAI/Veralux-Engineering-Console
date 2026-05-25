import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import {
  auditCommitCreated,
  auditCommitCreationFailed,
  auditPrCreated,
  auditPrCreationFailed,
  auditPrCreationResumed,
  auditPrCreationStarted,
  auditPrExistingCommitReused,
  auditPrExistingDetected,
  auditPrExistingRemoteBranchReused,
  auditPrReadinessEvaluated,
} from "../../governance/audit-ledger/pr-audit-lifecycle";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { checkoutBranch, verifyGitRepo } from "../../workspace/git-workspace";
import { buildCommitMessage } from "./build-commit-message";
import { createControlledGitCommit } from "./create-git-commit";
import { createControlledGithubPr } from "./create-github-pr";
import { isCommitReachableFromHead } from "./controlled-git-executor";
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

const RESUMABLE_REQUEST_STATUSES = new Set<PrRequestStatus>([
  "draft",
  "ready",
  "committing",
  "committed",
  "pushing",
  "failed",
]);

function updatePrRequest(id: string, fields: Partial<PrRequestRow>): void {
  const current = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_pr_requests WHERE id = ?`)
    .get(id) as PrRequestRow | undefined;
  if (!current) return;

  const merged = { ...current, ...fields, updated_at: nowIso() };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_pr_requests SET
        base_branch = @base_branch,
        status = @status,
        readiness_status = @readiness_status,
        readiness_json = @readiness_json,
        evidence_bundle_id = @evidence_bundle_id,
        evidence_bundle_hash = @evidence_bundle_hash,
        policy_result_id = @policy_result_id,
        replay_verification_id = @replay_verification_id,
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
      base_branch: merged.base_branch,
      status: merged.status,
      readiness_status: merged.readiness_status,
      readiness_json: merged.readiness_json,
      evidence_bundle_id: merged.evidence_bundle_id,
      evidence_bundle_hash: merged.evidence_bundle_hash,
      policy_result_id: merged.policy_result_id,
      replay_verification_id: merged.replay_verification_id,
      commit_sha: merged.commit_sha,
      commit_message: merged.commit_message,
      pr_url: merged.pr_url,
      pr_number: merged.pr_number,
      error_message: merged.error_message,
      completed_at: merged.completed_at,
      updated_at: merged.updated_at,
    });
}

function insertPrRequest(row: PrRequestRow): void {
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
      id: row.id,
      run_id: row.run_id,
      task_id: row.task_id,
      registered_repo_id: row.registered_repo_id,
      branch_name: row.branch_name,
      base_branch: row.base_branch,
      status: row.status,
      readiness_status: row.readiness_status,
      readiness_json: row.readiness_json,
      evidence_bundle_id: row.evidence_bundle_id,
      evidence_bundle_hash: row.evidence_bundle_hash,
      policy_result_id: row.policy_result_id,
      replay_verification_id: row.replay_verification_id,
      actor_type: row.actor_type,
      actor_label: row.actor_label,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
}

function isSamePrScope(record: PrRequestRecord, branchName: string, baseBranch: string): boolean {
  return record.branchName === branchName && record.baseBranch === baseBranch;
}

function findResumablePrRequest(
  runId: string,
  branchName: string,
  baseBranch: string,
): PrRequestRecord | null {
  return (
    listPrRequestsForRun(runId).find(
      (record) => isSamePrScope(record, branchName, baseBranch) && RESUMABLE_REQUEST_STATUSES.has(record.status),
    ) ?? null
  );
}

function findHistoricalCommitRequest(runId: string, branchName: string): PrRequestRecord | null {
  return (
    listPrRequestsForRun(runId).find((record) => record.branchName === branchName && !!record.commitSha) ?? null
  );
}

function findExistingPrRequest(runId: string, branchName: string): PrRequestRecord | null {
  return (
    listPrRequestsForRun(runId).find(
      (record) => record.branchName === branchName && record.status === "pr_created" && !!record.prUrl,
    ) ?? null
  );
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

const CLEAN_TREE_RECOVERY_MESSAGE =
  "No changed files are available to commit and no reusable run commit is recorded. Recovery required: restore the approved changes or resume from the existing run branch/commit before retrying PR creation.";

interface ResolvedPrCommit {
  commitSha: string;
  commitMessage: string;
  filesCommitted: string[];
  reused: boolean;
  reason: string;
}

async function resolveCommitForPrRequest(
  repoPath: string,
  runId: string,
  branchName: string,
  request: PrRequestRecord,
): Promise<ResolvedPrCommit> {
  const knownCommitRequest = request.commitSha
    ? request
    : (findHistoricalCommitRequest(runId, branchName) ?? null);

  if (knownCommitRequest?.commitSha) {
    const presentOnBranch = await isCommitReachableFromHead(repoPath, knownCommitRequest.commitSha);
    if (!presentOnBranch) {
      throw new PrCreationError(
        "A prior run commit is recorded, but it is not present on the run branch. Recovery required: restore the run branch or reapply the approved changes before retrying PR creation.",
      );
    }

    return {
      commitSha: knownCommitRequest.commitSha,
      commitMessage: knownCommitRequest.commitMessage ?? buildCommitMessage(runId),
      filesCommitted: [],
      reused: true,
      reason:
        knownCommitRequest.id === request.id
          ? "request already has recorded commit"
          : `reused commit from prior request ${knownCommitRequest.id}`,
    };
  }

  try {
    const created = await createControlledGitCommit(repoPath, runId);
    return {
      commitSha: created.commitSha,
      commitMessage: created.commitMessage,
      filesCommitted: created.filesCommitted,
      reused: false,
      reason: "created new controlled commit",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No changes to commit")) {
      throw new PrCreationError(CLEAN_TREE_RECOVERY_MESSAGE);
    }
    throw error;
  }
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
  const existingCreatedRequest = findExistingPrRequest(input.runId, run.branchName);
  if (existingCreatedRequest) {
    auditPrExistingDetected(input.runId, task.id, {
      prRequestId: existingCreatedRequest.id,
      branchName: existingCreatedRequest.branchName,
      commitShaPrefix: existingCreatedRequest.commitSha?.slice(0, 12) ?? null,
      prUrl: existingCreatedRequest.prUrl!,
      reason: "PR already recorded for run branch",
    });
    return existingCreatedRequest;
  }

  const existingRequest = findResumablePrRequest(input.runId, run.branchName, baseBranch);
  const requestId = existingRequest?.id ?? uuidv4();

  if (!existingRequest) {
    insertPrRequest({
      id: requestId,
      run_id: input.runId,
      task_id: task.id,
      registered_repo_id: task.registeredRepoId,
      branch_name: run.branchName,
      base_branch: baseBranch,
      commit_sha: null,
      commit_message: null,
      pr_url: null,
      pr_number: null,
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
      completed_at: null,
      error_message: null,
    });
  } else {
    updatePrRequest(existingRequest.id, {
      base_branch: baseBranch,
      status: existingRequest.commitSha ? "committed" : "ready",
      readiness_status: readiness.status,
      readiness_json: JSON.stringify(readiness),
      evidence_bundle_id: evidence?.id ?? null,
      evidence_bundle_hash: evidence?.bundleHash ?? null,
      policy_result_id: policy?.id ?? null,
      replay_verification_id: replayRecord?.id ?? null,
      error_message: null,
      completed_at: null,
    });
  }

  const repoPath = resolveTaskTargetRepoPath(task);
  const request = getPrRequestById(requestId)!;

  try {
    await verifyGitRepo(repoPath);
    await checkoutBranch(repoPath, run.branchName);

    const resuming = existingRequest !== null;
    if (resuming) {
      auditPrCreationResumed(input.runId, task.id, {
        prRequestId: request.id,
        branchName: run.branchName,
        baseBranch,
        reason: request.commitSha
          ? "continuing from existing commit"
          : "retrying failed or partial PR request",
      });
    }

    updatePrRequest(request.id, { status: "committing" });
    const commit = await resolveCommitForPrRequest(repoPath, input.runId, run.branchName, request);
    if (commit.reused) {
      auditPrExistingCommitReused(input.runId, task.id, {
        prRequestId: request.id,
        branchName: run.branchName,
        commitShaPrefix: commit.commitSha.slice(0, 12),
        reason: commit.reason,
      });
    } else {
      auditCommitCreated(input.runId, task.id, {
        prRequestId: request.id,
        commitShaPrefix: commit.commitSha.slice(0, 12),
        actorType: input.actorType,
        actorLabel: input.actorLabel,
      });
    }

    updatePrRequest(request.id, {
      status: "committed",
      commit_sha: commit.commitSha,
      commit_message: commit.commitMessage,
      error_message: null,
      completed_at: null,
    });

    if (!resuming) {
      auditPrCreationStarted(input.runId, task.id, {
        prRequestId: request.id,
        branchName: run.branchName,
        baseBranch,
        draft,
      });
    }

    updatePrRequest(request.id, { status: "pushing" });
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

    if (pr.pushStatus === "skipped_existing_remote") {
      auditPrExistingRemoteBranchReused(input.runId, task.id, {
        prRequestId: request.id,
        branchName: run.branchName,
        commitShaPrefix: commit.commitSha.slice(0, 12),
        reason: "branch already pushed with matching remote commit",
      });
    }

    const completedAt = nowIso();
    updatePrRequest(request.id, {
      status: "pr_created",
      pr_url: pr.prUrl,
      pr_number: pr.prNumber,
      completed_at: completedAt,
      error_message: null,
    });

    if (pr.createdNewPr) {
      auditPrCreated(input.runId, task.id, {
        prRequestId: request.id,
        prUrl: pr.prUrl,
        commitShaPrefix: commit.commitSha.slice(0, 12),
        readinessStatus: readiness.status,
      });
    } else {
      auditPrExistingDetected(input.runId, task.id, {
        prRequestId: request.id,
        branchName: run.branchName,
        commitShaPrefix: commit.commitSha.slice(0, 12),
        prUrl: pr.prUrl,
        reason: "existing PR detected for run branch",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePrRequest(request.id, {
      status: "failed",
      error_message: message.slice(0, 500),
      completed_at: nowIso(),
    });
    if (message.toLowerCase().includes("commit") || message.includes("No changed files")) {
      auditCommitCreationFailed(input.runId, task.id, { prRequestId: request.id, message });
    } else {
      auditPrCreationFailed(input.runId, task.id, { prRequestId: request.id, message });
    }
    throw new PrCreationError(message);
  }

  return getPrRequestById(request.id)!;
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
