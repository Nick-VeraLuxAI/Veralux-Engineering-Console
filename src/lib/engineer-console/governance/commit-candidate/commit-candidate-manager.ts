import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import type { CommitCandidateRecord, CommitCandidateStatus } from "./commit-candidate-types";

function nowIso(): string {
  return new Date().toISOString();
}

interface Row {
  id: string;
  run_id: string;
  status: string;
  branch_name: string;
  commit_message: string;
  changed_files_json: string;
  evidence_snapshot_hash: string;
  signoff_id: string;
  commit_packet_path: string;
  pr_draft_path: string;
  created_by: string;
  created_reason: string;
  created_at: string;
  local_commit_hash: string | null;
  local_commit_created_at: string | null;
  local_commit_created_by: string | null;
  local_commit_reason: string | null;
  local_commit_evidence_path: string | null;
  remote_push_status: string | null;
  remote_name: string | null;
  remote_branch_name: string | null;
  remote_ref: string | null;
  remote_pushed_at: string | null;
  remote_pushed_by: string | null;
  remote_push_reason: string | null;
  remote_push_evidence_path: string | null;
  pr_status: string | null;
  pr_provider: string | null;
  pr_base_branch: string | null;
  pr_head_branch: string | null;
  pr_url: string | null;
  pr_number: string | null;
  pr_created_at: string | null;
  pr_created_by: string | null;
  pr_create_reason: string | null;
  pr_evidence_path: string | null;
  merge_readiness_status: string | null;
  merge_readiness_decision: string | null;
  merge_readiness_reviewed_at: string | null;
  merge_readiness_reviewed_by: string | null;
  merge_readiness_reason: string | null;
  merge_readiness_evidence_path: string | null;
  not_committed: number;
  not_pushed: number;
  not_merged: number;
  not_deployed: number;
  not_complete: number;
}

