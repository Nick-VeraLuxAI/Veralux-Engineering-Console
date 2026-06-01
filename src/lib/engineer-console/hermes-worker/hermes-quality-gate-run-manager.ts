import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";

function nowIso(): string {
  return new Date().toISOString();
}

export type HermesQualityGateRunStatus = "passed" | "failed" | "skipped";

export interface HermesQualityGateRunRecord {
  id: string;
  runId: string;
  patchApplicationId: string;
  dispatchId: string;
  batchId: string;
  gateId: string;
  command: string;
  status: HermesQualityGateRunStatus;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  resultArtifactPath: string;
  stdoutArtifactPath: string;
  stderrArtifactPath: string;
  operatorBy: string;
  operatorReason: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

interface Row {
  id: string;
  run_id: string;
  patch_application_id: string;
  dispatch_id: string;
  batch_id: string;
  gate_id: string;
  command: string;
  status: string;
  exit_code: number;
  duration_ms: number;
  timed_out: number;
  result_artifact_path: string;
  stdout_artifact_path: string;
  stderr_artifact_path: string;
  operator_by: string;
  operator_reason: string;
  started_at: string;
  finished_at: string;
  created_at: string;
}

function mapRow(row: Row): HermesQualityGateRunRecord {
  return {
    id: row.id,
    runId: row.run_id,
    patchApplicationId: row.patch_application_id,
    dispatchId: row.dispatch_id,
    batchId: row.batch_id,
    gateId: row.gate_id,
    command: row.command,
    status: row.status as HermesQualityGateRunStatus,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    timedOut: row.timed_out === 1,
    resultArtifactPath: row.result_artifact_path,
    stdoutArtifactPath: row.stdout_artifact_path,
    stderrArtifactPath: row.stderr_artifact_path,
    operatorBy: row.operator_by,
    operatorReason: row.operator_reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

export function insertHermesQualityGateRun(
  input: Omit<HermesQualityGateRunRecord, "id" | "createdAt">,
): HermesQualityGateRunRecord {
  const id = uuidv4();
  const createdAt = nowIso();
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_hermes_quality_gate_runs
        (id, run_id, patch_application_id, dispatch_id, batch_id, gate_id, command, status,
         exit_code, duration_ms, timed_out, result_artifact_path, stdout_artifact_path,
         stderr_artifact_path, operator_by, operator_reason, started_at, finished_at, created_at)
       VALUES
        (@id, @run_id, @patch_application_id, @dispatch_id, @batch_id, @gate_id, @command, @status,
         @exit_code, @duration_ms, @timed_out, @result_artifact_path, @stdout_artifact_path,
         @stderr_artifact_path, @operator_by, @operator_reason, @started_at, @finished_at, @created_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      patch_application_id: input.patchApplicationId,
      dispatch_id: input.dispatchId,
      batch_id: input.batchId,
      gate_id: input.gateId,
      command: input.command,
      status: input.status,
      exit_code: input.exitCode,
      duration_ms: input.durationMs,
      timed_out: input.timedOut ? 1 : 0,
      result_artifact_path: input.resultArtifactPath,
      stdout_artifact_path: input.stdoutArtifactPath,
      stderr_artifact_path: input.stderrArtifactPath,
      operator_by: input.operatorBy,
      operator_reason: input.operatorReason,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      created_at: createdAt,
    });
  return { ...input, id, createdAt };
}

export function listHermesQualityGateRunsForRun(runId: string): HermesQualityGateRunRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_hermes_quality_gate_runs WHERE run_id = ? ORDER BY finished_at DESC`,
    )
    .all(runId) as Row[];
  return rows.map(mapRow);
}

export function listHermesQualityGateRunsForBatch(batchId: string): HermesQualityGateRunRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_hermes_quality_gate_runs WHERE batch_id = ? ORDER BY gate_id ASC`,
    )
    .all(batchId) as Row[];
  return rows.map(mapRow);
}
