import {
  auditVeraImplementationPatchApplicationApplied,
  auditVeraImplementationPatchApplicationBlocked,
  auditVeraImplementationPatchApplicationFailed,
  auditVeraImplementationPatchApplicationRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPatchApplicationReadiness } from "./vera-patch-application-readiness";
import {
  hasVeraImplementationPatchApplication,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import {
  writeVeraImplementationPatchApplicationReport,
} from "../worker/vera-implementation-artifact-storage";
import {
  VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
  VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_APPLICATION_SCHEMA_VERSION,
  VERA_POST_PATCH_GATE_CONFIRMATION,
  type VeraImplementationPatchApplicationReport,
} from "../worker/vera-implementation-patch-application-types";
import { applyVeraPatchEntriesToWorktree } from "../worker/vera-worktree-patch-applier";

export class VeraImplementationPatchApplicationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly safeToApplyPatch: boolean;
  readonly reasonCodes: string[];

  constructor(
    code: string,
    message: string,
    options: {
      status?: number;
      safeToApplyPatch?: boolean;
      reasonCodes?: string[];
    } = {},
  ) {
    super(message);
    this.name = "VeraImplementationPatchApplicationError";
    this.code = code;
    this.status = options.status ?? 409;
    this.safeToApplyPatch = options.safeToApplyPatch ?? false;
    this.reasonCodes = options.reasonCodes ?? [];
  }
}

export type ApplyVeraImplementationPatchProposalInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type ApplyVeraImplementationPatchProposalResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  proposalPath: string | null;
  proposalHash: string | null;
  applicationReportPath: string;
  applicationReportHash: string;
  appliedFiles: string[];
  nextStep: string;
  warning: string;
};

export function applyVeraImplementationPatchProposal(
  input: ApplyVeraImplementationPatchProposalInput,
): ApplyVeraImplementationPatchProposalResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationPatchApplicationBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraImplementationPatchApplicationError("NOT_FOUND", "Run not found.", {
      status: 404,
    });
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraImplementationPatchApplication(run.governanceNotes)) {
    auditVeraImplementationPatchApplicationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "PATCH_ALREADY_APPLIED",
      message: "Vera patch application already exists for this run.",
      proposalPath: governanceNotes.veraImplementationPatchProposalPath ?? null,
      proposalHash: governanceNotes.veraImplementationPatchProposalHash ?? null,
    });
    throw new VeraImplementationPatchApplicationError(
      "PATCH_ALREADY_APPLIED",
      "Vera patch application already exists for this run.",
      { status: 409 },
    );
  }

  const readiness = assessVeraPatchApplicationReadiness(run.id);

  auditVeraImplementationPatchApplicationRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    proposalPath: readiness.proposalPath,
    proposalHash: readiness.proposalHash,
    note,
  });

  const confirmation = input.confirmationText.trim();
  if (confirmation !== VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE) {
    auditVeraImplementationPatchApplicationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE}`,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
    });
    throw new VeraImplementationPatchApplicationError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE}`,
      { status: 400, reasonCodes: ["CONFIRMATION_INVALID"] },
    );
  }

  if (!readiness.safeToApplyPatch) {
    const primaryCode = readiness.reasonCodes.includes("NO_APPLICABLE_PATCH_CONTENT")
      ? "NO_APPLICABLE_PATCH_CONTENT"
      : "READINESS_FAILED";
    const message = readiness.reasons.join(" ");
    auditVeraImplementationPatchApplicationBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: primaryCode,
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
    });
    throw new VeraImplementationPatchApplicationError(primaryCode, message, {
      status: 409,
      safeToApplyPatch: false,
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

    const report: VeraImplementationPatchApplicationReport = {
      schemaVersion: VERA_PATCH_APPLICATION_SCHEMA_VERSION,
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
      createdAt: appliedAt,
      sourceProposalPath: readiness.proposalPath!,
      sourceProposalHash: readiness.proposalHash!,
      worktreePath,
      status: "patch_applied" as const,
      appliedFiles: applyResult.appliedFiles,
      nextGate: {
        required: true as const,
        phase: "2Q" as const,
        confirmationRequired: VERA_POST_PATCH_GATE_CONFIRMATION,
        note: "Post-patch quality gates require explicit Phase 2Q approval.",
      },
      safety: {
        noCommitCreated: true as const,
        noPullRequestCreated: true as const,
        noMergePerformed: true as const,
        noDeploymentPerformed: true as const,
        noReleasePerformed: true as const,
      },
      provenance: {
        proposalHash: readiness.proposalHash!,
        appliedBy: requestedBy,
        tool: "vera-implementation-patch-application" as const,
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
        "Vera patch applied to governed worktree. Commit, PR, merge, deploy, and release remain gated.",
      governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
        veraImplementationPatchApplicationStatus: "patch_applied",
        veraImplementationPatchApplicationPath: applicationReportPath,
        veraImplementationPatchApplicationHash: applicationReportHash,
        veraImplementationPatchAppliedBy: requestedBy,
        veraImplementationPatchAppliedAt: appliedAt,
        veraImplementationPatchAppliedFiles: appliedFiles,
      }),
    });

    if (!updated) {
      auditVeraImplementationPatchApplicationFailed(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: "RUN_UPDATE_FAILED",
        message: "Failed to persist Vera patch application metadata.",
        proposalPath: readiness.proposalPath,
        proposalHash: readiness.proposalHash,
      });
      throw new VeraImplementationPatchApplicationError(
        "RUN_UPDATE_FAILED",
        "Failed to persist Vera patch application metadata.",
        { status: 500 },
      );
    }

    auditVeraImplementationPatchApplicationApplied(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
      applicationReportPath,
      applicationReportHash,
      appliedFiles,
      note,
    });

    return {
      run: updated,
      taskId: run.taskId,
      veraWorkOrderId,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
      applicationReportPath,
      applicationReportHash,
      appliedFiles,
      nextStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
      warning: "Commit, PR, merge, deploy, and release remain separately gated.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Vera patch application failed unexpectedly.";
    auditVeraImplementationPatchApplicationFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "PATCH_APPLICATION_FAILED",
      message,
      proposalPath: readiness.proposalPath,
      proposalHash: readiness.proposalHash,
    });
    throw new VeraImplementationPatchApplicationError("PATCH_APPLICATION_FAILED", message, {
      status: 500,
    });
  }
}
