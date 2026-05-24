import { listDecisionRecords } from "../../governance/decision-records/decision-record-manager";
import { getEvidenceBundleForRun } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyEvaluationResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerificationResult } from "../../governance/replay-verification/replay-verification-manager";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
} from "../../governance/review-stages/review-stage-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { summarizeDeploymentExecutionsForRun } from "../deployment-execution/deployment-execution-manager";
import { getLatestDeploymentHealthPolicyResult } from "../deployment-health-policy/deployment-health-policy-manager";
import {
  getLatestReleaseChecklistForRun,
  parseReleaseChecklistEvaluation,
} from "../release-checklist/release-checklist-manager";
import type { ReleaseChecklistStatus } from "../release-checklist/release-checklist-types";
import {
  RELEASE_SIGNOFF_SNAPSHOT_VERSION,
  type ReleaseSignoffDecision,
  type ReleaseSignoffSnapshotV1,
} from "./release-signoff-types";
import { normalizeSignoffRationale } from "./validate-release-signoff-decision";

export interface BuildReleaseSignoffSnapshotInput {
  runId: string;
  decision: ReleaseSignoffDecision;
  rationale: string | null;
  signedOffAt: string;
  checklistId: string;
  checklistStatus: ReleaseChecklistStatus;
}

export function buildReleaseSignoffSnapshot(
  input: BuildReleaseSignoffSnapshotInput,
): ReleaseSignoffSnapshotV1 {
  const run = getRunById(input.runId);
  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }
  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found for run: ${input.runId}`);
  }

  const checklistRecord = getLatestReleaseChecklistForRun(input.runId);
  const checklistEval = checklistRecord
    ? parseReleaseChecklistEvaluation(checklistRecord)
    : null;

  const evidence = getEvidenceBundleForRun(input.runId);
  const deployExec = summarizeDeploymentExecutionsForRun(input.runId);
  const healthPolicy = getLatestDeploymentHealthPolicyResult(input.runId);
  const replay = getLatestReplayVerificationResult(input.runId);
  const policy = getLatestPolicyEvaluationResult(input.runId);
  const reviewStages = listReviewStagesForRun(input.runId);
  const reviewSummary =
    reviewStages.length > 0 ? summarizeReviewStages(reviewStages) : null;
  const decisions = listDecisionRecords(input.runId);
  const latestHumanDecision =
    [...decisions].reverse().find((d) => d.decision === "approved")?.decision ??
    decisions[decisions.length - 1]?.decision ??
    null;

  return {
    snapshotVersion: RELEASE_SIGNOFF_SNAPSHOT_VERSION,
    runId: input.runId,
    taskId: task.id,
    taskTitle: task.title.length > 500 ? `${task.title.slice(0, 500)}…` : task.title,
    releaseChecklistId: input.checklistId,
    releaseChecklistStatus: input.checklistStatus,
    checklistItemSummaries: (checklistEval?.items ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
    })),
    evidenceBundleId: evidence?.id ?? null,
    evidenceBundleHash: evidence?.bundleHash ?? null,
    latestDeploymentExecutionStatus: deployExec.latestStatus,
    latestHealthPolicyStatus: healthPolicy?.status ?? null,
    latestReplayVerificationStatus: replay?.status ?? null,
    latestPolicyResultStatus: policy?.status ?? null,
    reviewStageSummary: reviewSummary
      ? {
          requiredCount: reviewSummary.requiredCount,
          approvedCount: reviewSummary.approvedCount,
          pendingCount: reviewSummary.pendingCount,
          rejectedCount: reviewSummary.rejectedCount,
        }
      : null,
    latestHumanDecision,
    signoffDecision: input.decision,
    rationale: normalizeSignoffRationale(input.rationale),
    signedOffAt: input.signedOffAt,
  };
}
