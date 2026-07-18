export const VERA_COMMIT_PROPOSAL_FILENAME = "implementation-commit-proposal.json";

export const VERA_COMMIT_PROPOSAL_SCHEMA_VERSION =
  "veralux.vera.implementation-commit-proposal.v1";

export const VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP =
  "implementation_commit_proposal_ready";

/** Exact confirmation — no trim, no normalization. */
export const VERA_COMMIT_PROPOSAL_CONFIRMATION = "PREPARE VERA COMMIT PROPOSAL";

export const VERA_COMMIT_PROPOSAL_PHASE_2V = "2V";

export const VERA_COMMIT_CREATE_PHASE_2W = "2W";

export const VERA_COMMIT_CREATE_CONFIRMATION = "CREATE VERA COMMIT";

export type VeraCommitProposalFileStatus = "added" | "modified";

export type VeraCommitProposalProposedFile = {
  path: string;
  status: VeraCommitProposalFileStatus;
  sha256: string;
  evidenceSource: "patch_application_report";
  applicationReportHash: string;
  qualityReportHash: string;
};

export type VeraCommitProposalValidationResult = {
  checkId: string;
  ok: boolean;
  message: string;
};

export type VeraCommitProposalSafety = {
  noStagingPerformed: true;
  noCommitCreated: true;
  noPushPerformed: true;
  noPullRequestCreated: true;
  noMergePerformed: true;
  noDeploymentPerformed: true;
  noReleasePerformed: true;
};

export type VeraCommitProposal = {
  schemaVersion: typeof VERA_COMMIT_PROPOSAL_SCHEMA_VERSION;
  phase: typeof VERA_COMMIT_PROPOSAL_PHASE_2V;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  targetRepoPath: string;
  branchName: string;
  targetHeadSha: string;
  sourceApplicationReportPath: string;
  sourceApplicationReportHash: string;
  sourceQualityReportPath: string;
  sourceQualityReportHash: string;
  qualityReportReviewDecision: "approved";
  proposedCommitMessage: string;
  proposedFiles: VeraCommitProposalProposedFile[];
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
  validationResults: VeraCommitProposalValidationResult[];
  nextGate: {
    required: true;
    phase: typeof VERA_COMMIT_CREATE_PHASE_2W;
    confirmationRequired: typeof VERA_COMMIT_CREATE_CONFIRMATION;
    note: string;
  };
  safety: VeraCommitProposalSafety;
  provenance: {
    sourceApplicationReportHash: string;
    sourceQualityReportHash: string;
    preparedBy: string;
    tool: "vera-commit-proposal-prepare";
  };
};
