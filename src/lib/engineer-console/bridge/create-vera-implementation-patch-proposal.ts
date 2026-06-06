import {
  auditVeraImplementationPatchProposalBlocked,
  auditVeraImplementationPatchProposalCreated,
  auditVeraImplementationPatchProposalFailed,
  auditVeraImplementationPatchProposalRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPatchProposalReadiness } from "./vera-patch-proposal-readiness";
import {
  hasVeraImplementationPatchProposal,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import type { VeraImplementationWorkerArtifact } from "../worker/vera-implementation-artifact-types";
import {
  readVeraImplementationArtifactAtPath,
  writeVeraImplementationPatchProposal,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraImplementationPatchProposal } from "../worker/vera-implementation-patch-proposal-types";
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
  VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION,
} from "../worker/vera-implementation-patch-proposal-types";

export class VeraImplementationPatchProposalError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraImplementationPatchProposalError";
    this.code = code;
    this.status = status;
  }
}

export type CreateVeraImplementationPatchProposalInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
};

export type CreateVeraImplementationPatchProposalResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  sourceArtifactPath: string | null;
  sourceArtifactHash: string | null;
  proposalPath: string | null;
  proposalHash: string | null;
  nextStep: string;
  alreadyExisted: boolean;
  warning: string;
};

function buildProposedChangeSet(source: VeraImplementationWorkerArtifact) {
  const entries: VeraImplementationPatchProposal["proposedChangeSet"] = [];

  for (const filePath of source.filesProposed) {
    entries.push({
      filePath,
      action: "propose_change",
      rationale: "Listed in Vera implementation artifact filesProposed metadata.",
      riskLevel: "medium",
      patchIncluded: false,
    });
  }

  for (const filePath of source.filesChanged) {
    entries.push({
      filePath,
      action: "propose_change",
      rationale: "Listed in Vera implementation artifact filesChanged metadata.",
      riskLevel: "medium",
      patchIncluded: false,
    });
  }

  if (entries.length === 0) {
    entries.push({
      filePath: "(undetermined)",
      action: "needs_human_design",
      rationale:
        "Approved implementation artifact did not enumerate concrete file paths. Human design is required before patch application.",
      riskLevel: "high",
      patchIncluded: false,
    });
  }

  return entries;
}

function buildPatchProposal(input: {
  source: VeraImplementationWorkerArtifact;
  sourceArtifactPath: string;
  sourceArtifactHash: string;
  requestedBy: string;
  veraWorkOrderId: string;
}): VeraImplementationPatchProposal {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: "veralux.vera.implementation-patch-proposal.v1",
    runId: input.source.runId,
    taskId: input.source.taskId,
    veraWorkOrderId: input.veraWorkOrderId,
    createdAt,
    sourceArtifactPath: input.sourceArtifactPath,
    sourceArtifactHash: input.sourceArtifactHash,
    mode: "deterministic_metadata",
    status: "proposal_created",
    summary:
      "Deterministic Vera patch proposal generated from approved implementation artifact metadata. No repository patch was applied.",
    proposedChangeSet: buildProposedChangeSet(input.source),
    nextGate: {
      required: true,
      phase: "2O",
      confirmationRequired: VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION,
      note: "Patch application requires explicit Phase 2O approval. This proposal does not modify source files.",
    },
    safety: {
      noPatchApplied: true,
      noCommitCreated: true,
      noPullRequestCreated: true,
      noMergePerformed: true,
      noDeploymentPerformed: true,
      noReleasePerformed: true,
    },
    provenance: {
      implementationArtifactHash: input.sourceArtifactHash,
      createdBy: input.requestedBy,
      tool: "vera-implementation-patch-proposal",
    },
  };
}

