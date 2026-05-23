import type {
  EngineeringRun,
  EngineeringTask,
  QualityGateResult,
  RiskLevel,
  RunStatus,
  TaskPriority,
  TaskStatus,
} from "../types";

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  target_repo_path: string;
  registered_repo_id: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  task_id: string;
  status: string;
  branch_name: string | null;
  current_step: string | null;
  model_role: string;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
  agent_message: string | null;
  risk_level: string | null;
  governance_notes: string | null;
}

export interface QualityGateRow {
  id: string;
  run_id: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  status: string;
  created_at: string;
}

export function mapTaskRow(row: TaskRow): EngineeringTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    targetRepoPath: row.target_repo_path,
    registeredRepoId: row.registered_repo_id ?? null,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRunRow(row: RunRow): EngineeringRun {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as RunStatus,
    branchName: row.branch_name,
    currentStep: row.current_step,
    modelRole: row.model_role,
    retryCount: row.retry_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    agentMessage: row.agent_message,
    riskLevel: row.risk_level as RiskLevel | null,
    governanceNotes: row.governance_notes,
  };
}

export function mapQualityGateRow(row: QualityGateRow): QualityGateResult {
  return {
    id: row.id,
    runId: row.run_id,
    command: row.command,
    stdout: row.stdout,
    stderr: row.stderr,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    status: row.status as QualityGateResult["status"],
    createdAt: row.created_at,
  };
}
