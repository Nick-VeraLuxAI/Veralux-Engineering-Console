export const VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_FILENAME =
  "implementation-patch-content-draft.json";

export const VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION =
  "veralux.vera.implementation-patch-content-draft.v1";

export const VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP =
  "implementation_patch_content_draft_ready";

export const VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP =
  "implementation_patch_content_draft_approved";

export const VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP =
  "implementation_patch_content_draft_rejected";

export const VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE =
  "CREATE VERA PATCH CONTENT DRAFT";

export const VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION =
  "APPROVE VERA PATCH CONTENT DRAFT";

export const VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION =
  "REJECT VERA PATCH CONTENT DRAFT";

export const VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE =
  "APPLY APPROVED VERA PATCH CONTENT DRAFT";

export type VeraPatchContentDraftAction = "create" | "modify";

export type VeraPatchContentDraftEntry = {
  filePath: string;
  action: VeraPatchContentDraftAction;
  patchIncluded: true;
  patchContent: string;
  contentEncoding: "utf8";
  expectedBeforeHash?: string | null;
};

export type VeraPatchContentDraftInputEntry = {
  filePath: string;
  action: string;
  patchIncluded?: boolean;
  patchContent: string;
  contentEncoding?: string;
  expectedBeforeHash?: string | null;
};

export type VeraImplementationPatchContentDraft = {
  schemaVersion: typeof VERA_PATCH_CONTENT_DRAFT_SCHEMA_VERSION;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  createdBy: string;
  sourceProposalPath: string;
  sourceProposalHash: string;
  status: "draft_created";
  mode: "operator_supplied_patch_entries";
  patchEntries: VeraPatchContentDraftEntry[];
  validation: {
    entryCount: number;
    blockedPaths: string[];
    warnings: string[];
  };
  nextGate: {
    required: true;
    phase: "2R";
    confirmationRequired: typeof VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION;
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
    sourceProposalHash: string;
    createdBy: string;
    tool: "vera-implementation-patch-content-draft";
  };
};
