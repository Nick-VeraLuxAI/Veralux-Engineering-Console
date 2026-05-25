import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import { mapQualityGateRow, mapRunRow, type QualityGateRow, type RunRow } from "../db/rows";
import { auditRunCreated } from "../governance/audit-ledger/audit-lifecycle";
import type {
  EngineeringRun,
  QualityGateResult,
  RiskLevel,
  RunStatus,
} from "../types";
import type { QualityGateCommandResult } from "../quality-gates/quality-gate-runner";

function nowIso(): string {
  return new Date().toISOString();
}

export function createRun(taskId: string, modelRole = "engineer"): EngineeringRun {
  const db = getEngineerConsoleDb();
  const id = uuidv4();
  const run: EngineeringRun = {
    id,
    taskId,
    status: "pending",
    branchName: null,
    currentStep: "pending",
    modelRole,
    retryCount: 0,
    startedAt: null,
    completedAt: null,
    agentMessage: null,
    riskLevel: null,
    governanceNotes: null,
  };

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO engineering_runs
        (id, task_id, status, branch_name, current_step, model_role, retry_count,
         started_at, completed_at, agent_message, risk_level, governance_notes)
       VALUES
        (@id, @task_id, @status, @branch_name, @current_step, @model_role, @retry_count,
         @started_at, @completed_at, @agent_message, @risk_level, @governance_notes)`,
    ).run({
      id: run.id,
      task_id: run.taskId,
      status: run.status,
      branch_name: run.branchName,
      current_step: run.currentStep,
      model_role: run.modelRole,
      retry_count: run.retryCount,
      started_at: run.startedAt,
      completed_at: run.completedAt,
      agent_message: run.agentMessage,
      risk_level: run.riskLevel,
      governance_notes: run.governanceNotes,
    });

    auditRunCreated(run.id, run.taskId, { modelRole: run.modelRole });
  });

  insert();

  return run;
}

export function getRunById(id: string): EngineeringRun | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineering_runs WHERE id = ?`)
    .get(id) as RunRow | undefined;
  return row ? mapRunRow(row) : null;
}

export function listRunsForTask(taskId: string): EngineeringRun[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineering_runs WHERE task_id = ? ORDER BY started_at DESC`)
    .all(taskId) as RunRow[];
  return rows.map(mapRunRow);
}

export interface UpdateRunInput {
  status?: RunStatus;
  branchName?: string | null;
  currentStep?: string | null;
  agentMessage?: string | null;
  riskLevel?: RiskLevel | null;
  governanceNotes?: string | null;
  retryCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

export function updateRun(id: string, input: UpdateRunInput): EngineeringRun | null {
  const existing = getRunById(id);
  if (!existing) return null;

  const updated: EngineeringRun = {
    ...existing,
    status: input.status ?? existing.status,
    branchName: input.branchName !== undefined ? input.branchName : existing.branchName,
    currentStep: input.currentStep !== undefined ? input.currentStep : existing.currentStep,
    agentMessage:
      input.agentMessage !== undefined ? input.agentMessage : existing.agentMessage,
    riskLevel: input.riskLevel !== undefined ? input.riskLevel : existing.riskLevel,
    governanceNotes:
      input.governanceNotes !== undefined ? input.governanceNotes : existing.governanceNotes,
    retryCount: input.retryCount ?? existing.retryCount,
    startedAt: input.startedAt !== undefined ? input.startedAt : existing.startedAt,
    completedAt: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
  };

  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineering_runs SET
        status = @status,
        branch_name = @branch_name,
        current_step = @current_step,
        agent_message = @agent_message,
        risk_level = @risk_level,
        governance_notes = @governance_notes,
        retry_count = @retry_count,
        started_at = @started_at,
        completed_at = @completed_at
       WHERE id = @id`,
    )
    .run({
      id: updated.id,
      status: updated.status,
      branch_name: updated.branchName,
      current_step: updated.currentStep,
      agent_message: updated.agentMessage,
      risk_level: updated.riskLevel,
      governance_notes: updated.governanceNotes,
      retry_count: updated.retryCount,
      started_at: updated.startedAt,
      completed_at: updated.completedAt,
    });

  return updated;
}

export function clearQualityGateResultsForRun(runId: string): void {
  getEngineerConsoleDb()
    .prepare(`DELETE FROM quality_gate_results WHERE run_id = ?`)
    .run(runId);
}

export function saveQualityGateResults(
  runId: string,
  results: QualityGateCommandResult[],
): QualityGateResult[] {
  const db = getEngineerConsoleDb();
  const insert = db.prepare(
    `INSERT INTO quality_gate_results
      (id, run_id, command, stdout, stderr, exit_code, duration_ms, status, created_at)
     VALUES
      (@id, @run_id, @command, @stdout, @stderr, @exit_code, @duration_ms, @status, @created_at)`,
  );

  const saved: QualityGateResult[] = [];
  const createdAt = nowIso();

  for (const result of results) {
    const row: QualityGateResult = {
      id: uuidv4(),
      runId,
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      status: result.status,
      createdAt,
    };
    insert.run({
      id: row.id,
      run_id: row.runId,
      command: row.command,
      stdout: row.stdout,
      stderr: row.stderr,
      exit_code: row.exitCode,
      duration_ms: row.durationMs,
      status: row.status,
      created_at: row.createdAt,
    });
    saved.push(row);
  }

  return saved;
}

export function getQualityGateResultsForRun(runId: string): QualityGateResult[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM quality_gate_results WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId) as QualityGateRow[];
  return rows.map(mapQualityGateRow);
}

export function saveApprovalReport(runId: string, reportJson: string): void {
  const db = getEngineerConsoleDb();
  const now = nowIso();
  const existing = db
    .prepare(`SELECT id FROM approval_reports WHERE run_id = ?`)
    .get(runId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE approval_reports SET report_json = @report_json, updated_at = @updated_at WHERE run_id = @run_id`,
    ).run({ run_id: runId, report_json: reportJson, updated_at: now });
    return;
  }

  db.prepare(
    `INSERT INTO approval_reports (id, run_id, report_json, created_at, updated_at)
     VALUES (@id, @run_id, @report_json, @created_at, @updated_at)`,
  ).run({
    id: uuidv4(),
    run_id: runId,
    report_json: reportJson,
    created_at: now,
    updated_at: now,
  });
}

export function getApprovalReportJson(runId: string): string | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT report_json FROM approval_reports WHERE run_id = ?`)
    .get(runId) as { report_json: string } | undefined;
  return row?.report_json ?? null;
}

export function getApprovalReportForRun(
  runId: string,
): { id: string; reportJson: string } | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT id, report_json FROM approval_reports WHERE run_id = ?`)
    .get(runId) as { id: string; report_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, reportJson: row.report_json };
}
