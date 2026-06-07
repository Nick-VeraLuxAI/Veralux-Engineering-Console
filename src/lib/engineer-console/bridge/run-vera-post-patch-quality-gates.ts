import {
  auditVeraPostPatchQualityGatesBlocked,
  auditVeraPostPatchQualityGatesCompleted,
  auditVeraPostPatchQualityGatesFailed,
  auditVeraPostPatchQualityGatesRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPostPatchQualityGatesReadiness } from "./vera-post-patch-quality-gates-readiness";
import { runVeraPostPatchDeterministicValidation } from "./run-vera-post-patch-deterministic-validation";
import {
  hasVeraPostPatchQualityReport,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import { writeVeraPostPatchQualityReport } from "../worker/vera-implementation-artifact-storage";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import type { VeraPostPatchQualityReport } from "../worker/vera-post-patch-quality-report-types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
  VERA_POST_PATCH_QUALITY_GATE_PHASE_2U,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
} from "../worker/vera-post-patch-quality-report-types";

export class VeraPostPatchQualityGatesError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reasonCodes: string[];

  constructor(
    code: string,
    message: string,
    options: { status?: number; reasonCodes?: string[] } = {},
  ) {
    super(message);
    this.name = "VeraPostPatchQualityGatesError";
    this.code = code;
    this.status = options.status ?? 400;
    this.reasonCodes = options.reasonCodes ?? [];
  }
}

export type RunVeraPostPatchQualityGatesInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type RunVeraPostPatchQualityGatesResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  qualityReportPath: string;
  qualityReportHash: string;
  gateSummary: string;
  nextStep: string;
  warning: string;
};

export function runVeraPostPatchQualityGates(
  input: RunVeraPostPatchQualityGatesInput,
): RunVeraPostPatchQualityGatesResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraPostPatchQualityGatesBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraPostPatchQualityGatesError("NOT_FOUND", "Run not found.", { status: 404 });
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraPostPatchQualityReport(run.governanceNotes)) {
    auditVeraPostPatchQualityGatesBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "POST_PATCH_QUALITY_REPORT_ALREADY_EXISTS",
      message: "Vera post-patch quality report already exists for this run.",
      applicationReportPath: governanceNotes.veraImplementationPatchApplicationPath ?? null,
      applicationReportHash: governanceNotes.veraImplementationPatchApplicationHash ?? null,
      qualityReportPath: governanceNotes.veraPostPatchQualityReportPath ?? null,
      qualityReportHash: governanceNotes.veraPostPatchQualityReportHash ?? null,
    });
    throw new VeraPostPatchQualityGatesError(
      "POST_PATCH_QUALITY_REPORT_ALREADY_EXISTS",
      "Vera post-patch quality report already exists for this run.",
      { status: 409 },
    );
  }

  const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);

  auditVeraPostPatchQualityGatesRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    applicationReportPath: readiness.applicationReportPath,
    applicationReportHash: readiness.applicationReportHash,
    note,
  });

  if (input.confirmationText !== VERA_POST_PATCH_GATE_CONFIRMATION) {
    auditVeraPostPatchQualityGatesBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_POST_PATCH_GATE_CONFIRMATION}`,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
      reasonCodes: ["CONFIRMATION_INVALID"],
    });
    throw new VeraPostPatchQualityGatesError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_POST_PATCH_GATE_CONFIRMATION}`,
      { status: 400, reasonCodes: ["CONFIRMATION_INVALID"] },
    );
  }

  if (!readiness.safeToRunPostPatchQualityGates || !readiness.applicationReport || !readiness.targetRepoPath) {
    const message = readiness.reasons.join(" ");
    auditVeraPostPatchQualityGatesBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
    });
    throw new VeraPostPatchQualityGatesError("READINESS_FAILED", message, {
      status: 409,
      reasonCodes: readiness.reasonCodes,
    });
  }

  const ranAt = new Date().toISOString();

  try {
    const validation = runVeraPostPatchDeterministicValidation({
      applicationReport: readiness.applicationReport,
      applicationReportHash: readiness.applicationReportHash!,
      targetRepoPath: readiness.targetRepoPath,
      branchName: readiness.branchName,
    });

    const report: VeraPostPatchQualityReport = {
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
      createdAt: ranAt,
      sourceApplicationReportPath: readiness.applicationReportPath!,
      sourceApplicationReportHash: readiness.applicationReportHash!,
      targetRepoPath: readiness.targetRepoPath,
      branchName: readiness.branchName,
      changedFiles: validation.changedFiles,
      appliedFiles: validation.appliedFiles,
      gateResults: validation.gateResults,
      overallStatus: validation.overallStatus,
      validationMode: "deterministic_post_patch_validation",
      worktreeGitStatusSummary: validation.worktreeGitStatusSummary,
      nextGate: {
        required: true,
        phase: VERA_POST_PATCH_QUALITY_GATE_PHASE_2U,
        confirmationRequired: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        note: "Quality gates completed. Human review is required before commit creation.",
      },
      safety: {
        noPatchAppliedBeyondApprovedDraft: true,
        noCommitCreated: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        sourceApplicationReportHash: readiness.applicationReportHash!,
        ranBy: requestedBy,
        tool: "vera-post-patch-quality-gates",
      },
    };

    const { qualityReportPath, qualityReportHash } = writeVeraPostPatchQualityReport(report);

    const updated = updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
      completedAt: null,
      agentMessage:
        "Vera post-patch quality gates completed. Review remains separately gated.",
      governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
        veraPostPatchQualityStatus: "completed",
        veraPostPatchQualityReportPath: qualityReportPath,
        veraPostPatchQualityReportHash: qualityReportHash,
        veraPostPatchQualityRanBy: requestedBy,
        veraPostPatchQualityRanAt: ranAt,
        veraPostPatchQualityGateSummary: validation.gateSummary,
      }),
    });

    if (!updated) {
      auditVeraPostPatchQualityGatesFailed(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: "RUN_UPDATE_FAILED",
        message: "Failed to persist Vera post-patch quality gate metadata.",
        applicationReportPath: readiness.applicationReportPath,
        applicationReportHash: readiness.applicationReportHash,
      });
      throw new VeraPostPatchQualityGatesError(
        "RUN_UPDATE_FAILED",
        "Failed to persist Vera post-patch quality gate metadata.",
        { status: 500 },
      );
    }

    auditVeraPostPatchQualityGatesCompleted(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
      qualityReportPath,
      qualityReportHash,
      gateSummary: validation.gateSummary,
      note,
    });

    return {
      run: updated,
      taskId: run.taskId,
      veraWorkOrderId,
      qualityReportPath,
      qualityReportHash,
      gateSummary: validation.gateSummary,
      nextStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
      warning:
        "Review, commit, PR, merge, deploy, and release remain separately gated.",
    };
  } catch (error) {
    if (error instanceof VeraPostPatchQualityGatesError) {
      throw error;
    }
    const message =
      error instanceof Error
        ? error.message
        : "Vera post-patch quality gates failed unexpectedly.";
    auditVeraPostPatchQualityGatesFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "QUALITY_GATES_FAILED",
      message,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
    });
    throw new VeraPostPatchQualityGatesError("QUALITY_GATES_FAILED", message, { status: 500 });
  }
}
