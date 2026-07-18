export const VERA_HANDOFF_DESCRIPTION_HEADING = "## Engineering request from VeraLux OS";
export const VERA_HANDOFF_SOURCE = "veralux-os";
export const VERA_HANDOFF_NON_EXECUTION_NOTE = "This request does not execute code.";
export const VERA_WORK_ORDER_MODULE_PREFIX = "vera-work-order:";
export const VERA_IMPLEMENTATION_RUN_PREPARED_STEP = "vera_implementation_prepared";
export const VERA_IMPLEMENTATION_RUN_PREPARE_CONFIRMATION_PHRASE =
  "PREPARE VERA IMPLEMENTATION RUN";
export const VERA_EXECUTION_APPROVAL_REQUESTED_STEP = "vera_execution_approval_requested";
export const VERA_EXECUTION_APPROVAL_REQUEST_CONFIRMATION_PHRASE =
  "REQUEST VERA EXECUTION APPROVAL";
export const VERA_EXECUTION_APPROVAL_REQUESTED_NOTE =
  "Execution approval requested only. No code was executed." as const;
export const VERA_EXECUTION_START_CONFIRMATION_PHRASE = "START VERA EXECUTION";
export const VERA_EXECUTION_START_ACCEPTED_NOTE =
  "Vera execution start accepted. Review, merge, deploy, and PR remain separately gated." as const;

export type VeraRunGovernanceNotes = {
  veraHandoff?: boolean;
  veraWorkOrderId?: string | null;
  preparedBy?: string;
  preparedAt?: string;
  veraExecutionApprovalRequested?: boolean;
  requestedBy?: string;
  requestedAt?: string;
  veraExecutionStartRequested?: boolean;
  executionStartedBy?: string;
  executionStartRequestedAt?: string;
  veraImplementationArtifactPath?: string | null;
  veraImplementationArtifactHash?: string | null;
  veraImplementationWorkerStatus?: string | null;
  veraImplementationWorkerMode?: string | null;
  veraImplementationArtifactReviewDecision?: "approved" | "rejected" | null;
  veraImplementationArtifactReviewedBy?: string | null;
  veraImplementationArtifactReviewedAt?: string | null;
  veraImplementationArtifactReviewNote?: string | null;
  veraImplementationPatchProposalPath?: string | null;
  veraImplementationPatchProposalHash?: string | null;
  veraImplementationPatchProposalStatus?: string | null;
  veraImplementationPatchProposalCreatedBy?: string | null;
  veraImplementationPatchProposalCreatedAt?: string | null;
  veraImplementationPatchProposalReviewDecision?: "approved" | "rejected" | null;
  veraImplementationPatchProposalReviewedBy?: string | null;
  veraImplementationPatchProposalReviewedAt?: string | null;
  veraImplementationPatchProposalReviewNote?: string | null;
  veraImplementationPatchApplicationStatus?: string | null;
  veraImplementationPatchApplicationPath?: string | null;
  veraImplementationPatchApplicationHash?: string | null;
  veraImplementationPatchAppliedBy?: string | null;
  veraImplementationPatchAppliedAt?: string | null;
  veraImplementationPatchAppliedFiles?: string[] | null;
  veraImplementationPatchApplicationSource?: string | null;
  veraImplementationPatchContentDraftStatus?: string | null;
  veraImplementationPatchContentDraftPath?: string | null;
  veraImplementationPatchContentDraftHash?: string | null;
  veraImplementationPatchContentDraftCreatedBy?: string | null;
  veraImplementationPatchContentDraftCreatedAt?: string | null;
  veraImplementationPatchContentDraftEntryCount?: number | null;
  veraImplementationPatchContentDraftReviewDecision?: "approved" | "rejected" | null;
  veraImplementationPatchContentDraftReviewedBy?: string | null;
  veraImplementationPatchContentDraftReviewedAt?: string | null;
  veraImplementationPatchContentDraftReviewNote?: string | null;
  veraPostPatchQualityStatus?: string | null;
  veraPostPatchQualityReportPath?: string | null;
  veraPostPatchQualityReportHash?: string | null;
  veraPostPatchQualityRanBy?: string | null;
  veraPostPatchQualityRanAt?: string | null;
  veraPostPatchQualityGateSummary?: string | null;
  veraPostPatchQualityReportReviewDecision?: "approved" | "rejected" | null;
  veraPostPatchQualityReportReviewedBy?: string | null;
  veraPostPatchQualityReportReviewedAt?: string | null;
  veraPostPatchQualityReportReviewNote?: string | null;
  veraPostPatchQualityReportApprovedHash?: string | null;
  veraCommitProposalStatus?: string | null;
  veraCommitProposalPath?: string | null;
  veraCommitProposalHash?: string | null;
  veraCommitProposalCreatedBy?: string | null;
  veraCommitProposalCreatedAt?: string | null;
  veraCommitProposalFileCount?: number | null;
  veraCommitProposalSource?: string | null;
  nonExecutionNote?: string;
};