function mapRow(row: Row): CommitCandidateRecord {
  return {
    id: row.id,
    runId: row.run_id,
    status: row.status as CommitCandidateStatus,
    branchName: row.branch_name,
    commitMessage: row.commit_message,
    changedFilesJson: row.changed_files_json,
    evidenceSnapshotHash: row.evidence_snapshot_hash,
    signoffId: row.signoff_id,
    commitPacketPath: row.commit_packet_path,
    prDraftPath: row.pr_draft_path,
    createdBy: row.created_by,
    createdReason: row.created_reason,
    createdAt: row.created_at,
    localCommitHash: row.local_commit_hash ?? null,
    localCommitCreatedAt: row.local_commit_created_at ?? null,
    localCommitCreatedBy: row.local_commit_created_by ?? null,
    localCommitReason: row.local_commit_reason ?? null,
    localCommitEvidencePath: row.local_commit_evidence_path ?? null,
    remotePushStatus: row.remote_push_status ?? null,
    remoteName: row.remote_name ?? null,
    remoteBranchName: row.remote_branch_name ?? null,
    remoteRef: row.remote_ref ?? null,
    remotePushedAt: row.remote_pushed_at ?? null,
    remotePushedBy: row.remote_pushed_by ?? null,
    remotePushReason: row.remote_push_reason ?? null,
    remotePushEvidencePath: row.remote_push_evidence_path ?? null,
    prStatus: row.pr_status ?? null,
    prProvider: row.pr_provider ?? null,
    prBaseBranch: row.pr_base_branch ?? null,
    prHeadBranch: row.pr_head_branch ?? null,
    prUrl: row.pr_url ?? null,
    prNumber: row.pr_number ?? null,
    prCreatedAt: row.pr_created_at ?? null,
    prCreatedBy: row.pr_created_by ?? null,
    prCreateReason: row.pr_create_reason ?? null,
    prEvidencePath: row.pr_evidence_path ?? null,
    mergeReadinessStatus: row.merge_readiness_status ?? null,
    mergeReadinessDecision: row.merge_readiness_decision ?? null,
    mergeReadinessReviewedAt: row.merge_readiness_reviewed_at ?? null,
    mergeReadinessReviewedBy: row.merge_readiness_reviewed_by ?? null,
    mergeReadinessReason: row.merge_readiness_reason ?? null,
    mergeReadinessEvidencePath: row.merge_readiness_evidence_path ?? null,
    notCommitted: row.not_committed !== 0,
    notPushed: row.not_pushed !== 0,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}

export function insertCommitCandidate(
  input: Omit<
    CommitCandidateRecord,
    | "id"
    | "createdAt"
    | "localCommitHash"
    | "localCommitCreatedAt"
    | "localCommitCreatedBy"
    | "localCommitReason"
    | "localCommitEvidencePath"
    | "remotePushStatus"
    | "remoteName"
    | "remoteBranchName"
    | "remoteRef"
    | "remotePushedAt"
    | "remotePushedBy"
    | "remotePushReason"
    | "remotePushEvidencePath"
    | "prStatus"
    | "prProvider"
    | "prBaseBranch"
    | "prHeadBranch"
    | "prUrl"
    | "prNumber"
    | "prCreatedAt"
    | "prCreatedBy"
    | "prCreateReason"
    | "prEvidencePath"
    | "mergeReadinessStatus"
    | "mergeReadinessDecision"
    | "mergeReadinessReviewedAt"
    | "mergeReadinessReviewedBy"
    | "mergeReadinessReason"
    | "mergeReadinessEvidencePath"
    | "notCommitted"
    | "notPushed"
    | "notMerged"
    | "notDeployed"
    | "notComplete"
  >,
): CommitCandidateRecord {
  const id = uuidv4();
  const createdAt = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_commit_candidates
        (id, run_id, status, branch_name, commit_message, changed_files_json, evidence_snapshot_hash,
         signoff_id, commit_packet_path, pr_draft_path, created_by, created_reason, created_at,
         not_committed, not_pushed, not_merged, not_deployed, not_complete)
       VALUES
        (@id, @run_id, @status, @branch_name, @commit_message, @changed_files_json, @evidence_snapshot_hash,
         @signoff_id, @commit_packet_path, @pr_draft_path, @created_by, @created_reason, @created_at,
         1, 1, 1, 1, 1)`,
    )
    .run({
      id,
      run_id: input.runId,
      status: input.status,
      branch_name: input.branchName,
      commit_message: input.commitMessage,
      changed_files_json: input.changedFilesJson,
      evidence_snapshot_hash: input.evidenceSnapshotHash,
      signoff_id: input.signoffId,
      commit_packet_path: input.commitPacketPath,
      pr_draft_path: input.prDraftPath,
      created_by: input.createdBy,
      created_reason: input.createdReason,
      created_at: createdAt,
    });
  return {
    ...input,
    id,
    createdAt,
    localCommitHash: null,
    localCommitCreatedAt: null,
    localCommitCreatedBy: null,
    localCommitReason: null,
    localCommitEvidencePath: null,
    remotePushStatus: null,
    remoteName: null,
    remoteBranchName: null,
    remoteRef: null,
    remotePushedAt: null,
    remotePushedBy: null,
    remotePushReason: null,
    remotePushEvidencePath: null,
    prStatus: null,
    prProvider: null,
    prBaseBranch: null,
    prHeadBranch: null,
    prUrl: null,
    prNumber: null,
    prCreatedAt: null,
    prCreatedBy: null,
    prCreateReason: null,
    prEvidencePath: null,
    mergeReadinessStatus: null,
    mergeReadinessDecision: null,
    mergeReadinessReviewedAt: null,
    mergeReadinessReviewedBy: null,
    mergeReadinessReason: null,
    mergeReadinessEvidencePath: null,
    notCommitted: true,
    notPushed: true,
    notMerged: true,
    notDeployed: true,
    notComplete: true,
  };
}

export function getCommitCandidateById(candidateId: string): CommitCandidateRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_commit_candidates WHERE id = ?`)
    .get(candidateId) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function listCommitCandidatesForRun(runId: string): CommitCandidateRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_commit_candidates WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as Row[];
  return rows.map(mapRow);
}

export function getLatestCommitCandidateForRun(runId: string): CommitCandidateRecord | null {
  return listCommitCandidatesForRun(runId)[0] ?? null;
}

