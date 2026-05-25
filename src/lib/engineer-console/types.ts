export const TASK_STATUSES = [
  "draft",
  "queued",
  "running",
  "waiting_for_approval",
  "approved",
  "failed",
  "stopped",
  "completed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
  "pending",
  "preparing_workspace",
  "creating_branch",
  "generating_patch",
  "applying_patch",
  "validating_worker_plan",
  "executing_worker_plan",
  "running_quality_gates",
  "waiting_for_approval",
  "failed",
  "completed",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface EngineeringTask {
  id: string;
  title: string;
  description: string;
  targetRepoPath: string;
  registeredRepoId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
}

export interface EngineeringRun {
  id: string;
  taskId: string;
  status: RunStatus;
  branchName: string | null;
  currentStep: string | null;
  modelRole: string;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  agentMessage: string | null;
  riskLevel: RiskLevel | null;
  governanceNotes: string | null;
}

export interface QualityGateResult {
  id: string;
  runId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
  createdAt: string;
}

export interface WorkerPlanReportSummary {
  workerPlanId: string;
  summary: string;
  validationStatus: string;
  executionStatus: string;
  executedCount: number;
  errorCount: number;
  executedOperations: Array<{
    type: string;
    path: string;
    reason: string;
  }>;
  validationErrors: Array<{ code: string; message: string }>;
  executionErrors: Array<{ code: string; message: string }>;
}

export interface ApprovalReport {
  taskSummary: string;
  branchName: string | null;
  changedFiles: string[];
  riskLevel: RiskLevel;
  governanceIssues: string[];
  qualityGateResults: QualityGateResult[];
  diffSummary: string;
  recommendedNextAction: string;
  canApprove: boolean;
  workerPlan?: WorkerPlanReportSummary | null;
}

export type ApprovalAction = "approve" | "request_fix" | "stop";
