export const VERA_IMPLEMENTATION_PATCH_APPLICATION_FILENAME =
  "implementation-patch-application-report.json";

export const VERA_IMPLEMENTATION_PATCH_APPLIED_STEP = "implementation_patch_applied";

export const VERA_PATCH_APPLICATION_SCHEMA_VERSION =
  "veralux.vera.implementation-patch-application.v1";

export const VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE = "APPLY VERA PATCH PROPOSAL";

export const VERA_POST_PATCH_GATE_CONFIRMATION = "RUN VERA POST-PATCH QUALITY GATES";

export const VERA_PATCH_APPLICATION_MAX_FILE_BYTES = 512 * 1024;

export type VeraPatchApplicationFileAction = "created" | "modified";

export type VeraImplementationPatchApplicationReport = {
  schemaVersion: typeof VERA_PATCH_APPLICATION_SCHEMA_VERSION;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  sourceProposalPath: string;
  sourceProposalHash: string;
  worktreePath: string;
  status: "patch_applied" | "blocked";
  appliedFiles: Array<{
    filePath: string;
    action: VeraPatchApplicationFileAction;
    beforeHash?: string;
    afterHash?: string;
  }>;
  blockedReasons?: string[];
  nextGate: {
    required: true;
    phase: "2Q";
    confirmationRequired: typeof VERA_POST_PATCH_GATE_CONFIRMATION;
    note: string;
  };
  safety: {
    noCommitCreated: true;
    noPullRequestCreated: true;
    noMergePerformed: true;
    noDeploymentPerformed: true;
    noReleasePerformed: true;
  };
  provenance: {
    proposalHash: string;
    appliedBy: string;
    tool: "vera-implementation-patch-application";
  };
};
