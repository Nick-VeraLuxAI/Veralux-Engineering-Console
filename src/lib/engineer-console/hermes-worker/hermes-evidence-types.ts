/** Evidence returned by Hermes consumer (input to Console review only). */
export const HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION = "hermes-engineering-evidence/v1" as const;

export type HermesEvidenceStatus =
  | "inspected"
  | "prepared"
  | "failed"
  | "patch_proposed"
  | "patch_applied";

export type HermesEvidenceMode = "dry-run" | "patch-proposal";

export interface HermesEngineeringEvidenceV1 {
  schemaVersion: typeof HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION;
  status: HermesEvidenceStatus;
  mode?: HermesEvidenceMode;
  dispatchId: string;
  runId: string;
  taskId: string;
  taskTitle?: string;
  repoPathRef?: string;
  repoPath?: string;
  packetHash?: string;
  instructionsSummary?: string;
  filesInspected?: Array<{ path: string; exists: boolean; sizeBytes?: number | null }>;
  filesProposedForChange?: string[];
  proposedChanges?: {
    mode: string;
    summary?: string;
    operationPaths?: string[];
    note?: string;
  };
  commands?: {
    allowed: string[];
    executed: string[];
    executionMode?: string;
    note?: string;
  };
  boundaryValidation?: {
    valid: boolean;
    checks: Array<{ id: string; ok: boolean; detail?: string }>;
  };
  artifacts?: {
    proposedPatchPath?: string;
    summaryPath?: string;
    proposedFilesPath?: string;
    evidenceDirectory?: string;
  };
  changesApplied?: boolean;
  timestamp: string;
  governance: {
    evidenceOnly: boolean;
    notSignOff: boolean;
    notApproval?: boolean;
    sourceOfTruth: string;
    hermesRole?: string;
  };
  error?: { code: string; message: string };
}

export interface HermesWorkerEvidenceSummary {
  available: boolean;
  dispatchId: string | null;
  status: HermesEvidenceStatus | null;
  mode: HermesEvidenceMode | null;
  inspectedAt: string | null;
  reportPath: string | null;
  instructionsSummary: string | null;
  filesInspectedCount: number;
  boundaryValid: boolean | null;
  /** Always true — Hermes evidence never grants approval. */
  evidenceOnlyNotSignOff: true;
  proposedChangesMode: string | null;
  changesApplied: boolean;
  patchProposal: {
    available: boolean;
    status: "patch_proposed" | "failed" | null;
    changedFileCount: number;
    proposedPatchPath: string | null;
    summaryPath: string | null;
    proposedFilesPath: string | null;
    /** Truncated diff for UI; full file on disk. */
    proposedPatchPreview: string | null;
    summaryExcerpt: string | null;
  };
  patchApplication: {
    status: "not_applied" | "patch_applied" | "rolled_back";
    appliedAt: string | null;
    appliedBy: string | null;
    changedFiles: string[];
    rollbackArtifactPath: string | null;
    rolledBackAt: string | null;
    rolledBackBy: string | null;
    /** Truncated for UI; full text in audit ledger. */
    rolledBackReason: string | null;
    /** Application is not sign-off. */
    notSignOff: true;
  };
}
