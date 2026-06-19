export const WORKSPACE_TYPES = ["implementation", "verification", "integration", "diagnostic"] as const;
export type ExecutionWorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const WORKSPACE_STATUSES = [
  "requested",
  "provisioning",
  "ready",
  "active",
  "worker_complete",
  "verification_pending",
  "verified",
  "integration_ready",
  "integrating",
  "integrated",
  "conflicted",
  "failed",
  "abandoned",
  "cleanup_pending",
  "cleaned",
] as const;
export type ExecutionWorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export interface ExecutionRepository {
  id: string;
  displayName: string;
  canonicalPath: string;
  repositoryFingerprint: string;
  defaultBranch: string;
  protectedBranches: string[];
  workspaceRoot: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionWorkspace {
  id: string;
  repositoryId: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  attemptId: string;
  workspaceType: ExecutionWorkspaceType;
  status: ExecutionWorkspaceStatus;
  baseBranch: string;
  baseCommit: string;
  sourceAttemptId: string | null;
  branchName: string;
  worktreePath: string;
  candidateCommit: string | null;
  candidateTreeHash: string | null;
  patchHash: string | null;
  createdAt: string;
  readyAt: string | null;
  lastObservedAt: string | null;
  completedAt: string | null;
  cleanupRequestedAt: string | null;
  cleanedAt: string | null;
  failureReason: string | null;
  metadataJson: string;
}

export interface WorkspacePathClaim {
  id: string;
  repositoryId: string;
  projectId: string;
  requirementId: string;
  attemptId: string;
  workspaceId: string;
  pathPattern: string;
  claimType: "exclusive_write";
  status: "active" | "released" | "rejected";
  acquiredAt: string;
  releasedAt: string | null;
  expiresAt: string | null;
  reason: string;
}

export interface WorkspaceCommandEvent {
  id: string;
  workspaceId: string;
  attemptId: string;
  command: string;
  cwd: string;
  status: "allowed" | "rejected";
  reason: string | null;
  createdAt: string;
}

export interface CandidateIntegration {
  id: string;
  repositoryId: string;
  projectId: string;
  requirementId: string;
  attemptId: string;
  candidateWorkspaceId: string;
  verificationWorkspaceId: string | null;
  integrationWorkspaceId: string | null;
  targetBranch: string;
  targetCommitBefore: string;
  candidateCommit: string;
  integrationCommit: string | null;
  integrationTreeHash: string | null;
  status: "pending" | "preparing" | "applying" | "conflicted" | "testing" | "rejected" | "approved" | "integrated" | "cancelled";
  conflictSummary: string | null;
  qualityResult: string | null;
  createdAt: string;
  completedAt: string | null;
  approvedBy: string | null;
}

export interface CandidateFinalizationResult {
  workspace: ExecutionWorkspace;
  changedFiles: string[];
  candidateCommit: string;
  candidateTreeHash: string;
  patchHash: string;
  integrityFindings: string[];
}
