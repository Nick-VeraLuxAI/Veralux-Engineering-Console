import path from "path";
import { getLatestEngineeringReviewSignoffForRun } from "../engineering-review-signoff/engineering-review-signoff-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../../repo-intelligence/task-repo-path";
import { validateRegistrationPath } from "../../repo-intelligence/registered-repos/repo-path-policy";
import { getLatestHermesDispatchForRun } from "../../hermes-worker/hermes-dispatch-manager";
import { getHermesPatchApplicationForRun } from "../../hermes-worker/hermes-patch-application-manager";
import { resolveHermesEvidenceDirectory } from "../../hermes-worker/read-hermes-patch-proposal";
import { listHermesQualityGateRunsForRun } from "../../hermes-worker/hermes-quality-gate-run-manager";
import { ingestHermesWorkerEvidenceForRun } from "../../hermes-worker/hermes-evidence-ingest";
import { HERMES_GLOBAL_FORBIDDEN_PATHS, normalizeHermesPath } from "../../hermes-worker/hermes-policy";
import type { HermesWorkerEvidenceSummary } from "../../hermes-worker/hermes-evidence-types";

function qualityGatesSatisfiedForApproval(
  summary: HermesWorkerEvidenceSummary["postApplyQualityGates"],
): boolean {
  if (summary.status !== "completed") return false;
  if (summary.overallStatus === "passed") return true;
  return summary.failedCount === 0 && summary.passedCount > 0;
}
import { getLatestWorkerPlanForRun } from "../../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";
import { getChangedFiles } from "../../workspace/git-workspace";
import { normalizeRelativePath } from "../../worker-plan/path-safety";
import {
  recommendCommitCandidateBranchName,
  validateCommitCandidateBranchName,
} from "./branch-name";
import { validateCommitCandidateMessage } from "./validate-commit-message";
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import type { EngineeringReviewSignoffRecord } from "../engineering-review-signoff/engineering-review-signoff-types";
import type { HermesPatchApplicationRecord } from "../../hermes-worker/hermes-patch-application-manager";

export class CommitCandidateError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "CommitCandidateError";
    this.code = code;
    this.status = status;
  }
}

function pathIsForbidden(relativePath: string): boolean {
  const file = normalizeHermesPath(relativePath);
  for (const forbidden of HERMES_GLOBAL_FORBIDDEN_PATHS) {
    const f = normalizeHermesPath(forbidden);
    if (file === f || file.startsWith(`${f}/`)) return true;
  }
  return false;
}

export interface ValidatedCommitCandidateContext {
  runId: string;
  taskId: string;
  repoPath: string;
  branchName: string;
  commitMessage: string;
  changedFiles: string[];
  signoff: EngineeringReviewSignoffRecord;
  patchApplication: HermesPatchApplicationRecord;
  evidenceSnapshotHash: string;
  qualityGateSummary: unknown;
  patchApplicationSummary: unknown;
  rollbackAvailable: boolean;
  evidenceDirectory: string;
  createdBy: string;
  createdReason: string;
}

