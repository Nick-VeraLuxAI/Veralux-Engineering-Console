import {
  auditVeraImplementationPatchContentDraftBlocked,
  auditVeraImplementationPatchContentDraftCreated,
  auditVeraImplementationPatchContentDraftFailed,
  auditVeraImplementationPatchContentDraftRequested,
} from "./vera-handoff-audit-lifecycle";
import { assessVeraPatchContentDraftReadiness } from "./vera-patch-content-draft-readiness";
import {
  hasVeraImplementationPatchContentDraft,
  mergeVeraRunGovernanceNotes,
  parseVeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import { getRunById, updateRun } from "../run-manager/run-manager";
import type { EngineeringRun } from "../types";
import {
  readVeraImplementationArtifactAtPath,
  writeVeraImplementationPatchContentDraft,
} from "../worker/vera-implementation-artifact-storage";
import type {
  VeraImplementationPatchContentDraft,
  VeraPatchContentDraftInputEntry,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-content-draft-types";
import { validateVeraPatchContentDraftEntries } from "../worker/validate-vera-patch-content-draft-entries";

export class VeraImplementationPatchContentDraftError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VeraImplementationPatchContentDraftError";
    this.code = code;
    this.status = status;
  }
}

export type CreateVeraImplementationPatchContentDraftInput = {
  runId: string;
  confirmationText: string;
  requestedBy: string;
  note?: string | null;
  patchEntries: VeraPatchContentDraftInputEntry[];
};

export type CreateVeraImplementationPatchContentDraftResult = {
  run: EngineeringRun;
  taskId: string;
  veraWorkOrderId: string | null;
  draftPath: string;
  draftHash: string;
  entryCount: number;
  nextStep: string;
  warning: string;
};

function resolveWorktreePath(implementationArtifactPath: string | null): string | null {
  if (!implementationArtifactPath) return null;
  const artifact = readVeraImplementationArtifactAtPath(implementationArtifactPath);
  return artifact?.worktreePath?.trim() || artifact?.repoPath?.trim() || null;
}