export function markCommitCandidateLocalCommitCreated(input: {
  candidateId: string;
  localCommitHash: string;
  localCommitCreatedAt: string;
  localCommitCreatedBy: string;
  localCommitReason: string;
  localCommitEvidencePath: string;
}): void {
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_commit_candidates SET
        status = 'local_commit_created',
        local_commit_hash = @local_commit_hash,
        local_commit_created_at = @local_commit_created_at,
        local_commit_created_by = @local_commit_created_by,
        local_commit_reason = @local_commit_reason,
        local_commit_evidence_path = @local_commit_evidence_path,
        not_committed = 0
       WHERE id = @id`,
    )
    .run({
      id: input.candidateId,
      local_commit_hash: input.localCommitHash,
      local_commit_created_at: input.localCommitCreatedAt,
      local_commit_created_by: input.localCommitCreatedBy,
      local_commit_reason: input.localCommitReason,
      local_commit_evidence_path: input.localCommitEvidencePath,
    });
}

export function markCommitCandidateRemoteBranchPushed(input: {
  candidateId: string;
  remoteName: string;
  remoteBranchName: string;
  remoteRef: string;
  remotePushedAt: string;
  remotePushedBy: string;
  remotePushReason: string;
  remotePushEvidencePath: string;
}): void {
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_commit_candidates SET
        status = 'remote_branch_pushed',
        remote_push_status = 'remote_branch_pushed',
        remote_name = @remote_name,
        remote_branch_name = @remote_branch_name,
        remote_ref = @remote_ref,
        remote_pushed_at = @remote_pushed_at,
        remote_pushed_by = @remote_pushed_by,
        remote_push_reason = @remote_push_reason,
        remote_push_evidence_path = @remote_push_evidence_path,
        not_pushed = 0
       WHERE id = @id`,
    )
    .run({
      id: input.candidateId,
      remote_name: input.remoteName,
      remote_branch_name: input.remoteBranchName,
      remote_ref: input.remoteRef,
      remote_pushed_at: input.remotePushedAt,
      remote_pushed_by: input.remotePushedBy,
      remote_push_reason: input.remotePushReason,
      remote_push_evidence_path: input.remotePushEvidencePath,
    });
}

export function markCommitCandidatePullRequestCreated(input: {
  candidateId: string;
  status: "pull_request_created" | "pull_request_packet_prepared";
  prProvider: string;
  prBaseBranch: string;
  prHeadBranch: string;
  prUrl: string | null;
  prNumber: string | null;
  prCreatedAt: string;
  prCreatedBy: string;
  prCreateReason: string;
  prEvidencePath: string;
}): void {
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_commit_candidates SET
        status = @status,
        pr_status = @pr_status,
        pr_provider = @pr_provider,
        pr_base_branch = @pr_base_branch,
        pr_head_branch = @pr_head_branch,
        pr_url = @pr_url,
        pr_number = @pr_number,
        pr_created_at = @pr_created_at,
        pr_created_by = @pr_created_by,
        pr_create_reason = @pr_create_reason,
        pr_evidence_path = @pr_evidence_path
       WHERE id = @id`,
    )
    .run({
      id: input.candidateId,
      status: input.status,
      pr_status: input.status,
      pr_provider: input.prProvider,
      pr_base_branch: input.prBaseBranch,
      pr_head_branch: input.prHeadBranch,
      pr_url: input.prUrl,
      pr_number: input.prNumber,
      pr_created_at: input.prCreatedAt,
      pr_created_by: input.prCreatedBy,
      pr_create_reason: input.prCreateReason,
      pr_evidence_path: input.prEvidencePath,
    });
}

export function markCommitCandidateMergeReadinessRecorded(input: {
  candidateId: string;
  mergeReadinessDecision: string;
  mergeReadinessReviewedAt: string;
  mergeReadinessReviewedBy: string;
  mergeReadinessReason: string;
  mergeReadinessEvidencePath: string;
}): void {
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_commit_candidates SET
        status = 'merge_readiness_recorded',
        merge_readiness_status = 'merge_readiness_recorded',
        merge_readiness_decision = @merge_readiness_decision,
        merge_readiness_reviewed_at = @merge_readiness_reviewed_at,
        merge_readiness_reviewed_by = @merge_readiness_reviewed_by,
        merge_readiness_reason = @merge_readiness_reason,
        merge_readiness_evidence_path = @merge_readiness_evidence_path
       WHERE id = @id`,
    )
    .run({
      id: input.candidateId,
      merge_readiness_decision: input.mergeReadinessDecision,
      merge_readiness_reviewed_at: input.mergeReadinessReviewedAt,
      merge_readiness_reviewed_by: input.mergeReadinessReviewedBy,
      merge_readiness_reason: input.mergeReadinessReason,
      merge_readiness_evidence_path: input.mergeReadinessEvidencePath,
    });
}
