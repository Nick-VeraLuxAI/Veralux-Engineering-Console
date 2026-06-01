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
    notCommitted: row.not_committed !== 0,
    notPushed: true,
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
