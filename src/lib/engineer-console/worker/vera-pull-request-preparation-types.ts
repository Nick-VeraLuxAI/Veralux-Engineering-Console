import {
  VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
  VERA_PULL_REQUEST_PREPARE_PHASE_2X,
} from "./vera-commit-report-types";

export const VERA_PULL_REQUEST_PREPARATION_FILENAME =
  "implementation-pull-request-preparation.json";

export const VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION =
  "veralux.vera.implementation-pull-request-preparation.v1";

export const VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP =
  "implementation_pull_request_prepared";

export const VERA_PULL_REQUEST_PREPARATION_PHASE_2X = VERA_PULL_REQUEST_PREPARE_PHASE_2X;

/** Exact confirmation — no trim, no normalization. */
export const VERA_PULL_REQUEST_PREPARATION_CONFIRMATION =
  VERA_PULL_REQUEST_PREPARE_CONFIRMATION;

export const VERA_PULL_REQUEST_CREATE_PHASE_2Y = "2Y";

export const VERA_PULL_REQUEST_CREATE_CONFIRMATION = "CREATE VERA PULL REQUEST";

export const VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH = "main";

export const VERA_PULL_REQUEST_DEFAULT_TITLE = "Vera gated lifecycle recovery smoke";

export type VeraPullRequestPreparationValidationResult = {
  checkId: string;
  ok: boolean;
  message: string;
};

export type VeraPullRequestPreparationFile = {
  path: string;
  sha256: string;
};

export type VeraPullRequestPreparationSafety = {
  noStagingPerformed: true;
  noCommitCreated: true;
  noPushPerformed: true;
  noGitHubCalled: true;
  noPullRequestCreated: true;
  noMergePerformed: true;
  noDeploymentPerformed: true;
  noReleasePerformed: true;
};

export type VeraPullRequestPreparation = {
  schemaVersion: typeof VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION;
  phase: typeof VERA_PULL_REQUEST_PREPARATION_PHASE_2X;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  targetRepoPath: string;
  branchName: string;
  sourceCommitReportPath: string;
  sourceCommitReportHash: string;
  commitSha: string;
  commitShaPrefix: string;
  parentHeadSha: string;
  baseBranch: string;
  headBranch: string;
  proposedPrTitle: string;
  proposedPrBody: string;
  proposedPrFiles: VeraPullRequestPreparationFile[];
  excludedDirtyFiles: string[];
  dirtyWorkingTreeSummary: string;
  validationResults: VeraPullRequestPreparationValidationResult[];
  nextGate: {
    required: true;
    phase: typeof VERA_PULL_REQUEST_CREATE_PHASE_2Y;
    confirmationRequired: typeof VERA_PULL_REQUEST_CREATE_CONFIRMATION;
    note: string;
  };
  safety: VeraPullRequestPreparationSafety;
  provenance: {
    sourceCommitReportHash: string;
    preparedBy: string;
    tool: "vera-pull-request-preparation";
  };
};
