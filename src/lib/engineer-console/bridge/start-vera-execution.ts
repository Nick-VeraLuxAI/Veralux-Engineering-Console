import { executeRun } from "../orchestrator/run-orchestrator";
import { getRunById, updateRun } from "../run-manager/run-manager";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import type { EngineeringRun } from "../types";
import {
  auditVeraExecutionStartAccepted,
  auditVeraExecutionStartFailed,
  auditVeraExecutionStartRejected,
  auditVeraExecutionStartRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraExecutionStartReadiness } from "./vera-execution-start-readiness";
import { hasVeraExecutionStarted } from "./vera-execution-readiness";
import {
  parseVeraRunGovernanceNotes,
  VERA_EXECUTION_START_ACCEPTED_NOTE,
  VERA_EXECUTION_START_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";

export class VeraExecutionStartError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraExecutionStartError";
    this.code = code;
    this.status = status;
  }
}

export type StartVeraExecutionInput = {
  runId: string;
  confirmationText: string;
  startedBy: string;
};

export type StartVeraExecutionResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  executionStartAccepted: boolean;
  alreadyExisted: boolean;
  warning: string;
};

export type StartVeraExecutionDeps = {
  executeRunFn?: (runId: string) => Promise<void>;
};

function mergeGovernanceNotesForExecutionStart(
  existingNotes: string | null | undefined,
  detail: {
    startedBy: string;
    requestedAt: string;
    veraWorkOrderId: string | null;
  },
): string {
  const base = parseVeraRunGovernanceNotes(existingNotes);
  return JSON.stringify({
    ...base,
    veraExecutionStartRequested: true,
    executionStartedBy: detail.startedBy,
    executionStartRequestedAt: detail.requestedAt,
    veraWorkOrderId: detail.veraWorkOrderId ?? base.veraWorkOrderId ?? null,
    nonExecutionNote: VERA_EXECUTION_START_ACCEPTED_NOTE,
  });
}

export async function startVeraExecution(
  input: StartVeraExecutionInput,
  deps: StartVeraExecutionDeps = {},
): Promise<StartVeraExecutionResult> {
  const runId = input.runId.trim();
  const startedBy = input.startedBy.trim() || "operator";
  const executeRunFn = deps.executeRunFn ?? executeRun;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraExecutionStartRejected("", {
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
      startedBy,
    });
    throw new VeraExecutionStartError("NOT_FOUND", "Run not found.", 404);
  }

  const readiness = assessVeraExecutionStartReadiness(run.id);
  const veraWorkOrderId = readiness.veraWorkOrderId;

  auditVeraExecutionStartRequested(run.taskId, run.id, {
    startedBy,
    veraWorkOrderId,
    readinessOk: readiness.safeToStartVeraExecution,
  });

  const confirmation = input.confirmationText.trim();
  if (confirmation !== VERA_EXECUTION_START_CONFIRMATION_PHRASE) {
    auditVeraExecutionStartRejected(run.taskId, {
      runId: run.id,
      startedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_EXECUTION_START_CONFIRMATION_PHRASE}`,
    });
    throw new VeraExecutionStartError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_EXECUTION_START_CONFIRMATION_PHRASE}`,
    );
  }

  if (hasVeraExecutionStarted(run)) {
    const current = getRunById(run.id) ?? run;
    return {
      run: current,
      taskId: run.taskId,
      veraWorkOrderId,
      executionStartAccepted: true,
      alreadyExisted: true,
      warning:
        "Vera execution was already started or requested. Merge, deploy, PR, and release remain gated.",
    };
  }

  if (!readiness.safeToStartVeraExecution) {
    const message = readiness.reasons.join(" ");
    auditVeraExecutionStartRejected(run.taskId, {
      runId: run.id,
      startedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
    });
    throw new VeraExecutionStartError("READINESS_FAILED", message);
  }

  const requestedAt = new Date().toISOString();
  const marked = updateRun(run.id, {
    governanceNotes: mergeGovernanceNotesForExecutionStart(run.governanceNotes, {
      startedBy,
      requestedAt,
      veraWorkOrderId,
    }),
    agentMessage: VERA_EXECUTION_START_ACCEPTED_NOTE,
  });

  if (!marked) {
    throw new VeraExecutionStartError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera execution start metadata.",
      500,
    );
  }

  const task = getTaskById(run.taskId);
  if (task) {
    updateTask(task.id, { status: "queued" });
  }

  void executeRunFn(run.id).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    auditVeraExecutionStartFailed(run.taskId, run.id, {
      startedBy,
      veraWorkOrderId,
      message,
      centralExecutionFunctionCalled: true,
    });
  });

  const updatedRun = getRunById(run.id) ?? marked;
  auditVeraExecutionStartAccepted(run.taskId, run.id, {
    startedBy,
    veraWorkOrderId,
    centralExecutionFunctionCalled: true,
    status: updatedRun.status,
    currentStep: updatedRun.currentStep ?? null,
    startedAt: updatedRun.startedAt,
    branchName: updatedRun.branchName,
  });

  return {
    run: updatedRun,
    taskId: run.taskId,
    veraWorkOrderId,
    executionStartAccepted: true,
    alreadyExisted: false,
    warning:
      "Merge, deploy, PR creation, and release completion remain separately gated.",
  };
}
