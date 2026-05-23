import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import {
  auditMergeCompleted,
  auditMergeFailed,
  auditMergeReadinessEvaluated,
  auditMergeStarted,
} from "../../governance/audit-ledger/merge-audit-lifecycle";
import {
  getEvidenceBundleForRun,
  refreshRunEvidenceBundle,
} from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { getPrRequestById } from "../pr-creation/pr-request-manager";
import { mergeGithubPr, viewGithubPr } from "./controlled-gh-merge";
import { evaluateMergeReadiness } from "./evaluate-merge-readiness";
import type {
  CreateMergeRequestInput,
  MergeReadinessResult,
  MergeRequestRecord,
  MergeRequestStatus,
} from "./merge-control-types";
import { MergeControlError } from "./merge-control-types";

interface MergeRequestRow {
  id: string;
  run_id: string;
  pr_request_id: string;
  task_id: string | null;
  registered_repo_id: string | null;
  pr_url: string | null;
  pr_number: string | null;
  base_branch: string | null;
  head_branch: string | null;
  commit_sha: string | null;
  merge_sha: string | null;
  status: string;
  readiness_status: string;
  readiness_json: string;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  policy_result_id: string | null;
  replay_verification_id: string | null;
  actor_type: string;
  actor_label: string | null;
  rationale: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: MergeRequestRow): MergeRequestRecord {
  return {
    id: row.id,
    runId: row.run_id,
    prRequestId: row.pr_request_id,
    taskId: row.task_id,
    registeredRepoId: row.registered_repo_id,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    baseBranch: row.base_branch,
    headBranch: row.head_branch,
    commitSha: row.commit_sha,
    mergeSha: row.merge_sha,
    status: row.status as MergeRequestStatus,
    readinessStatus: row.readiness_status as MergeRequestRecord["readinessStatus"],
    readinessJson: row.readiness_json,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    policyResultId: row.policy_result_id,
    replayVerificationId: row.replay_verification_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    rationale: row.rationale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

function updateMergeRequest(id: string, fields: Partial<MergeRequestRow>): void {
  const current = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_merge_requests WHERE id = ?`)
    .get(id) as MergeRequestRow | undefined;
  if (!current) return;

  const merged = { ...current, ...fields, updated_at: nowIso() };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_merge_requests SET
        status = @status,
        merge_sha = @merge_sha,
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
      merge_sha: merged.merge_sha,
      pr_url: merged.pr_url,
      pr_number: merged.pr_number,
      error_message: merged.error_message,
      completed_at: merged.completed_at,
      updated_at: merged.updated_at,
    });
}

export function listMergeRequestsForRun(runId: string): MergeRequestRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_merge_requests WHERE run_id = ? ORDER BY created_at DESC`)
    .all(runId) as MergeRequestRow[];
  return rows.map(mapRow);
}

export function getMergeRequestById(id: string): MergeRequestRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_merge_requests WHERE id = ?`)
    .get(id) as MergeRequestRow | undefined;
  return row ? mapRow(row) : null;
}

export async function evaluateAndAuditMergeReadiness(
  runId: string,
  prRequestId?: string | null,
): Promise<MergeReadinessResult> {
  const readiness = await evaluateMergeReadiness(runId, prRequestId);
  const run = getRunById(runId);
  const prId = readiness.signals.prRequestId ?? prRequestId ?? "unknown";
  if (run) {
    auditMergeReadinessEvaluated(runId, run.taskId, {
      prRequestId: prId,
      readinessStatus: readiness.status,
      blockerCount: readiness.blockers.length,
      warningCount: readiness.warnings.length,
    });
  }
  return readiness;
}

export function toPublicMergeRequest(record: MergeRequestRecord) {
  let readiness: MergeReadinessResult | null = null;
  try {
    readiness = JSON.parse(record.readinessJson) as MergeReadinessResult;
  } catch {
    readiness = null;
  }
  return {
    id: record.id,
    runId: record.runId,
    prRequestId: record.prRequestId,
    prUrl: record.prUrl,
    prNumber: record.prNumber,
    baseBranch: record.baseBranch,
    headBranch: record.headBranch,
    commitShaPrefix: record.commitSha?.slice(0, 12) ?? null,
    mergeShaPrefix: record.mergeSha?.slice(0, 12) ?? null,
    status: record.status,
    readinessStatus: record.readinessStatus,
    readiness,
    evidenceBundleHashPrefix: record.evidenceBundleHash?.slice(0, 12) ?? null,
    actorLabel: record.actorLabel,
    rationale: record.rationale,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    errorMessage: record.errorMessage,
  };
}

export function summarizeMergeRequestsForRun(runId: string): {
  attemptCount: number;
  latestStatus: MergeRequestStatus | null;
  latestMergeShaPrefix: string | null;
} {
  const requests = listMergeRequestsForRun(runId);
  const latest = requests[0] ?? null;
  return {
    attemptCount: requests.length,
    latestStatus: latest?.status ?? null,
    latestMergeShaPrefix: latest?.mergeSha?.slice(0, 12) ?? null,
  };
}

export async function createMergeRequest(input: CreateMergeRequestInput): Promise<MergeRequestRecord> {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new MergeControlError("Models cannot merge pull requests.");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new MergeControlError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new MergeControlError(`Task not found: ${run.taskId}`);
  }

  const prRequest = getPrRequestById(input.prRequestId);
  if (!prRequest || prRequest.runId !== input.runId) {
    throw new MergeControlError("PR request not found for this run.");
  }

  const readiness = await evaluateMergeReadiness(input.runId, input.prRequestId);
  auditMergeReadinessEvaluated(input.runId, task.id, {
    prRequestId: prRequest.id,
    readinessStatus: readiness.status,
    blockerCount: readiness.blockers.length,
    warningCount: readiness.warnings.length,
    actorLabel: input.actorLabel,
  });

  if (readiness.status === "blocked") {
    throw new MergeControlError(`Merge blocked: ${readiness.blockers[0] ?? "readiness check failed"}`);
  }

  if (readiness.status === "requires_review" && !input.rationale?.trim()) {
    throw new MergeControlError(
      "Admin rationale required when merge readiness has warnings or policy review items.",
    );
  }

  const evidence = getEvidenceBundleForRun(input.runId);
  const policy = getLatestPolicyResult(input.runId);
  const replayRecord = getLatestReplayVerification(input.runId);
  const mergeMethod = input.mergeMethod === "merge" ? "merge" : "squash";
  const now = nowIso();
  const id = uuidv4();

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_merge_requests
        (id, run_id, pr_request_id, task_id, registered_repo_id,
         pr_url, pr_number, base_branch, head_branch, commit_sha,
         status, readiness_status, readiness_json,
         evidence_bundle_id, evidence_bundle_hash, policy_result_id, replay_verification_id,
         actor_type, actor_label, rationale, created_at, updated_at)
       VALUES
        (@id, @run_id, @pr_request_id, @task_id, @registered_repo_id,
         @pr_url, @pr_number, @base_branch, @head_branch, @commit_sha,
         @status, @readiness_status, @readiness_json,
         @evidence_bundle_id, @evidence_bundle_hash, @policy_result_id, @replay_verification_id,
         @actor_type, @actor_label, @rationale, @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      pr_request_id: prRequest.id,
      task_id: task.id,
      registered_repo_id: task.registeredRepoId,
      pr_url: prRequest.prUrl,
      pr_number: prRequest.prNumber,
      base_branch: prRequest.baseBranch,
      head_branch: prRequest.branchName,
      commit_sha: prRequest.commitSha,
      status: "ready",
      readiness_status: readiness.status,
      readiness_json: JSON.stringify(readiness),
      evidence_bundle_id: evidence?.id ?? null,
      evidence_bundle_hash: evidence?.bundleHash ?? null,
      policy_result_id: policy?.id ?? null,
      replay_verification_id: replayRecord?.id ?? null,
      actor_type: input.actorType,
      actor_label: input.actorLabel,
      rationale: input.rationale?.trim() || null,
      created_at: now,
      updated_at: now,
    });

  const repoPath = resolveTaskTargetRepoPath(task);

  try {
    const preView = await viewGithubPr(repoPath, prRequest.prNumber, prRequest.prUrl);
    if (preView.merged) {
      throw new MergeControlError("Pull request is already merged.");
    }

    updateMergeRequest(id, { status: "merging" });
    auditMergeStarted(input.runId, task.id, {
      mergeRequestId: id,
      prRequestId: prRequest.id,
      prNumber: prRequest.prNumber,
      mergeMethod,
      actorLabel: input.actorLabel,
    });

    await mergeGithubPr(repoPath, prRequest.prNumber, prRequest.prUrl, mergeMethod);

    const postView = await viewGithubPr(repoPath, prRequest.prNumber, prRequest.prUrl);
    const mergeSha = postView.mergeCommitOid ?? postView.headRefOid;
    const completedAt = nowIso();

    updateMergeRequest(id, {
      status: "merged",
      merge_sha: mergeSha,
      pr_url: postView.url || prRequest.prUrl,
      pr_number: prRequest.prNumber,
      completed_at: completedAt,
    });

    auditMergeCompleted(input.runId, task.id, {
      mergeRequestId: id,
      prRequestId: prRequest.id,
      prUrl: postView.url || prRequest.prUrl,
      mergeShaPrefix: mergeSha?.slice(0, 12) ?? null,
      readinessStatus: readiness.status,
      actorLabel: input.actorLabel,
    });

    await refreshRunEvidenceBundle({ runId: input.runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateMergeRequest(id, {
      status: "failed",
      error_message: message.slice(0, 500),
      completed_at: nowIso(),
    });
    auditMergeFailed(input.runId, task.id, {
      mergeRequestId: id,
      prRequestId: prRequest.id,
      message,
      actorLabel: input.actorLabel,
    });
    throw new MergeControlError(message);
  }

  return getMergeRequestById(id)!;
}
