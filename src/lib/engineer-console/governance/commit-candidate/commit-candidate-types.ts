export const ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA = "engineering-commit-pr-candidate/v1" as const;

export type CommitCandidateStatus = "prepared" | "rejected";

export interface EngineeringCommitPrCandidatePacketV1 {
  schema: typeof ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA;
  runId: string;
  taskId: string;
  repoPath: string;
  branchName: string;
  commitMessage: string;
  changedFiles: string[];
  signOffDecision: string;
  signOffId: string;
  evidenceSnapshotHash: string;
  qualityGateSummary: unknown;
  patchApplicationSummary: unknown;
  rollbackAvailable: boolean;
  riskNotes: string[];
  testEvidencePaths: string[];
  createdBy: string;
  createdReason: string;
  createdAt: string;
  notCommitted: true;
  notPushed: true;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}

export interface CommitCandidateRecord {
  id: string;
  runId: string;
  status: CommitCandidateStatus;
  branchName: string;
  commitMessage: string;
  changedFilesJson: string;
  evidenceSnapshotHash: string;
  signoffId: string;
  commitPacketPath: string;
  prDraftPath: string;
  createdBy: string;
  createdReason: string;
  createdAt: string;
  notCommitted: true;
  notPushed: true;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}
