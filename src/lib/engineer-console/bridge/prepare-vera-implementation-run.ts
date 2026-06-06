import {
  auditVeraImplementationRunPrepareRejected,
  auditVeraImplementationRunPrepared,
  auditVeraImplementationRunPrepareRequested,
} from "./vera-handoff-audit-lifecycle";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE,
  VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
} from "./vera-handoff-task-types";
import { createRun, listRunsForTask, updateRun } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun } from "../types";

export const VERA_PREPARED_RUN_NON_EXECUTION_NOTE =
  "Run prepared — execution still gated. No code was executed." as const;

export class VeraImplementationRunPrepareError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraImplementationRunPrepareError";
    this.code = code;
    this.status = status;
  }
}

export type PrepareVeraImplementationRunInput = {
  taskId: string;
  confirmationText: string;
  preparedBy: string;
};

export type PrepareVeraImplementationRunResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  alreadyExisted: boolean;
  nonExecutionNote: typeof VERA_PREPARED_RUN_NON_EXECUTION_NOTE;
};

export function isVeraPreparedRun(run: EngineeringRun): boolean {
  if (run.currentStep === VERA_IMPLEMENTATION_RUN_PREPARED_STEP) return true;
  if (!run.governanceNotes?.trim()) return false;
  try {
    const parsed = JSON.parse(run.governanceNotes) as { veraHandoff?: boolean };
    return parsed.veraHandoff === true;
  } catch {
    return false;
  }
}

export function findVeraPreparedRunForTask(taskId: string): EngineeringRun | null {
  const runs = listRunsForTask(taskId);
  return runs.find((run) => isVeraPreparedRun(run)) ?? null;
}

function buildPreparedRunGovernanceNotes(input: {
  veraWorkOrderId: string | null;
  preparedBy: string;
  preparedAt: string;
}): string {
  return JSON.stringify({
    veraHandoff: true,
    veraWorkOrderId: input.veraWorkOrderId,
    preparedBy: input.preparedBy,
    preparedAt: input.preparedAt,
    nonExecutionNote: VERA_PREPARED_RUN_NON_EXECUTION_NOTE,
  });
}

function createVeraPreparedRunRecord(
  taskId: string,
  detail: {
    veraWorkOrderId: string | null;
    preparedBy: string;
  },
): EngineeringRun {
  const preparedAt = new Date().toISOString();
  const run = createRun(taskId);
  const updated = updateRun(run.id, {
    currentStep: VERA_IMPLEMENTATION_RUN_PREPARED_STEP,
    governanceNotes: buildPreparedRunGovernanceNotes({
      veraWorkOrderId: detail.veraWorkOrderId,
      preparedBy: detail.preparedBy,
      preparedAt,
    }),
    agentMessage: VERA_PREPARED_RUN_NON_EXECUTION_NOTE,
  });
  if (!updated) {
    throw new VeraImplementationRunPrepareError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera prepared run metadata.",
      500,
    );
  }
  return updated;
}

export function prepareVeraImplementationRun(
  input: PrepareVeraImplementationRunInput,
): PrepareVeraImplementationRunResult {
  const taskId = input.taskId.trim();
  const preparedBy = input.preparedBy.trim() || "operator";
  const task = getTaskById(taskId);

  if (!task) {
    auditVeraImplementationRunPrepareRejected(taskId, {
      preparedBy,
      reasonCode: "NOT_FOUND",
      message: "Task not found.",
    });
    throw new VeraImplementationRunPrepareError("NOT_FOUND", "Task not found.", 404);
  }

  const analysis = analyzeVeraHandoffTask(task);

  auditVeraImplementationRunPrepareRequested(taskId, {
    preparedBy,
    veraWorkOrderId: analysis.veraWorkOrderId,
  });

  if (!analysis.isVeraLuxOsHandoffTask) {
    auditVeraImplementationRunPrepareRejected(taskId, {
      preparedBy,
      reasonCode: "NOT_VERA_HANDOFF",
      message: "Task is not a VeraLux OS handoff.",
    });
    throw new VeraImplementationRunPrepareError(
      "NOT_VERA_HANDOFF",
      "Task is not a VeraLux OS handoff.",
    );
  }

  const confirmation = input.confirmationText.trim();
  if (confirmation !== VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE) {
    auditVeraImplementationRunPrepareRejected(taskId, {
      preparedBy,
      veraWorkOrderId: analysis.veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE}`,
    });
    throw new VeraImplementationRunPrepareError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE}`,
    );
  }

  const existing = findVeraPreparedRunForTask(taskId);
  if (existing) {
    auditVeraImplementationRunPrepared(taskId, existing.id, {
      preparedBy,
      veraWorkOrderId: analysis.veraWorkOrderId,
      alreadyExisted: true,
    });
    return {
      run: existing,
      taskId,
      veraWorkOrderId: analysis.veraWorkOrderId,
      alreadyExisted: true,
      nonExecutionNote: VERA_PREPARED_RUN_NON_EXECUTION_NOTE,
    };
  }

  if (!analysis.safeToPrepareRun) {
    const message = analysis.blockers.join(" ");
    auditVeraImplementationRunPrepareRejected(taskId, {
      preparedBy,
      veraWorkOrderId: analysis.veraWorkOrderId,
      reasonCode: "VALIDATION_FAILED",
      message,
    });
    throw new VeraImplementationRunPrepareError("VALIDATION_FAILED", message);
  }

  const run = createVeraPreparedRunRecord(taskId, {
    veraWorkOrderId: analysis.veraWorkOrderId,
    preparedBy,
  });

  auditVeraImplementationRunPrepared(taskId, run.id, {
    preparedBy,
    veraWorkOrderId: analysis.veraWorkOrderId,
  });

  return {
    run,
    taskId,
    veraWorkOrderId: analysis.veraWorkOrderId,
    alreadyExisted: false,
    nonExecutionNote: VERA_PREPARED_RUN_NON_EXECUTION_NOTE,
  };
}