export const VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE = "CREATE VERA PATCH PROPOSAL";
export const VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE = "APPROVE VERA PATCH PROPOSAL";
export const VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE = "REJECT VERA PATCH PROPOSAL";

export type VeraImplementationPatchProposalReviewDecision = "approved" | "rejected";

export const VERA_IMPLEMENTATION_ARTIFACT_APPROVE_CONFIRMATION_PHRASE =
  "APPROVE VERA IMPLEMENTATION ARTIFACT";
export const VERA_IMPLEMENTATION_ARTIFACT_REJECT_CONFIRMATION_PHRASE =
  "REJECT VERA IMPLEMENTATION ARTIFACT";

export type VeraImplementationArtifactReviewDecision = "approved" | "rejected";

export function parseVeraRunGovernanceNotes(
  governanceNotes: string | null | undefined,
): VeraRunGovernanceNotes {
  if (!governanceNotes?.trim()) return {};
  try {
    return JSON.parse(governanceNotes) as VeraRunGovernanceNotes;
  } catch {
    return {};
  }
}

export function isVeraHandoffRunFromGovernanceNotes(
  governanceNotes: string | null | undefined,
): boolean {
  return parseVeraRunGovernanceNotes(governanceNotes).veraHandoff === true;
}

export function hasVeraExecutionStartBeenRequested(
  governanceNotes: string | null | undefined,
): boolean {
  return parseVeraRunGovernanceNotes(governanceNotes).veraExecutionStartRequested === true;
}

export function isVeraStartedImplementationRun(run: {
  governanceNotes: string | null | undefined;
}): boolean {
  const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
  return notes.veraHandoff === true && notes.veraExecutionStartRequested === true;
}

export function hasVeraImplementationArtifact(
  governanceNotes: string | null | undefined,
): boolean {
  const notes = parseVeraRunGovernanceNotes(governanceNotes);
  return Boolean(notes.veraImplementationArtifactPath?.trim());
}

export function getVeraImplementationArtifactReviewDecision(
  governanceNotes: string | null | undefined,
): VeraImplementationArtifactReviewDecision | null {
  const decision = parseVeraRunGovernanceNotes(governanceNotes)
    .veraImplementationArtifactReviewDecision;
  return decision === "approved" || decision === "rejected" ? decision : null;
}

export function hasVeraImplementationArtifactReviewDecision(
  governanceNotes: string | null | undefined,
): boolean {
  return getVeraImplementationArtifactReviewDecision(governanceNotes) !== null;
}

export function hasVeraImplementationPatchProposal(
  governanceNotes: string | null | undefined,
): boolean {
  const notes = parseVeraRunGovernanceNotes(governanceNotes);
  return Boolean(notes.veraImplementationPatchProposalPath?.trim());
}

export function getVeraImplementationPatchProposalReviewDecision(
  governanceNotes: string | null | undefined,
): VeraImplementationPatchProposalReviewDecision | null {
  const decision = parseVeraRunGovernanceNotes(governanceNotes)
    .veraImplementationPatchProposalReviewDecision;
  return decision === "approved" || decision === "rejected" ? decision : null;
}

export function hasVeraImplementationPatchProposalReviewDecision(
  governanceNotes: string | null | undefined,
): boolean {
  return getVeraImplementationPatchProposalReviewDecision(governanceNotes) !== null;
}

export function hasVeraImplementationPatchApplication(
  governanceNotes: string | null | undefined,
): boolean {
  const notes = parseVeraRunGovernanceNotes(governanceNotes);
  return notes.veraImplementationPatchApplicationStatus === "patch_applied";
}

export function hasVeraImplementationPatchContentDraft(
  governanceNotes: string | null | undefined,
): boolean {
  const notes = parseVeraRunGovernanceNotes(governanceNotes);
  return Boolean(notes.veraImplementationPatchContentDraftPath?.trim());
}

