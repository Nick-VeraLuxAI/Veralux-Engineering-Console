import {
  auditVeraExecutionApprovalRequestRejected,
  auditVeraExecutionApprovalRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraExecutionReadiness, isVeraExecutionApprovalRequested } from "./vera-execution-readiness";
import {
  parseVeraRunGovernanceNotes,
  VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE,
  VERA_EXECUTION_APPROVAL_REQUESTED_NOTE,
  VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";

export class VeraExecutionApprovalRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraExecutionApprovalRequestError";
    this.code = code;
    this.status = status;
  }
}

export type RequestVeraExecutionApprovalInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
};

export type RequestVeraExecutionApprovalResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  readinessStatus: "ready" | "already_requested";
  alreadyExisted: boolean;
  nonExecutionNote: typeof VERA_EXECUTION_APPROVAL_REQUESTED_NOTE;
};

function mergeGovernanceNotesForApprovalRequest(
  existingNotes: string | null | undefined,
  detail: {
    requestedBy: string;
    requestedAt: string;
    veraWorkOrderId: string | null;
  },
): string {
  const base = parseVeraRunGovernanceNotes(existingNotes);
  return JSON.stringify({
    ...base,
    veraExecutionApprovalRequested: true,
    requestedBy: detail.requestedBy,
    requestedAt: detail.requestedAt,
    veraWorkOrderId: detail.veraWorkOrderId ?? base.veraWorkOrderId ?? null,
    nonExecutionNote: VERA_EXECUTION_APPROVAL_REQUESTED_NOTE,
  });
}

export function requestVeraExecutionApproval(
  input: RequestVeraExecutionApprovalInput,
): RequestVeraExecutionApprovalResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraExecutionApprovalRequestRejected("", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraExecutionApprovalRequestError("NOT_FOUND", "Run not found.", 404);
  }

  const readiness = assessVeraExecutionReadiness(run.id);
  const veraWorkOrderId = readiness.veraWorkOrderId;

  const confirmation = input.confirmationText.trim();
  if (confirmation !== VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE) {
    auditVeraExecutionApprovalRequestRejected(run.taskId, {
      runId: run.id,
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE}`,
    });
    throw new VeraExecutionApprovalRequestError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE}`,
    );
  }

  if (isVeraExecutionApprovalRequested(run)) {
    return {
      run,
      taskId: run.taskId,
      veraWorkOrderId,
      readinessStatus: "already_requested",
      alreadyExisted: true,
      nonExecutionNote: VERA_EXECUTION_APPROVAL_REQUESTED_NOTE,
    };
  }

  if (!readiness.safeToRequestExecutionApproval) {
    const message = readiness.reasons.join(" ");
    auditVeraExecutionApprovalRequestRejected(run.taskId, {
      runId: run.id,
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
    });
    throw new VeraExecutionApprovalRequestError("READINESS_FAILED", message);
  }

  const requestedAt = new Date().toISOString();
  const updated = updateRun(run.id, {
    currentStep: VERA_EXECUTION_APPROVAL_REQUESTED_STEP,
    governanceNotes: mergeGovernanceNotesForApprovalRequest(run.governanceNotes, {
      requestedBy,
      requestedAt,
      veraWorkOrderId,
    }),
    agentMessage: VERA_EXECUTION_APPROVAL_REQUESTED_NOTE,
  });

  if (!updated) {
    throw new VeraExecutionApprovalRequestError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera execution approval request metadata.",
      500,
    );
  }

  auditVeraExecutionApprovalRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
  });

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    readinessStatus: "ready",
    alreadyExisted: false,
    nonExecutionNote: VERA_EXECUTION_APPROVAL_REQUESTED_NOTE,
  };
}
