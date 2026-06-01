/** Bounded Hermes run packet produced by Engineering Console (not Hermes source-of-truth). */
export const HERMES_RUN_PACKET_SCHEMA_VERSION = "hermes-run-packet/v1" as const;

export const HERMES_WORKER_BACKEND = "hermes" as const;

export type HermesDispatchStatus = "prepared" | "dispatched";

export interface HermesBranchWorktreePolicy {
  mode: "engineering-console-managed";
  /** Existing run branch or suggested name Hermes must use (no ad-hoc default branch). */
  branchName: string;
  createBranchIfMissing: boolean;
}

export interface HermesRepoPolicy {
  /** Resolved absolute path (Console-validated). */
  repoPath: string;
  registeredRepoId: string | null;
  repoPathRef: string;
  branchWorktree: HermesBranchWorktreePolicy;
}

export interface HermesPathPolicy {
  allowedPaths: string[];
  forbiddenPaths: string[];
}

export interface HermesCommandPolicy {
  /** Quality-gate commands only; no arbitrary shell. */
  allowedCommands: string[];
}

export interface HermesProposedOperation {
  type: "create_file" | "update_file" | "append_file";
  path: string;
  content: string;
  reason: string;
}

export interface HermesWorkerPlanRef {
  workerPlanId: string;
  summary: string;
  allowedFiles: string[];
  operationPaths: string[];
  validationStatus: string;
  /** Bounded operation payloads for Hermes patch proposal (Phase 8). */
  proposedOperations: HermesProposedOperation[];
}

export interface HermesEvidenceTarget {
  /** Console-managed placeholder; Hermes writes worker output here as evidence input only. */
  placeholderPath: string;
  reportFileName: string;
  governanceNote: string;
}

export interface HermesRunPacketV1 {
  schemaVersion: typeof HERMES_RUN_PACKET_SCHEMA_VERSION;
  dispatchId: string;
  engineeringConsole: {
    runId: string;
    taskId: string;
    workerBackend: typeof HERMES_WORKER_BACKEND;
    preparedAt: string;
  };
  task: {
    title: string;
    instructions: string;
  };
  target: HermesRepoPolicy;
  policy: HermesPathPolicy & HermesCommandPolicy;
  workerPlan: HermesWorkerPlanRef;
  qualityGates: {
    expectedCommands: string[];
  };
  evidence: HermesEvidenceTarget;
  governance: {
    sourceOfTruth: "engineering-console";
    hermesRole: "external-worker";
    signOffAuthority: "engineering-console-only";
    allowRepoMutationOutsidePolicy: false;
  };
}

export interface HermesWorkerDispatchRecord {
  id: string;
  runId: string;
  taskId: string;
  workerPlanId: string | null;
  workerBackend: typeof HERMES_WORKER_BACKEND;
  status: HermesDispatchStatus;
  packetHash: string;
  packetJson: string;
  exportPath: string | null;
  evidencePlaceholderPath: string;
  preparedAt: string;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
