import {
  auditVeraCommitProposalBlocked,
  auditVeraCommitProposalCreated,
  auditVeraCommitProposalFailed,
  auditVeraCommitProposalRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraCommitProposalReadiness } from "./vera-commit-proposal-readiness";
import {
  hasVeraCommitProposal,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import { writeVeraCommitProposal } from "../worker/vera-implementation-artifact-storage";
import type { VeraCommitProposal } from "../worker/vera-commit-proposal-types";
import {
  VERA_COMMIT_CREATE_CONFIRMATION,
  VERA_COMMIT_CREATE_PHASE_2W,
  VERA_COMMIT_PROPOSAL_CONFIRMATION,
  VERA_COMMIT_PROPOSAL_PHASE_2V,
  VERA_COMMIT_PROPOSAL_SCHEMA_VERSION,
  VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
} from "../worker/vera-commit-proposal-types";

export class VeraCommitProposalError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reasonCodes: string[];

  constructor(
    code: string,
    message: string,
    options: { status?: number; reasonCodes?: string[] } = {},
  ) {
    super(message);
    this.name = "VeraCommitProposalError";
    this.code = code;
    this.status = options.status ?? 400;
    this.reasonCodes = options.reasonCodes ?? [];
  }
}

export type PrepareVeraCommitProposalInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type PrepareVeraCommitProposalResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  commitProposalPath: string;
  commitProposalHash: string;
  proposedFileCount: number;
  nextStep: string;
  warning: string;
};

function buildProposedCommitMessage(input: {
  veraWorkOrderId: string | null;
  proposedFiles: Array<{ path: string }>;
}): string {
  const files = input.proposedFiles.map((file) => file.path);
  if (files.length === 1) {
    return `Add ${files[0]} from Vera gated lifecycle${
      input.veraWorkOrderId ? ` (work order ${input.veraWorkOrderId})` : ""
    }.`;
  }
  return `Add ${files.length} approved files from Vera gated lifecycle${
    input.veraWorkOrderId ? ` (work order ${input.veraWorkOrderId})` : ""
  }.`;
}