export type VeraImplementationPatchContentDraftReviewDecision = "approved" | "rejected";

export function getVeraImplementationPatchContentDraftReviewDecision(
  governanceNotes: string | null | undefined,
): VeraImplementationPatchContentDraftReviewDecision | null {
  const decision = parseVeraRunGovernanceNotes(governanceNotes)
    .veraImplementationPatchContentDraftReviewDecision;
  return decision === "approved" || decision === "rejected" ? decision : null;
}

export function hasVeraImplementationPatchContentDraftReviewDecision(
  governanceNotes: string | null | undefined,
): boolean {
  return getVeraImplementationPatchContentDraftReviewDecision(governanceNotes) !== null;
}

export function hasVeraPostPatchQualityReport(
  governanceNotes: string | null | undefined,
): boolean {
  const notes = parseVeraRunGovernanceNotes(governanceNotes);
  return (
    notes.veraPostPatchQualityStatus === "completed" ||
    Boolean(notes.veraPostPatchQualityReportPath?.trim())
  );
}

export type VeraPostPatchQualityReportReviewDecision = "approved" | "rejected";

export function getVeraPostPatchQualityReportReviewDecision(
  governanceNotes: string | null | undefined,
): VeraPostPatchQualityReportReviewDecision | null {
  const decision = parseVeraRunGovernanceNotes(governanceNotes)
    .veraPostPatchQualityReportReviewDecision;
  return decision === "approved" || decision === "rejected" ? decision : null;
}

export function hasVeraPostPatchQualityReportReviewDecision(
  governanceNotes: string | null | undefined,
): boolean {
  return getVeraPostPatchQualityReportReviewDecision(governanceNotes) !== null;
}

export function hasVeraCommitProposal(
  governanceNotes: string | null | undefined,
): boolean {
  const notes = parseVeraRunGovernanceNotes(governanceNotes);
  return (
    notes.veraCommitProposalStatus === "proposal_created" ||
    Boolean(notes.veraCommitProposalPath?.trim())
  );
}

export function mergeVeraRunGovernanceNotes(
  existingNotes: string | null | undefined,
  patch: Partial<VeraRunGovernanceNotes> & Record<string, unknown>,
): string {
  const base = parseVeraRunGovernanceNotes(existingNotes);
  let extra: Record<string, unknown> = {};
  if (existingNotes?.trim()) {
    try {
      extra = JSON.parse(existingNotes) as Record<string, unknown>;
    } catch {
      extra = {};
    }
  }
  return JSON.stringify({
    ...extra,
    ...base,
    ...patch,
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VeraHandoffTaskAnalysis = {
  isVeraLuxOsHandoffTask: boolean;
  source: typeof VERA_HANDOFF_SOURCE | null;
  veraWorkOrderId: string | null;
  nonExecutionNotePresent: boolean;
  taskIsDraft: boolean;
  repoBindingPresent: boolean;
  repoPath: string | null;
  safeToPrepareRun: boolean;
  blockers: string[];
};

export function isVeraLuxOsHandoffDescription(description: string): boolean {
  if (!description.includes(VERA_HANDOFF_DESCRIPTION_HEADING)) return false;
  return /\*\*Source:\*\*\s*veralux-os/.test(description);
}

export function extractVeraWorkOrderIdFromDescription(description: string): string | null {
  const jsonMatch = description.match(
    /### Business context[\s\S]*?```json\s*([\s\S]*?)\s*```/,
  );
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { module?: string };
      const moduleValue = parsed.module?.trim() ?? "";
      if (moduleValue.startsWith(VERA_WORK_ORDER_MODULE_PREFIX)) {
        const workOrderId = moduleValue.slice(VERA_WORK_ORDER_MODULE_PREFIX.length);
        if (UUID_PATTERN.test(workOrderId)) return workOrderId;
      }
    } catch {
      /* fall through to instruction marker */
    }
  }

  const sourceMatch = description.match(/Source work order ID:\s*([0-9a-f-]{36})/i);
  if (sourceMatch?.[1] && UUID_PATTERN.test(sourceMatch[1])) {
    return sourceMatch[1]!;
  }

  return null;
}

export function hasVeraHandoffNonExecutionNote(description: string): boolean {
  return description.includes(VERA_HANDOFF_NON_EXECUTION_NOTE);
}
