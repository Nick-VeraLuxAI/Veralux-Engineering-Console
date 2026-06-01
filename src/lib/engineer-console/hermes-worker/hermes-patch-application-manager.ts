import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";

function nowIso(): string {
  return new Date().toISOString();
}

export type HermesPatchApplicationStatus = "applied" | "rolled_back";

export interface HermesPatchApplicationRecord {
  id: string;
  runId: string;
  dispatchId: string;
  status: HermesPatchApplicationStatus;
  packetHash: string;
  patchHash: string;
  changedFilesJson: string;
  rollbackArtifactPath: string;
  applyResultPath: string;
  appliedBy: string;
  applyReason: string;
  appliedAt: string;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
  rolledBackReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PatchApplicationRow {
  id: string;
  run_id: string;
  dispatch_id: string;
  status: string;
  packet_hash: string;
  patch_hash: string;
  changed_files_json: string;
  rollback_artifact_path: string;
  apply_result_path: string;
  applied_by: string;
  apply_reason: string;
  applied_at: string;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  rolled_back_reason: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: PatchApplicationRow): HermesPatchApplicationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    dispatchId: row.dispatch_id,
    status: row.status as HermesPatchApplicationStatus,
    packetHash: row.packet_hash,
    patchHash: row.patch_hash,
    changedFilesJson: row.changed_files_json,
    rollbackArtifactPath: row.rollback_artifact_path,
    applyResultPath: row.apply_result_path,
    appliedBy: row.applied_by,
    applyReason: row.apply_reason,
    appliedAt: row.applied_at,
    rolledBackAt: row.rolled_back_at,
    rolledBackBy: row.rolled_back_by,
    rolledBackReason: row.rolled_back_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getHermesPatchApplicationByDispatchId(
  dispatchId: string,
): HermesPatchApplicationRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_hermes_patch_applications WHERE dispatch_id = ?`)
    .get(dispatchId) as PatchApplicationRow | undefined;
  return row ? mapRow(row) : null;
}

export function getHermesPatchApplicationForRun(
  runId: string,
): HermesPatchApplicationRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_hermes_patch_applications WHERE run_id = ? ORDER BY applied_at DESC LIMIT 1`,
    )
    .get(runId) as PatchApplicationRow | undefined;
  return row ? mapRow(row) : null;
}

export function insertHermesPatchApplication(input: {
  runId: string;
  dispatchId: string;
  packetHash: string;
  patchHash: string;
  changedFiles: string[];
  rollbackArtifactPath: string;
  applyResultPath: string;
  appliedBy: string;
  applyReason: string;
}): HermesPatchApplicationRecord {
  const now = nowIso();
  const id = uuidv4();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_hermes_patch_applications
        (id, run_id, dispatch_id, status, packet_hash, patch_hash, changed_files_json,
         rollback_artifact_path, apply_result_path, applied_by, apply_reason, applied_at,
         rolled_back_at, created_at, updated_at)
       VALUES
        (@id, @run_id, @dispatch_id, 'applied', @packet_hash, @patch_hash, @changed_files_json,
         @rollback_artifact_path, @apply_result_path, @applied_by, @apply_reason, @applied_at,
         NULL, @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      dispatch_id: input.dispatchId,
      packet_hash: input.packetHash,
      patch_hash: input.patchHash,
      changed_files_json: JSON.stringify(input.changedFiles),
      rollback_artifact_path: input.rollbackArtifactPath,
      apply_result_path: input.applyResultPath,
      applied_by: input.appliedBy,
      apply_reason: input.applyReason,
      applied_at: now,
      created_at: now,
      updated_at: now,
    });

  const record = getHermesPatchApplicationByDispatchId(input.dispatchId);
  if (!record) throw new Error("Patch application record missing after insert");
  return record;
}

export function markHermesPatchRolledBack(
  dispatchId: string,
  input: { rolledBackBy: string; rolledBackReason: string },
): HermesPatchApplicationRecord {
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_hermes_patch_applications SET
        status = 'rolled_back',
        rolled_back_at = @rolled_back_at,
        rolled_back_by = @rolled_back_by,
        rolled_back_reason = @rolled_back_reason,
        updated_at = @updated_at
       WHERE dispatch_id = @dispatch_id`,
    )
    .run({
      dispatch_id: dispatchId,
      rolled_back_at: now,
      rolled_back_by: input.rolledBackBy,
      rolled_back_reason: input.rolledBackReason,
      updated_at: now,
    });
  const record = getHermesPatchApplicationByDispatchId(dispatchId);
  if (!record) throw new Error("Patch application record missing after rollback");
  return record;
}
