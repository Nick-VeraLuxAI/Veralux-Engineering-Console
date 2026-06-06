export const VERA_IMPLEMENTATION_ARTIFACT_FILENAME = "implementation-worker-report.json";

export const VERA_IMPLEMENTATION_ARTIFACT_READY_STEP = "implementation_artifact_ready";
export const VERA_IMPLEMENTATION_ARTIFACT_BLOCKED_STEP = "implementation_artifact_blocked";
export const VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP = "implementation_artifact_approved";
export const VERA_IMPLEMENTATION_ARTIFACT_REJECTED_STEP = "implementation_artifact_rejected";

export type VeraImplementationWorkerStatus =
  | "artifact_created"
  | "patch_proposed"
  | "blocked"
  | "failed";

export type VeraImplementationWorkerMode =
  | "deterministic_metadata"
  | "model_ready_deferred";

export type VeraImplementationWorkerArtifact = {
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  createdAt: string;
  workerMode: VeraImplementationWorkerMode;
  workerStatus: VeraImplementationWorkerStatus;
  branchName: string | null;
  repoPath: string | null;
  worktreePath: string | null;
  taskTitle: string;
  taskInstructionsExcerpt: string;
  implementationSummary: string;
  interpretedObjective: string;
  proposedNextActions: string[];
  blockers: string[];
  warnings: string[];
  filesInspected: string[];
  filesChanged: string[];
  filesProposed: string[];
  patchProposalPath: string | null;
  evidencePath: string | null;
  noPrCreated: true;
  noMergePerformed: true;
  noDeploymentPerformed: true;
  noReleasePerformed: true;
};

export type VeraImplementationWorkerResult = {
  status: VeraImplementationWorkerStatus;
  workerMode: VeraImplementationWorkerMode;
  artifactPath: string | null;
  artifactHash: string | null;
  artifact: VeraImplementationWorkerArtifact | null;
  message: string;
};
