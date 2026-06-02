export const ENGINEERING_COMMIT_PR_CANDIDATE_SCHEMA = "engineering-commit-pr-candidate/v1" as const;
export const ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA = "engineering-local-commit-result/v1" as const;
export const ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA =
  "engineering-remote-branch-push-result/v1" as const;
export const ENGINEERING_PULL_REQUEST_RESULT_SCHEMA =
  "engineering-pull-request-result/v1" as const;

export type CommitCandidateStatus =
  | "prepared"
  | "commit_candidate_prepared"
  | "local_commit_created"
  | "remote_branch_pushed"
  | "pull_request_created"
  | "pull_request_packet_prepared"
  | "merge_readiness_recorded"
  | "pull_request_merged"
  | "deploy_readiness_recorded"
  | "deployment_packet_prepared"
  | "staging_deployed"
  | "staging_deployment_failed"
  | "production_readiness_recorded"
  | "production_deployment_packet_prepared"
  | "production_deployed"
  | "production_deployment_failed"
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
  prStatus: string | null;
  prProvider: string | null;
  prBaseBranch: string | null;
  prHeadBranch: string | null;
  prUrl: string | null;
  prNumber: string | null;
  prCreatedAt: string | null;
  prCreatedBy: string | null;
  prCreateReason: string | null;
  prEvidencePath: string | null;
  mergeReadinessStatus: string | null;
  mergeReadinessDecision: string | null;
  mergeReadinessReviewedAt: string | null;
  mergeReadinessReviewedBy: string | null;
  mergeReadinessReason: string | null;
  mergeReadinessEvidencePath: string | null;
  mergeStatus: string | null;
  mergeMethod: string | null;
  mergeCommitSha: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
  mergeReason: string | null;
  mergeEvidencePath: string | null;
  deployReadinessStatus: string | null;
  deployReadinessDecision: string | null;
  deployReadinessReviewedAt: string | null;
  deployReadinessReviewedBy: string | null;
  deployReadinessReason: string | null;
  deployReadinessEvidencePath: string | null;
  deploymentPacketStatus: string | null;
  deploymentTargetEnvironment: string | null;
  deploymentPacketPath: string | null;
  deploymentPlanPath: string | null;
  deploymentPacketCreatedAt: string | null;
  deploymentPacketCreatedBy: string | null;
  deploymentPacketReason: string | null;
  stagingDeploymentStatus: string | null;
  stagingDeploymentAdapter: string | null;
  stagingDeploymentStartedAt: string | null;
  stagingDeploymentFinishedAt: string | null;
  stagingDeploymentExitCode: number | null;
  stagingDeploymentEvidencePath: string | null;
  stagingDeployedBy: string | null;
  stagingDeployReason: string | null;
  productionReadinessStatus: string | null;
  productionReadinessDecision: string | null;
  productionReadinessReviewedAt: string | null;
  productionReadinessReviewedBy: string | null;
  productionReadinessReason: string | null;
  productionReadinessEvidencePath: string | null;
  productionDeploymentPacketStatus: string | null;
  productionDeploymentTargetEnvironment: string | null;
  productionDeploymentPacketPath: string | null;
  productionDeploymentPlanPath: string | null;
  productionDeploymentPacketCreatedAt: string | null;
  productionDeploymentPacketCreatedBy: string | null;
  productionDeploymentPacketReason: string | null;
  productionDeploymentRollbackNotes: string | null;
  productionDeploymentStatus: string | null;
  productionDeploymentAdapter: string | null;
  productionDeploymentStartedAt: string | null;
  productionDeploymentFinishedAt: string | null;
  productionDeploymentExitCode: number | null;
  productionDeploymentEvidencePath: string | null;
  productionDeployedBy: string | null;
  productionDeployReason: string | null;
  notCommitted: boolean;
  notPushed: boolean;
  notMerged: boolean;
  notDeployed: boolean;
  notComplete: boolean;
}
