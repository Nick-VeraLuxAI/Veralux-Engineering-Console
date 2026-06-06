export const VERA_IMPLEMENTATION_PATCH_APPLICATION_FILENAME =
  "implementation-patch-application-report.json";

export const VERA_IMPLEMENTATION_PATCH_APPLIED_STEP = "implementation_patch_applied";

export const VERA_PATCH_APPLICATION_SCHEMA_VERSION =
  "veralux.vera.implementation-patch-application.v1";

export const VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE = "APPLY VERA PATCH PROPOSAL";

export const VERA_POST_PATCH_GATE_CONFIRMATION = "RUN VERA POST-PATCH QUALITY GATES";

export const VERA_POST_PATCH_GATE_PHASE_2T = "2T";

export const VERA_PATCH_APPLICATION_MAX_FILE_BYTES = 512 * 1024;

export type VeraPatchApplicationFileAction = "created" | "modified";

export type VeraPatchApplicationAppliedFile = {
  filePath: string;
  action: VeraPatchApplicationFileAction;
  beforeHash?: string;
  afterHash?: string;
};

export type VeraPatchApplicationReportSafety = {
  noCommitCreated: true;
  noPullRequestCreated: true;
  noMergePerformed: true;
  noDeploymentPerformed: true;
  noReleasePerformed: true;
};

type VeraPatchApplicationReportBase = {
  schemaVersion: typeof VERA_PATCH_APPLICATION_SCHEMA_VERSION;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  worktreePath: string;
  status: "patch_applied" | "blocked";
  appliedFiles: VeraPatchApplicationAppliedFile[];
  skippedFiles?: string[];
  blockedReasons?: string[];
  safety: VeraPatchApplicationReportSafety;
};

export type VeraProposalSourcedPatchApplicationReport = VeraPatchApplicationReportBase & {
  source?: "patch_proposal";
  sourceProposalPath: string;
  sourceProposalHash: string;
  nextGate: {
    required: true;
    phase: "2Q";
    confirmationRequired: typeof VERA_POST_PATCH_GATE_CONFIRMATION;
    note: string;
  };
  provenance: {
    proposalHash: string;
    appliedBy: string;
    tool: "vera-implementation-patch-application";
  };
};

export type VeraDraftSourcedPatchApplicationReport = VeraPatchApplicationReportBase & {
  source: "patch_content_draft";
  sourceDraftPath: string;
  sourceDraftHash: string;
  nextGate: {
    required: true;
    phase: typeof VERA_POST_PATCH_GATE_PHASE_2T;
    confirmationRequired: typeof VERA_POST_PATCH_GATE_CONFIRMATION;
    note: string;
  };
  provenance: {
    sourceDraftHash: string;
    appliedBy: string;
    tool: "vera-approved-patch-content-application";
  };
};

export type VeraImplementationPatchApplicationReport =
  | VeraProposalSourcedPatchApplicationReport
  | VeraDraftSourcedPatchApplicationReport;
