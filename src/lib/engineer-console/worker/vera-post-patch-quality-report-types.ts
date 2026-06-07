export const VERA_POST_PATCH_QUALITY_REPORT_FILENAME = "post-patch-quality-report.json";

export const VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION =
  "veralux.vera.post-patch-quality-report.v1";

export const VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP =
  "implementation_post_patch_quality_gates_completed";

export const VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION =
  "APPROVE VERA POST-PATCH QUALITY REPORT";

export const VERA_POST_PATCH_QUALITY_GATE_PHASE_2U = "2U";

export type VeraPostPatchQualityGateStatus = "passed" | "failed" | "blocked";

export type VeraPostPatchQualityGateResult = {
  gateId: string;
  status: VeraPostPatchQualityGateStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type VeraPostPatchQualityReportSafety = {
  noPatchAppliedBeyondApprovedDraft: true;
  noCommitCreated: true;
  noPullRequestCreated: true;
  noMergePerformed: true;
  noDeploymentPerformed: true;
  noReleasePerformed: true;
};

export type VeraPostPatchQualityReport = {
  schemaVersion: typeof VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION;
  runId: string;
  taskId: string;
  veraWorkOrderId: string;
  createdAt: string;
  sourceApplicationReportPath: string;
  sourceApplicationReportHash: string;
  targetRepoPath: string;
  branchName: string | null;
  changedFiles: string[];
  appliedFiles: string[];
  gateResults: VeraPostPatchQualityGateResult[];
  overallStatus: VeraPostPatchQualityGateStatus;
  validationMode: "deterministic_post_patch_validation";
  worktreeGitStatusSummary: string;
  nextGate: {
    required: true;
    phase: typeof VERA_POST_PATCH_QUALITY_GATE_PHASE_2U;
    confirmationRequired: typeof VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION;
    note: string;
  };
  safety: VeraPostPatchQualityReportSafety;
  provenance: {
    sourceApplicationReportHash: string;
    ranBy: string;
    tool: "vera-post-patch-quality-gates";
  };
};
