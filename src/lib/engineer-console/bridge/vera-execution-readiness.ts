import { getLatestHermesDispatchForRun } from "../hermes-worker/hermes-dispatch-manager";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  parseVeraRunGovernanceNotes,
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";

const NON_EXECUTING_RUN_STATUSES = new Set<EngineeringRun["status"]>(["pending"]);

export type VeraExecutionReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraExecutionReadinessResult = {
  ok: boolean;
  safeToRequestExecutionApproval: boolean;
  reasons: string[];
  checks: VeraExecutionReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  repoPath: string | null;
  task: EngineeringTask | null;
  run: EngineeringRun | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraExecutionReadinessCheck[],
  reasons: string[],
  id: string,
  ok: boolean,
  passMessage: string,
  failMessage: string,
): void {
  checks.push({ id, ok, message: ok ? passMessage : failMessage });
  if (!ok) reasons.push(failMessage);
}

export function assessVeraExecutionReadiness(runId: string): VeraExecutionReadinessResult {
  const checks: VeraExecutionReadinessCheck[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();

  const run = trimmedRunId ? getRunById(trimmedRunId) : null;
  if (!run) {
    return {
      ok: false,
      safeToRequestExecutionApproval: false,
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      repoPath: null,
      task: null,
      run: null,
      governanceNotes: {},
    };
  }

  const task = getTaskById(run.taskId);
  addCheck(checks, reasons, "task_exists", Boolean(task), "Task exists.", "Task not found.");

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  addCheck(
    checks,
    reasons,
    "vera_handoff_marker",
    governanceNotes.veraHandoff === true,
    "Run governance notes include veraHandoff marker.",
    "Run governance notes must include veraHandoff: true.",
  );

  const taskAnalysis = task ? analyzeVeraHandoffTask(task) : null;
  addCheck(
    checks,
    reasons,
    "vera_task_handoff",
    taskAnalysis?.isVeraLuxOsHandoffTask === true,
    "Linked task is a VeraLux OS handoff.",
    "Linked task is not a VeraLux OS handoff.",
  );

  addCheck(
    checks,
    reasons,
    "run_task_link",
    Boolean(task && run.taskId === task.id),
    "Run is linked to the expected task.",
    "Run/task linkage is invalid.",
  );

  addCheck(
    checks,
    reasons,
    "prepared_step",
    run.currentStep === VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_RUN_PREPARED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_RUN_PREPARED_STEP} before requesting execution approval.`,
  );

  addCheck(
    checks,
    reasons,
    "pending_status",
    NON_EXECUTING_RUN_STATUSES.has(run.status),
    "Run status is non-executing (pending).",
    `Run status must remain pending (current: ${run.status}).`,
  );

  addCheck(
    checks,
    reasons,
    "started_at_null",
    run.startedAt === null,
    "Run startedAt is null.",
    "Run startedAt must be null.",
  );

  addCheck(
    checks,
    reasons,
    "branch_name_null",
    run.branchName === null,
    "Run branchName is null.",
    "Run branchName must be null.",
  );

  const veraWorkOrderId =
    governanceNotes.veraWorkOrderId ??
    taskAnalysis?.veraWorkOrderId ??
    null;
  addCheck(
    checks,
    reasons,
    "vera_work_order_id",
    Boolean(veraWorkOrderId?.trim()),
    "Vera work order ID is present.",
    "Vera work order ID is missing.",
  );

  addCheck(
    checks,
    reasons,
    "repo_binding",
    taskAnalysis?.repoBindingPresent === true,
    "Repo binding is present and valid.",
    "Valid repo binding is required.",
  );

  const hermesDispatch = getLatestHermesDispatchForRun(run.id);
  addCheck(
    checks,
    reasons,
    "no_worker_dispatch",
    !hermesDispatch,
    "No Hermes worker dispatch exists for this run.",
    "Hermes worker dispatch already exists for this run.",
  );

  const executionNotBegun =
    run.currentStep === VERA_IMPLEMENTATION_RUN_PREPARED_STEP &&
    run.startedAt === null &&
    run.branchName === null &&
    NON_EXECUTING_RUN_STATUSES.has(run.status);
  addCheck(
    checks,
    reasons,
    "execution_not_begun",
    executionNotBegun,
    "No execution state has begun.",
    "Execution state has already begun.",
  );

  return {
    ok: reasons.length === 0,
    safeToRequestExecutionApproval: reasons.length === 0,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    repoPath: taskAnalysis?.repoPath ?? null,
    task,
    run,
    governanceNotes,
  };
}

export function isVeraHandoffRun(run: EngineeringRun): boolean {
  return parseVeraRunGovernanceNotes(run.governanceNotes).veraHandoff === true;
}

export function isVeraExecutionApprovalRequested(run: EngineeringRun): boolean {
  const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
  return (
    run.currentStep === VERA_EXECUTION_APPROVAL_REQUESTED_STEP ||
    notes.veraExecutionApprovalRequested === true
  );
}

/** Vera handoff runs remain execution-blocked until a future execution phase (2K). */
export function isVeraRunExecutionBlocked(run: EngineeringRun): boolean {
  return isVeraHandoffRun(run);
}
