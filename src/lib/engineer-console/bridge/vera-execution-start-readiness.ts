import { getLatestHermesDispatchForRun } from "../hermes-worker/hermes-dispatch-manager";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  hasVeraExecutionStartBeenRequested,
  parseVeraRunGovernanceNotes,
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";

const START_ELIGIBLE_STATUS: EngineeringRun["status"] = "pending";

export type VeraExecutionStartReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraExecutionStartReadinessResult = {
  ok: boolean;
  safeToStartVeraExecution: boolean;
  reasons: string[];
  checks: VeraExecutionStartReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  repoPath: string | null;
  task: EngineeringTask | null;
  run: EngineeringRun | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraExecutionStartReadinessCheck[],
  reasons: string[],
  id: string,
  ok: boolean,
  passMessage: string,
  failMessage: string,
): void {
  checks.push({ id, ok, message: ok ? passMessage : failMessage });
  if (!ok) reasons.push(failMessage);
}

export function assessVeraExecutionStartReadiness(
  runId: string,
): VeraExecutionStartReadinessResult {
  const checks: VeraExecutionStartReadinessCheck[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToStartVeraExecution: false,
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

  addCheck(
    checks,
    reasons,
    "vera_execution_approval_requested",
    governanceNotes.veraExecutionApprovalRequested === true,
    "Vera execution approval has been requested.",
    "Vera execution approval must be requested before start.",
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
    "approval_requested_step",
    run.currentStep === VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
    `Run currentStep is ${VERA_EXECUTION_APPROVAL_REQUESTED_STEP}.`,
    `Run must be in ${VERA_EXECUTION_APPROVAL_REQUESTED_STEP} before Vera execution start.`,
  );

  addCheck(
    checks,
    reasons,
    "pending_status",
    run.status === START_ELIGIBLE_STATUS,
    "Run status is pending.",
    `Run status must be pending (current: ${run.status}).`,
  );

  addCheck(
    checks,
    reasons,
    "started_at_null",
    run.startedAt === null,
    "Run startedAt is null.",
    "Run has already started.",
  );

  addCheck(
    checks,
    reasons,
    "branch_name_null",
    run.branchName === null,
    "Run branchName is null.",
    "Run branchName is already set.",
  );

  addCheck(
    checks,
    reasons,
    "no_prior_start_marker",
    !hasVeraExecutionStartBeenRequested(run.governanceNotes),
    "No prior Vera execution-start marker exists.",
    "Vera execution start has already been requested for this run.",
  );

  const veraWorkOrderId =
    governanceNotes.veraWorkOrderId ?? taskAnalysis?.veraWorkOrderId ?? null;
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

  return {
    ok: reasons.length === 0,
    safeToStartVeraExecution: reasons.length === 0,
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
