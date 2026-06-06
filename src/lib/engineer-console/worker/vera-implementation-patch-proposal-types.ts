export const VERA_IMPLEMENTATION_PATCH_PROPOSAL_FILENAME =
  "implementation-patch-proposal.json";

export const VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP =
  "implementation_patch_proposal_ready";
export const VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP =
  "implementation_patch_proposal_approved";
export const VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP =
  "implementation_patch_proposal_rejected";

export const VERA_PATCH_PROPOSAL_SCHEMA_VERSION =
  "veralux.vera.implementation-patch-proposal.v1";

export const VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION = "APPLY VERA PATCH PROPOSAL";

export type VeraPatchProposalChangeAction =
  | "propose_change"
  | "needs_human_design"
  | "no_change";

export type VeraPatchProposalRiskLevel = "low" | "medium" | "high";

export type VeraApplicablePatchAction = "create_file" | "modify_file";

export type VeraMetadataOnlyPatchEntry = {
  filePath: string;
  action: VeraPatchProposalChangeAction;
  rationale: string;
  riskLevel: VeraPatchProposalRiskLevel;
  patchIncluded: false;
};

export type VeraApplicablePatchEntry = {
  filePath: string;
  action: VeraApplicablePatchAction;
  rationale: string;
  riskLevel: VeraPatchProposalRiskLevel;
  patchIncluded: true;
  patchContent: string;
  patchEncoding: "utf8";
};

export type VeraPatchProposalChangeEntry =
  | VeraMetadataOnlyPatchEntry
  | VeraApplicablePatchEntry;

export function isVeraApplicablePatchEntry(
  entry: VeraPatchProposalChangeEntry,
): entry is VeraApplicablePatchEntry {
  return entry.patchIncluded === true;
}

export function extractApplicablePatchEntries(
  proposal: Pick<VeraImplementationPatchProposal, "proposedChangeSet">,
): VeraApplicablePatchEntry[] {
  return proposal.proposedChangeSet.filter(isVeraApplicablePatchEntry);
}

export type VeraImplementationPatchProposal = {
  schemaVersion: "veralux.vera.implementation-patch-proposal.v1";
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  sourceArtifactPath: string;
  sourceArtifactHash: string;
  proposalPath?: string;
  proposalHash?: string;
  mode: "deterministic_metadata";
  status: "proposal_created";
  summary: string;
  proposedChangeSet: VeraPatchProposalChangeEntry[];
  nextGate: {
    required: true;
    phase: "2O";
    confirmationRequired: typeof VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION;
    note: string;
  };
  safety: {
    noPatchApplied: true;
    noCommitCreated: true;
    noPullRequestCreated: true;
    noMergePerformed: true;
    noDeploymentPerformed: true;
    noReleasePerformed: true;
  };
  provenance: {
    implementationArtifactHash: string;
    createdBy: string;
    tool: "vera-implementation-patch-proposal";
  };
};