export function prepareVeraCommitProposal(
  input: PrepareVeraCommitProposalInput,
): PrepareVeraCommitProposalResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraCommitProposalBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraCommitProposalError("NOT_FOUND", "Run not found.", { status: 404 });
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraCommitProposal(run.governanceNotes)) {
    auditVeraCommitProposalBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "VERA_COMMIT_PROPOSAL_ALREADY_EXISTS",
      message: "Vera commit proposal already exists for this run.",
      applicationReportPath: governanceNotes.veraImplementationPatchApplicationPath ?? null,
      applicationReportHash: governanceNotes.veraImplementationPatchApplicationHash ?? null,
      qualityReportPath: governanceNotes.veraPostPatchQualityReportPath ?? null,
      qualityReportHash: governanceNotes.veraPostPatchQualityReportHash ?? null,
      commitProposalPath: governanceNotes.veraCommitProposalPath ?? null,
      commitProposalHash: governanceNotes.veraCommitProposalHash ?? null,
    });
    throw new VeraCommitProposalError(
      "VERA_COMMIT_PROPOSAL_ALREADY_EXISTS",
      "Vera commit proposal already exists for this run.",
      { status: 409 },
    );
  }

  const readiness = assessVeraCommitProposalReadiness(run.id);

  auditVeraCommitProposalRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    applicationReportPath: readiness.applicationReportPath,
    applicationReportHash: readiness.applicationReportHash,
    qualityReportPath: readiness.qualityReportPath,
    qualityReportHash: readiness.qualityReportHash,
    note,
  });

  // Exact match only — no trim, no normalization, no case folding.
  if (input.confirmationText !== VERA_COMMIT_PROPOSAL_CONFIRMATION) {
    auditVeraCommitProposalBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_COMMIT_PROPOSAL_CONFIRMATION}`,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      reasonCodes: ["CONFIRMATION_INVALID"],
    });
    throw new VeraCommitProposalError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_COMMIT_PROPOSAL_CONFIRMATION}`,
      { status: 400, reasonCodes: ["CONFIRMATION_INVALID"] },
    );
  }

  if (
    !readiness.safeToPrepareCommitProposal ||
    !readiness.applicationReport ||
    !readiness.qualityReport ||
    !readiness.targetRepoPath ||
    !readiness.targetHeadSha ||
    !readiness.applicationReportPath ||
    !readiness.applicationReportHash ||
    !readiness.qualityReportPath ||
    !readiness.qualityReportHash ||
    !run.branchName
  ) {
    const message = readiness.reasons.join(" ");
    auditVeraCommitProposalBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
    });
    throw new VeraCommitProposalError("READINESS_FAILED", message, {
      status: 409,
      reasonCodes: readiness.reasonCodes,
    });
  }

  const createdAt = new Date().toISOString();
  const proposedCommitMessage = buildProposedCommitMessage({
    veraWorkOrderId,
    proposedFiles: readiness.proposedFiles,
  });

  const proposal: VeraCommitProposal = {
    schemaVersion: VERA_COMMIT_PROPOSAL_SCHEMA_VERSION,
    phase: VERA_COMMIT_PROPOSAL_PHASE_2V,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
    createdAt,
    targetRepoPath: readiness.targetRepoPath,
    branchName: run.branchName,
    targetHeadSha: readiness.targetHeadSha,
    sourceApplicationReportPath: readiness.applicationReportPath,
    sourceApplicationReportHash: readiness.applicationReportHash,
    sourceQualityReportPath: readiness.qualityReportPath,
    sourceQualityReportHash: readiness.qualityReportHash,
    qualityReportReviewDecision: "approved",
    proposedCommitMessage,
    proposedFiles: readiness.proposedFiles,
    excludedDirtyFiles: readiness.excludedDirtyFiles,
    dirtyWorkingTreeSummary: readiness.dirtyWorkingTreeSummary,
    validationResults: readiness.validationResults,
    nextGate: {
      required: true,
      phase: VERA_COMMIT_CREATE_PHASE_2W,
      confirmationRequired: VERA_COMMIT_CREATE_CONFIRMATION,
      note: "Human approval is required before creating a commit.",
    },
    safety: {
      noStagingPerformed: true,
      noCommitCreated: true,
      noPushPerformed: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
    },
    provenance: {
      sourceApplicationReportHash: readiness.applicationReportHash,
      sourceQualityReportHash: readiness.qualityReportHash,
      preparedBy: requestedBy,
      tool: "vera-commit-proposal-prepare",
    },
  };

  try {
    const { commitProposalPath, commitProposalHash } = writeVeraCommitProposal(proposal);

    const updated = updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
      completedAt: null,
      agentMessage:
        "Vera commit proposal is ready. Commit creation remains separately gated.",
      governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
        veraCommitProposalStatus: "proposal_created",
        veraCommitProposalPath: commitProposalPath,
        veraCommitProposalHash: commitProposalHash,
        veraCommitProposalCreatedBy: requestedBy,
        veraCommitProposalCreatedAt: createdAt,
        veraCommitProposalFileCount: proposal.proposedFiles.length,
        veraCommitProposalSource: "post_patch_quality_report_review",
      }),
    });

    if (!updated) {
      auditVeraCommitProposalFailed(run.taskId, run.id, {
        requestedBy,
        veraWorkOrderId,
        reasonCode: "RUN_UPDATE_FAILED",
        message: "Failed to persist Vera commit proposal governance.",
        applicationReportPath: readiness.applicationReportPath,
        applicationReportHash: readiness.applicationReportHash,
        qualityReportPath: readiness.qualityReportPath,
        qualityReportHash: readiness.qualityReportHash,
      });
      throw new VeraCommitProposalError(
        "RUN_UPDATE_FAILED",
        "Failed to persist Vera commit proposal governance.",
        { status: 500 },
      );
    }

    auditVeraCommitProposalCreated(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      commitProposalPath,
      commitProposalHash,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
      proposedFileCount: proposal.proposedFiles.length,
      note,
    });

    return {
      run: updated,
      taskId: run.taskId,
      veraWorkOrderId,
      commitProposalPath,
      commitProposalHash,
      proposedFileCount: proposal.proposedFiles.length,
      nextStep: VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
      warning:
        "This prepares a commit proposal only. It does not stage, commit, push, create PRs, merge, deploy, or release.",
    };
  } catch (error) {
    if (error instanceof VeraCommitProposalError) throw error;
    const message =
      error instanceof Error ? error.message : "Failed to prepare Vera commit proposal.";
    auditVeraCommitProposalFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "COMMIT_PROPOSAL_WRITE_FAILED",
      message,
      applicationReportPath: readiness.applicationReportPath,
      applicationReportHash: readiness.applicationReportHash,
      qualityReportPath: readiness.qualityReportPath,
      qualityReportHash: readiness.qualityReportHash,
    });
    throw new VeraCommitProposalError("COMMIT_PROPOSAL_WRITE_FAILED", message, {
      status: 500,
    });
  }
}