export function createVeraImplementationPatchProposal(
  input: CreateVeraImplementationPatchProposalInput,
): CreateVeraImplementationPatchProposalResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationPatchProposalBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraImplementationPatchProposalError("NOT_FOUND", "Run not found.", 404);
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraImplementationPatchProposal(run.governanceNotes)) {
    return {
      run,
      taskId: run.taskId,
      veraWorkOrderId,
      sourceArtifactPath: governanceNotes.veraImplementationArtifactPath ?? null,
      sourceArtifactHash: governanceNotes.veraImplementationArtifactHash ?? null,
      proposalPath: governanceNotes.veraImplementationPatchProposalPath ?? null,
      proposalHash: governanceNotes.veraImplementationPatchProposalHash ?? null,
      nextStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
      alreadyExisted: true,
      warning:
        "Vera patch proposal already exists. Patch application, commit, PR, merge, deploy, and release remain gated.",
    };
  }

  const readiness = assessVeraPatchProposalReadiness(run.id);

  auditVeraImplementationPatchProposalRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    sourceArtifactPath: readiness.sourceArtifactPath,
    sourceArtifactHash: readiness.sourceArtifactHash,
    note,
  });

  const confirmation = input.confirmationText.trim();
  if (confirmation !== VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE) {
    auditVeraImplementationPatchProposalBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE}`,
      sourceArtifactPath: readiness.sourceArtifactPath,
      sourceArtifactHash: readiness.sourceArtifactHash,
    });
    throw new VeraImplementationPatchProposalError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE}`,
    );
  }

  if (!readiness.safeToCreateProposal) {
    const message = readiness.reasons.join(" ");
    auditVeraImplementationPatchProposalBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      sourceArtifactPath: readiness.sourceArtifactPath,
      sourceArtifactHash: readiness.sourceArtifactHash,
    });
    throw new VeraImplementationPatchProposalError("READINESS_FAILED", message);
  }

  const sourceArtifactPath = readiness.sourceArtifactPath!;
  const sourceArtifactHash = readiness.sourceArtifactHash!;
  const sourceArtifact = readVeraImplementationArtifactAtPath(sourceArtifactPath);
  if (!sourceArtifact) {
    auditVeraImplementationPatchProposalFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "SOURCE_ARTIFACT_UNREADABLE",
      message: "Approved implementation artifact could not be read.",
    });
    throw new VeraImplementationPatchProposalError(
      "SOURCE_ARTIFACT_UNREADABLE",
      "Approved implementation artifact could not be read.",
      500,
    );
  }

  const proposal = buildPatchProposal({
    source: sourceArtifact,
    sourceArtifactPath,
    sourceArtifactHash,
    requestedBy,
    veraWorkOrderId: veraWorkOrderId ?? sourceArtifact.veraWorkOrderId ?? run.taskId,
  });

  const { proposalPath, proposalHash } = writeVeraImplementationPatchProposal(proposal);
  const createdAt = new Date().toISOString();

  const updated = updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
    completedAt: null,
    agentMessage:
      "Vera patch proposal created. Patch application remains separately gated.",
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationPatchProposalPath: proposalPath,
      veraImplementationPatchProposalHash: proposalHash,
      veraImplementationPatchProposalStatus: "proposal_created",
      veraImplementationPatchProposalCreatedBy: requestedBy,
      veraImplementationPatchProposalCreatedAt: createdAt,
    }),
  });

  if (!updated) {
    auditVeraImplementationPatchProposalFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "RUN_UPDATE_FAILED",
      message: "Failed to persist Vera patch proposal metadata.",
    });
    throw new VeraImplementationPatchProposalError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera patch proposal metadata.",
      500,
    );
  }

  auditVeraImplementationPatchProposalCreated(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    sourceArtifactPath,
    sourceArtifactHash,
    proposalPath,
    proposalHash,
    note,
  });

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    sourceArtifactPath,
    sourceArtifactHash,
    proposalPath,
    proposalHash,
    nextStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
    alreadyExisted: false,
    warning:
      "Patch application, commit, PR, merge, deploy, and release remain separately gated.",
  };
}