export async function validateCommitCandidateForRun(input: {
  runId: string;
  commitMessage: string;
  operatorApproval: { approved: boolean; approvedBy: string; reason: string };
  qualityGateOverride?: boolean;
}): Promise<ValidatedCommitCandidateContext> {
  if (!input.operatorApproval.approved) {
    throw new CommitCandidateError("Operator approval is required", "APPROVAL_REQUIRED");
  }
  const createdBy = input.operatorApproval.approvedBy?.trim();
  if (!createdBy) {
    throw new CommitCandidateError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }
  const createdReason = input.operatorApproval.reason?.trim();
  if (!createdReason) {
    throw new CommitCandidateError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new CommitCandidateError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const signoff = getLatestEngineeringReviewSignoffForRun(run.id);
  if (!signoff || signoff.decision !== "approved") {
    throw new CommitCandidateError(
      "Latest engineering review sign-off must be approved",
      "SIGNOFF_NOT_APPROVED",
    );
  }
  if (!signoff.evidenceSnapshotHash) {
    throw new CommitCandidateError("Sign-off evidence snapshot hash is missing", "EVIDENCE_HASH_MISSING");
  }

  const patchApplication = getHermesPatchApplicationForRun(run.id);
  if (!patchApplication) {
    throw new CommitCandidateError("Hermes patch application is required", "PATCH_NOT_APPLIED");
  }
  if (patchApplication.status === "rolled_back") {
    throw new CommitCandidateError("Cannot prepare commit candidate after patch rollback", "PATCH_ROLLED_BACK");
  }
  if (patchApplication.status !== "applied") {
    throw new CommitCandidateError("Patch must be in applied state", "PATCH_NOT_APPLIED");
  }

  const hermes = ingestHermesWorkerEvidenceForRun(run.id).summary;
  const gates = hermes.postApplyQualityGates;
  if (!qualityGatesSatisfiedForApproval(gates) && !input.qualityGateOverride) {
    if (gates.status !== "completed") {
      throw new CommitCandidateError(
        "Post-apply quality gates must be run before commit candidate preparation",
        "QUALITY_GATES_NOT_RUN",
      );
    }
    throw new CommitCandidateError(
      "Quality gates must pass or qualityGateOverride must be true",
      "QUALITY_GATES_OVERRIDE_REQUIRED",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new CommitCandidateError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new CommitCandidateError(message, "REPO_POLICY_VIOLATION");
  }

  const workerPlanRecord = getLatestWorkerPlanForRun(run.id);
  if (!workerPlanRecord || workerPlanRecord.validationStatus !== "valid") {
    throw new CommitCandidateError("Valid worker plan is required", "WORKER_PLAN_INVALID");
  }
  const plan = JSON.parse(workerPlanRecord.planJson) as WorkerPlan;
  const allowedSet = new Set(plan.allowedFiles.map((p) => normalizeRelativePath(p)));

  const patchFiles = (JSON.parse(patchApplication.changedFilesJson) as string[]).map((p) =>
    normalizeRelativePath(p),
  );
  const patchSet = new Set(patchFiles);

  const treeFiles = await getChangedFiles(repoPath, { workerPlanPaths: plan.allowedFiles });

  for (const file of treeFiles) {
    const normalized = normalizeRelativePath(file);
    if (!allowedSet.has(normalized)) {
      throw new CommitCandidateError(`File out of worker plan scope: ${file}`, "FILE_OUT_OF_SCOPE");
    }
    if (pathIsForbidden(normalized)) {
      throw new CommitCandidateError(`Forbidden path modified: ${file}`, "FORBIDDEN_PATH");
    }
    if (!patchSet.has(normalized)) {
      throw new CommitCandidateError(`Unrelated working tree file: ${file}`, "UNRELATED_FILE");
    }
  }

  for (const file of patchFiles) {
    if (!treeFiles.map((f) => normalizeRelativePath(f)).includes(file)) {
      throw new CommitCandidateError(
        `Patch file missing from working tree: ${file}`,
        "PATCH_FILE_MISSING",
      );
    }
  }

  const changedFiles = [...patchFiles].sort();
  if (changedFiles.length === 0) {
    throw new CommitCandidateError("No changed files to include in commit candidate", "NO_CHANGED_FILES");
  }

  let commitMessage: string;
  try {
    commitMessage = validateCommitCandidateMessage(input.commitMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid commit message";
    throw new CommitCandidateError(message, "INVALID_COMMIT_MESSAGE");
  }

  const branchName = recommendCommitCandidateBranchName(run.id, task.title);
  try {
    validateCommitCandidateBranchName(branchName);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid branch name";
    throw new CommitCandidateError(message, "INVALID_BRANCH_NAME");
  }

  const dispatch = getLatestHermesDispatchForRun(run.id);
  const evidenceDirectory = dispatch
    ? resolveHermesEvidenceDirectory(dispatch)
    : path.join(repoPath, ".engineering-console-evidence", run.id);

  return {
    runId: run.id,
    taskId: run.taskId,
    repoPath,
    branchName,
    commitMessage,
    changedFiles,
    signoff,
    patchApplication,
    evidenceSnapshotHash: signoff.evidenceSnapshotHash,
    qualityGateSummary: JSON.parse(signoff.qualityGateSummaryJson),
    patchApplicationSummary: JSON.parse(signoff.patchApplicationSummaryJson),
    rollbackAvailable: Boolean(patchApplication.rollbackArtifactPath),
    evidenceDirectory,
    createdBy,
    createdReason,
  };
}

export function collectTestEvidencePaths(runId: string): string[] {
  return listHermesQualityGateRunsForRun(runId)
    .filter((row) => row.status !== "skipped")
    .map((row) => row.resultArtifactPath);
}

export function summarizeLatestCommitCandidateForBridge(runId: string): {
  latestCommitCandidate: {
    candidateId: string | null;
    commitCandidateStatus: string | null;
    branchName: string | null;
    commitMessage: string | null;
    changedFiles: string[];
    commitPacketPath: string | null;
    prDraftPath: string | null;
    createdAt: string | null;
    createdBy: string | null;
    evidenceSnapshotHash: string | null;
    notCommitted: boolean;
    notPushed: boolean;
    notMerged: true;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  if (!latest) {
    return {
      latestCommitCandidate: {
        candidateId: null,
        commitCandidateStatus: null,
        branchName: null,
        commitMessage: null,
        changedFiles: [],
        commitPacketPath: null,
        prDraftPath: null,
        createdAt: null,
        createdBy: null,
        evidenceSnapshotHash: null,
        notCommitted: true,
        notPushed: true,
        notMerged: true,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestCommitCandidate: {
      candidateId: latest.id,
      commitCandidateStatus: latest.status,
      branchName: latest.branchName,
      commitMessage: latest.commitMessage,
      changedFiles: JSON.parse(latest.changedFilesJson) as string[],
      commitPacketPath: latest.commitPacketPath,
      prDraftPath: latest.prDraftPath,
      createdAt: latest.createdAt,
      createdBy: latest.createdBy,
      evidenceSnapshotHash: latest.evidenceSnapshotHash,
      notCommitted: latest.notCommitted,
      notPushed: latest.notPushed,
      notMerged: true,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestLocalCommitForBridge(runId: string): {
  latestLocalCommit: {
    candidateId: string | null;
    localCommitStatus: string | null;
    localCommitHash: string | null;
    localCommitCreatedAt: string | null;
    localCommitCreatedBy: string | null;
    localCommitEvidencePath: string | null;
    notPushed: boolean;
    notPrCreated: true;
    notMerged: true;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasLocalCommit =
    latest &&
    (latest.status === "local_commit_created" || latest.status === "remote_branch_pushed") &&
    latest.localCommitHash;
  if (!hasLocalCommit) {
    return {
      latestLocalCommit: {
        candidateId: latest?.id ?? null,
        localCommitStatus: latest?.status ?? null,
        localCommitHash: null,
        localCommitCreatedAt: null,
        localCommitCreatedBy: null,
        localCommitEvidencePath: null,
        notPushed: latest?.notPushed ?? true,
        notPrCreated: true,
        notMerged: true,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestLocalCommit: {
      candidateId: latest.id,
      localCommitStatus: latest.status,
      localCommitHash: latest.localCommitHash,
      localCommitCreatedAt: latest.localCommitCreatedAt,
      localCommitCreatedBy: latest.localCommitCreatedBy,
      localCommitEvidencePath: latest.localCommitEvidencePath,
      notPushed: latest.notPushed,
      notPrCreated: true,
      notMerged: true,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestRemoteBranchPushForBridge(runId: string): {
  latestRemoteBranchPush: {
    candidateId: string | null;
    remotePushStatus: string | null;
    remoteName: string | null;
    remoteBranchName: string | null;
    remoteRef: string | null;
    remotePushedAt: string | null;
    remotePushedBy: string | null;
    remotePushEvidencePath: string | null;
    notPrCreated: boolean;
    notMerged: true;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasRemotePush =
    latest &&
    (latest.status === "remote_branch_pushed" ||
      latest.status === "pull_request_created" ||
      latest.status === "pull_request_packet_prepared") &&
    latest.remoteRef;
  if (!hasRemotePush) {
    return {
      latestRemoteBranchPush: {
        candidateId: latest?.id ?? null,
        remotePushStatus: latest?.remotePushStatus ?? null,
        remoteName: null,
        remoteBranchName: null,
        remoteRef: null,
        remotePushedAt: null,
        remotePushedBy: null,
        remotePushEvidencePath: null,
        notPrCreated: true,
        notMerged: true,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestRemoteBranchPush: {
      candidateId: latest.id,
      remotePushStatus: latest.remotePushStatus,
      remoteName: latest.remoteName,
      remoteBranchName: latest.remoteBranchName,
      remoteRef: latest.remoteRef,
      remotePushedAt: latest.remotePushedAt,
      remotePushedBy: latest.remotePushedBy,
      remotePushEvidencePath: latest.remotePushEvidencePath,
      notPrCreated: !(latest.prUrl || latest.status === "pull_request_created"),
      notMerged: true,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestPullRequestForBridge(runId: string): {
  latestPullRequest: {
    candidateId: string | null;
    pullRequestStatus: string | null;
    prProvider: string | null;
    prUrl: string | null;
    prNumber: string | null;
    prBaseBranch: string | null;
    prHeadBranch: string | null;
    prCreatedAt: string | null;
    prCreatedBy: string | null;
    prEvidencePath: string | null;
    notMerged: true;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasPr =
    latest &&
    (latest.status === "pull_request_created" ||
      latest.status === "pull_request_packet_prepared" ||
      latest.status === "merge_readiness_recorded");
  if (!hasPr) {
    return {
      latestPullRequest: {
        candidateId: latest?.id ?? null,
        pullRequestStatus: latest?.prStatus ?? null,
        prProvider: null,
        prUrl: null,
        prNumber: null,
        prBaseBranch: null,
        prHeadBranch: null,
        prCreatedAt: null,
        prCreatedBy: null,
        prEvidencePath: null,
        notMerged: true,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestPullRequest: {
      candidateId: latest.id,
      pullRequestStatus: latest.prStatus,
      prProvider: latest.prProvider,
      prUrl: latest.prUrl,
      prNumber: latest.prNumber,
      prBaseBranch: latest.prBaseBranch,
      prHeadBranch: latest.prHeadBranch,
      prCreatedAt: latest.prCreatedAt,
      prCreatedBy: latest.prCreatedBy,
      prEvidencePath: latest.prEvidencePath,
      notMerged: true,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestMergeReadinessForBridge(runId: string): {
  latestMergeReadiness: {
    candidateId: string | null;
    mergeReadinessStatus: string | null;
    mergeReadinessDecision: string | null;
    mergeReadinessReviewedAt: string | null;
    mergeReadinessReviewedBy: string | null;
    mergeReadinessEvidencePath: string | null;
    notMerged: true;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasReadiness =
    latest &&
    (latest.status === "merge_readiness_recorded" ||
      latest.mergeReadinessStatus === "merge_readiness_recorded");
  if (!hasReadiness) {
    return {
      latestMergeReadiness: {
        candidateId: latest?.id ?? null,
        mergeReadinessStatus: latest?.mergeReadinessStatus ?? null,
        mergeReadinessDecision: null,
        mergeReadinessReviewedAt: null,
        mergeReadinessReviewedBy: null,
        mergeReadinessEvidencePath: null,
        notMerged: true,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestMergeReadiness: {
      candidateId: latest.id,
      mergeReadinessStatus: latest.mergeReadinessStatus,
      mergeReadinessDecision: latest.mergeReadinessDecision,
      mergeReadinessReviewedAt: latest.mergeReadinessReviewedAt,
      mergeReadinessReviewedBy: latest.mergeReadinessReviewedBy,
      mergeReadinessEvidencePath: latest.mergeReadinessEvidencePath,
      notMerged: true,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestPullRequestMergeForBridge(runId: string): {
  latestPullRequestMerge: {
    candidateId: string | null;
    mergeStatus: string | null;
    mergeMethod: string | null;
    mergeCommitSha: string | null;
    mergedAt: string | null;
    mergedBy: string | null;
    mergeEvidencePath: string | null;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasMerge =
    latest &&
    (latest.status === "pull_request_merged" || latest.mergeStatus === "pull_request_merged");
  if (!hasMerge) {
    return {
      latestPullRequestMerge: {
        candidateId: latest?.id ?? null,
        mergeStatus: latest?.mergeStatus ?? null,
        mergeMethod: null,
        mergeCommitSha: null,
        mergedAt: null,
        mergedBy: null,
        mergeEvidencePath: null,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestPullRequestMerge: {
      candidateId: latest.id,
      mergeStatus: latest.mergeStatus,
      mergeMethod: latest.mergeMethod,
      mergeCommitSha: latest.mergeCommitSha,
      mergedAt: latest.mergedAt,
      mergedBy: latest.mergedBy,
      mergeEvidencePath: latest.mergeEvidencePath,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestDeployReadinessForBridge(runId: string): {
  latestDeployReadiness: {
    candidateId: string | null;
    deployReadinessStatus: string | null;
    deployReadinessDecision: string | null;
    deployReadinessReviewedAt: string | null;
    deployReadinessReviewedBy: string | null;
    deployReadinessEvidencePath: string | null;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasDeployReadiness =
    latest &&
    (latest.status === "deploy_readiness_recorded" ||
      latest.deployReadinessStatus === "deploy_readiness_recorded");
  if (!hasDeployReadiness) {
    return {
      latestDeployReadiness: {
        candidateId: latest?.id ?? null,
        deployReadinessStatus: latest?.deployReadinessStatus ?? null,
        deployReadinessDecision: null,
        deployReadinessReviewedAt: null,
        deployReadinessReviewedBy: null,
        deployReadinessEvidencePath: null,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestDeployReadiness: {
      candidateId: latest.id,
      deployReadinessStatus: latest.deployReadinessStatus,
      deployReadinessDecision: latest.deployReadinessDecision,
      deployReadinessReviewedAt: latest.deployReadinessReviewedAt,
      deployReadinessReviewedBy: latest.deployReadinessReviewedBy,
      deployReadinessEvidencePath: latest.deployReadinessEvidencePath,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestDeploymentPacketForBridge(runId: string): {
  latestDeploymentPacket: {
    candidateId: string | null;
    deploymentPacketStatus: string | null;
    deploymentTargetEnvironment: string | null;
    deploymentPacketPath: string | null;
    deploymentPlanPath: string | null;
    deploymentPacketCreatedAt: string | null;
    deploymentPacketCreatedBy: string | null;
    notDeployed: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasDeploymentPacket =
    latest &&
    (latest.status === "deployment_packet_prepared" ||
      latest.deploymentPacketStatus === "deployment_packet_prepared");
  if (!hasDeploymentPacket) {
    return {
      latestDeploymentPacket: {
        candidateId: latest?.id ?? null,
        deploymentPacketStatus: latest?.deploymentPacketStatus ?? null,
        deploymentTargetEnvironment: null,
        deploymentPacketPath: null,
        deploymentPlanPath: null,
        deploymentPacketCreatedAt: null,
        deploymentPacketCreatedBy: null,
        notDeployed: true,
        notComplete: true,
      },
    };
  }
  return {
    latestDeploymentPacket: {
      candidateId: latest.id,
      deploymentPacketStatus: latest.deploymentPacketStatus,
      deploymentTargetEnvironment: latest.deploymentTargetEnvironment,
      deploymentPacketPath: latest.deploymentPacketPath,
      deploymentPlanPath: latest.deploymentPlanPath,
      deploymentPacketCreatedAt: latest.deploymentPacketCreatedAt,
      deploymentPacketCreatedBy: latest.deploymentPacketCreatedBy,
      notDeployed: true,
      notComplete: true,
    },
  };
}

export function summarizeLatestStagingDeploymentForBridge(runId: string): {
  latestStagingDeployment: {
    candidateId: string | null;
    stagingDeploymentStatus: string | null;
    stagingDeploymentAdapter: string | null;
    stagingDeploymentStartedAt: string | null;
    stagingDeploymentFinishedAt: string | null;
    stagingDeploymentExitCode: number | null;
    stagingDeploymentEvidencePath: string | null;
    stagingDeployedBy: string | null;
    notProduction: true;
    notComplete: true;
  };
} {
  const latest = getLatestCommitCandidateForRun(runId);
  const hasStagingDeployment =
    latest &&
    (latest.status === "staging_deployed" ||
      latest.status === "staging_deployment_failed" ||
      latest.stagingDeploymentStatus === "staging_deployed" ||
      latest.stagingDeploymentStatus === "staging_deployment_failed");
  if (!hasStagingDeployment) {
    return {
      latestStagingDeployment: {
        candidateId: latest?.id ?? null,
        stagingDeploymentStatus: latest?.stagingDeploymentStatus ?? null,
        stagingDeploymentAdapter: null,
        stagingDeploymentStartedAt: null,
        stagingDeploymentFinishedAt: null,
        stagingDeploymentExitCode: null,
        stagingDeploymentEvidencePath: null,
        stagingDeployedBy: null,
        notProduction: true,
        notComplete: true,
      },
    };
  }
  return {
    latestStagingDeployment: {
      candidateId: latest.id,
      stagingDeploymentStatus: latest.stagingDeploymentStatus,
      stagingDeploymentAdapter: latest.stagingDeploymentAdapter,
      stagingDeploymentStartedAt: latest.stagingDeploymentStartedAt,
      stagingDeploymentFinishedAt: latest.stagingDeploymentFinishedAt,
      stagingDeploymentExitCode: latest.stagingDeploymentExitCode,
      stagingDeploymentEvidencePath: latest.stagingDeploymentEvidencePath,
      stagingDeployedBy: latest.stagingDeployedBy,
      notProduction: true,
      notComplete: true,
    },
  };
}
