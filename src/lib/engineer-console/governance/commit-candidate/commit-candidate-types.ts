export const ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA = "engineering-commit-pr-candidate/v1" as const;
export const ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA = "engineering-local-commit-result/v1" as const;
export const ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA =
  "engineering-remote-branch-push-result/v1" as const;

export type CommitCandidateStatus =
  | "prepared"
  | "commit_candidate_prepared"
  | "local_commit_created"
  | "remote_branch_pushed"
  | "rejected";

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
  localCommitHash: string | null;
  localCommitCreatedAt: string | null;
  localCommitCreatedBy: string | null;
  localCommitReason: string | null;
  localCommitEvidencePath: string | null;
  remotePushStatus: string | null;
  remoteName: string | null;
  remoteBranchName: string | null;
  remoteRef: string | null;
  remotePushedAt: string | null;
  remotePushedBy: string | null;
  remotePushReason: string | null;
  remotePushEvidencePath: string | null;
  notCommitted: boolean;
  notPushed: boolean;
  notMerged: true;
  notDeployed: true;
  notComplete: true;
}