export function createVeraImplementationPatchContentDraft(
  input: CreateVeraImplementationPatchContentDraftInput,
): CreateVeraImplementationPatchContentDraftResult {
  const runId = input.runId.trim();
  const requestedBy = input.requestedBy.trim() || "operator";
  const note = input.note?.trim() || null;
  const run = runId ? getRunById(runId) : null;

  if (!run) {
    auditVeraImplementationPatchContentDraftBlocked("", "", {
      requestedBy,
      reasonCode: "NOT_FOUND",
      message: "Run not found.",
    });
    throw new VeraImplementationPatchContentDraftError("NOT_FOUND", "Run not found.", 404);
  }

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  const veraWorkOrderId = governanceNotes.veraWorkOrderId ?? null;

  if (hasVeraImplementationPatchContentDraft(run.governanceNotes)) {
    auditVeraImplementationPatchContentDraftBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "PATCH_CONTENT_DRAFT_ALREADY_EXISTS",
      message: "Vera patch content draft already exists for this run.",
      sourceProposalPath: governanceNotes.veraImplementationPatchProposalPath ?? null,
      sourceProposalHash: governanceNotes.veraImplementationPatchProposalHash ?? null,
    });
    throw new VeraImplementationPatchContentDraftError(
      "PATCH_CONTENT_DRAFT_ALREADY_EXISTS",
      "Vera patch content draft already exists for this run.",
      409,
    );
  }

  const readiness = assessVeraPatchContentDraftReadiness(run.id);

  auditVeraImplementationPatchContentDraftRequested(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    sourceProposalPath: readiness.sourceProposalPath,
    sourceProposalHash: readiness.sourceProposalHash,
    note,
    entryCount: input.patchEntries.length,
  });

  const confirmation = input.confirmationText.trim();
  if (confirmation !== VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE) {
    auditVeraImplementationPatchContentDraftBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "CONFIRMATION_INVALID",
      message: `Type exactly: ${VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE}`,
      sourceProposalPath: readiness.sourceProposalPath,
      sourceProposalHash: readiness.sourceProposalHash,
    });
    throw new VeraImplementationPatchContentDraftError(
      "CONFIRMATION_INVALID",
      `Type exactly: ${VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE}`,
    );
  }

  if (!readiness.safeToCreatePatchContentDraft) {
    const message = readiness.reasons.join(" ");
    auditVeraImplementationPatchContentDraftBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "READINESS_FAILED",
      message,
      readinessReasons: readiness.reasons,
      reasonCodes: readiness.reasonCodes,
      sourceProposalPath: readiness.sourceProposalPath,
      sourceProposalHash: readiness.sourceProposalHash,
    });
    throw new VeraImplementationPatchContentDraftError("READINESS_FAILED", message);
  }

  const worktreePath = resolveWorktreePath(readiness.implementationArtifactPath);
  const validation = validateVeraPatchContentDraftEntries(input.patchEntries, {
    worktreeRoot: worktreePath,
  });
  if (!validation.ok) {
    auditVeraImplementationPatchContentDraftBlocked(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: validation.reasonCode,
      message: validation.reason,
      sourceProposalPath: readiness.sourceProposalPath,
      sourceProposalHash: readiness.sourceProposalHash,
    });
    throw new VeraImplementationPatchContentDraftError(
      validation.reasonCode,
      validation.reason,
    );
  }

  const createdAt = new Date().toISOString();
  const draft: VeraImplementationPatchContentDraft = {
    schemaVersion: VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId: veraWorkOrderId ?? readiness.veraWorkOrderId ?? run.taskId,
    createdAt,
    createdBy: requestedBy,
    sourceProposalPath: readiness.sourceProposalPath!,
    sourceProposalHash: readiness.sourceProposalHash!,
    status: "draft_created",
    mode: "operator_supplied_patch_entries",
    patchEntries: validation.entries,
    validation: {
      entryCount: validation.entries.length,
      blockedPaths: [],
      warnings: validation.warnings,
    },
    nextGate: {
      required: true,
      phase: "2R",
      confirmationRequired: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
      note: "Patch content must be reviewed before it can be applied to the governed worktree.",
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
      sourceProposalHash: readiness.sourceProposalHash!,
      createdBy: requestedBy,
      tool: "vera-implementation-patch-content-draft",
    },
  };

  const { draftPath, draftHash } = writeVeraImplementationPatchContentDraft(draft);

  const updated = updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
    completedAt: null,
    agentMessage:
      "Vera patch content draft created. Review and application remain separately gated.",
    governanceNotes: mergeVeraRunGovernanceNotes(run.governanceNotes, {
      veraImplementationPatchContentDraftStatus: "draft_created",
      veraImplementationPatchContentDraftPath: draftPath,
      veraImplementationPatchContentDraftHash: draftHash,
      veraImplementationPatchContentDraftCreatedBy: requestedBy,
      veraImplementationPatchContentDraftCreatedAt: createdAt,
      veraImplementationPatchContentDraftEntryCount: validation.entries.length,
    }),
  });

  if (!updated) {
    auditVeraImplementationPatchContentDraftFailed(run.taskId, run.id, {
      requestedBy,
      veraWorkOrderId,
      reasonCode: "RUN_UPDATE_FAILED",
      message: "Failed to persist Vera patch content draft metadata.",
      sourceProposalPath: readiness.sourceProposalPath,
      sourceProposalHash: readiness.sourceProposalHash,
    });
    throw new VeraImplementationPatchContentDraftError(
      "RUN_UPDATE_FAILED",
      "Failed to persist Vera patch content draft metadata.",
      500,
    );
  }

  auditVeraImplementationPatchContentDraftCreated(run.taskId, run.id, {
    requestedBy,
    veraWorkOrderId,
    sourceProposalPath: readiness.sourceProposalPath,
    sourceProposalHash: readiness.sourceProposalHash,
    draftPath,
    draftHash,
    entryCount: validation.entries.length,
    note,
  });

  return {
    run: updated,
    taskId: run.taskId,
    veraWorkOrderId,
    draftPath,
    draftHash,
    entryCount: validation.entries.length,
    nextStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
    warning:
      "Review, patch application, commit, PR, merge, deploy, and release remain separately gated.",
  };
}
