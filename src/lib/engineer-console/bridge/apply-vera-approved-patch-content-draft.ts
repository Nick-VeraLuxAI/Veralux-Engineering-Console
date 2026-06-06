import {
  auditVeraImplementationApprovedPatchContentApplied,
  auditVeraImplementationApprovedPatchContentApplicationBlocked,
  auditVeraImplementationApprovedPatchContentApplicationFailed,
  auditVeraImplementationApprovedPatchContentApplicationRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraApprovedPatchContentApplicationReadiness } from "./vera-approved-patch-content-application-readiness";
import {
  hasVeraImplementationPatchApplication,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import { writeVeraImplementationPatchApplicationReport } from "../worker/vera-implementation-artifact-storage";
import {
  VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
  VERA_PATCH_APPLICATION_SCHEMA_VERSION,
  VERA_POST_PATCH_GATE_CONFIRMATION,
  VERA_POST_PATCH_GATE_PHASE_2T,
  type VeraDraftSourcedPatchApplicationReport,
} from "../worker/vera-implementation-patch-application-types";
import { VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE } from "../worker/vera-implementation-patch-content-draft-types";
import { applyVeraPatchEntriesToWorktree } from "../worker/vera-worktree-patch-applier";

export class VeraApprovedPatchContentApplicationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reasonCodes: string[];

  constructor(
    code: string,
    message: string,
    options: { status?: number; reasonCodes?: string[] } = {},
  ) {
    super(message);
    this.name = "VeraApprovedPatchContentApplicationError";
    this.code = code;
    this.status = options.status ?? 400;
    this.reasonCodes = options.reasonCodes ?? [];
  }
}

export type ApplyVeraApprovedPatchContentDraftInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type ApplyVeraApprovedPatchContentDraftResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  draftPath: string | null;
  draftHash: string | null;
  applicationReportPath: string;
  applicationReportHash: string;
  appliedFiles: string[];
  nextStep: string;
  warning: string;
};

export function applyVeraApprovedPatchContentDraft(
  input: ApplyVeraApprovedPatchContentDraftInput,
): ApplyVeraApprovedPatchContentDraftResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationApprovedPatchContentApplicationBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraApprovedPatchContentApplicationError("NOT_FOUND", "Run not found.", {
      status: 404,
    });
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraImplementationPatchApplication(run.governanceNotes)) {
    auditVeraImplementationApprovedPatchContentApplicationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "PATCH_ALREADY_APPLIED",
      message: "Vera patch application already exists for this run.",
      draftPath: governanceNotes.veraImplementationPatchContentDraftPath ?? null,
      draftHash: governanceNotes.veraImplementationPatchContentDraftHash ?? null,
    });
    throw new VeraApprovedPatchContentApplicationError(
      "PATCH_ALREADY_APPLIED",
      "Vera patch application already exists for this run.",
      { status: 409 },
    );
  }

  const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);

  auditVeraImplementationApprovedPatchContentApplicationRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    draftPath: readiness.draftPath,
    draftHash: readiness.draftHash,
    entryCount: readiness.entryCount,
    note,
  });

  if (
    input.confirmationText !== VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE
  ) {
    auditVeraImplementationApprovedPatchContentApplicationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE}`,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount: readiness.entryCount,
    });
    throw new VeraApprovedPatchContentApplicationError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE}`,
      { status: 400, reasonCodes: ["CONFIRMATION_INVALID"] },
    );
  }

  if (!readiness.safeToApplyApprovedPatchContent) {
    const message = readiness.reasons.join(" ");
    auditVeraImplementationApprovedPatchContentApplicationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      entryCount: readiness.entryCount,
    });
    throw new VeraApprovedPatchContentApplicationError("READINESS_FAILED", message, {
      status: 409,
      reasonCodes: readiness.reasonCodes,
    });
  }

  const worktreePath = readiness.worktreePath!;
  const appliedAt = new Date().toISOString();

  try {
    const applyResult = applyVeraPatchEntriesToWorktree(
      worktreePath,
      readiness.applicablePatchEntries,
    );

    const report: VeraDraftSourcedPatchApplicationReport = {
      schemaVersion: VERA_PATCH_APPLICATION_SCHEMA_VERSION,
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
      createdAt: appliedAt,
      source: "patch_content_draft",
      sourceDraftPath: readiness.draftPath!,
      sourceDraftHash: readiness.draftHash!,
      worktreePath,
      status: "patch_applied",
      appliedFiles: applyResult.appliedFiles,
      nextGate: {
        required: true,
        phase: VERA_POST_PATCH_GATE_PHASE_2T,
        confirmationRequired: VERA_POST_PATCH_GATE_CONFIRMATION,
        note: "Patch was applied to the governed worktree. Quality gates must run before commit review.",
      },
      safety: {
        noCommitCreated: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        sourceDraftHash: readiness.draftHash!,
        appliedBy: requestedBy,
        tool: "vera-approved-patch-content-application",
      },
    };

    const { applicationReportPath, applicationReportHash } =
      writeVeraImplementationPatchApplicationReport(report);

    const appliedFiles = applyResult.appliedFiles.map((entry) => entry.filePath);

    const updated = updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
      completedAt: null,
      agentMessage:
        "Approved Vera patch content applied to governed worktree. Commit, PR, merge, deploy, and release remain gated.",
      governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
        veraImplementationPatchApplicationStatus: "patch_applied",
        veraImplementationPatchApplicationPath: applicationReportPath,
        veraImplementationPatchApplicationHash: applicationReportHash,
        veraImplementationPatchAppliedBy: requestedBy,
        veraImplementationPatchAppliedAt: appliedAt,
        veraImplementationPatchAppliedFiles: appliedFiles,
        veraImplementationPatchApplicationSource: "patch_content_draft",
      }),
    });

    if (!updated) {
      auditVeraImplementationApprovedPatchContentApplicationFailed(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: "RUN_UPDATE_FAILED",
        message: "Failed to persist Vera patch application metadata.",
        draftPath: readiness.draftPath,
        draftHash: readiness.draftHash,
      });
      throw new VeraApprovedPatchContentApplicationError(
        "RUN_UPDATE_FAILED",
        "Failed to persist Vera patch application metadata.",
        { status: 500 },
      );
    }

    auditVeraImplementationApprovedPatchContentApplied(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      applicationReportPath,
      applicationReportHash,
      appliedFiles,
      note,
    });

    return {
      run: updated,
      taskId: run.taskId,
      veraWorkOrderId,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
      applicationReportPath,
      applicationReportHash,
      appliedFiles,
      nextStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
      warning: "Commit, PR, merge, deploy, and release remain separately gated.",
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Approved Vera patch content application failed unexpectedly.";
    auditVeraImplementationApprovedPatchContentApplicationFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "PATCH_APPLICATION_FAILED",
      message,
      draftPath: readiness.draftPath,
      draftHash: readiness.draftHash,
    });
    throw new VeraApprovedPatchContentApplicationError("PATCH_APPLICATION_FAILED", message, {
      status: 500,
    });
  }
}
