import {
  VERA_COMMIT_CREATE_CONFIRMATION,
  VERA_COMMIT_CREATE_PHASE_2W,
} from "./vera-commit-proposal-types";

export const VERA_COMMIT_REPORT_FILENAME = "implementation-commit-report.json";

export const VERA_COMMIT_REPORT_SCHEMA_VERSION =
  "veralux.vera.implementation-commit-report.v1";

export const VERA_IMPLEMENTATION_COMMIT_CREATED_STEP = "implementation_commit_created";

export const VERA_COMMIT_PHASE_2W = VERA_COMMIT_CREATE_PHASE_2W;

/** Exact confirmation — no trim, no normalization. */
export const VERA_COMMIT_CONFIRMATION = VERA_COMMIT_CREATE_CONFIRMATION;

export const VERA_PULL_REQUEST_PREPARE_PHASE_2X = "2X";

export const VERA_PULL_REQUEST_PREPARE_CONFIRMATION = "PREPARE VERA PULL REQUEST";

export type VeraCommitReportValidationResult = {
  checkId: string;
  ok: boolean;
  message: string;
};

export type VeraCommitReportCommittedFile = {
  path: string;
  sha256: string;
};

export type VeraCommitReportSafety = {
  stagedOnlyProposedFiles: true;
  noPushPerformed: true;
  noPullRequestCreated: true;
  noMergePerformed: true;
  noDeploymentPerformed: true;
  noReleasePerformed: true;
};

export type VeraCommitReport = {
  schemaVersion: typeof VERA_COMMIT_REPORT_SCHEMA_VERSION;
  phase: typeof VERA_COMMIT_PHASE_2W;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  targetRepoPath: string;
  branchName: string;
  parentHeadSha: string;
  commitSha: string;
  commitShaPrefix: string;
  commitMessage: string;
  sourceCommitProposalPath: string;
  sourceCommitProposalHash: string;
  committedFiles: VeraCommitReportCommittedFile[];
  committedFileHashes: Record<string, string>;
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
  validationResults: VeraCommitReportValidationResult[];
  createdBy: string;
  nextGate: {
    required: true;
    phase: typeof VERA_PULL_REQUEST_PREPARE_PHASE_2X;
    confirmationRequired: typeof VERA_PULL_REQUEST_PREPARE_CONFIRMATION;
    note: string;
  };
  safety: VeraCommitReportSafety;
  provenance: {
    sourceCommitProposalHash: string;
    createdBy: string;
    tool: "vera-commit-create";
  };
};
