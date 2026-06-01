import { getRunById } from "../../run-manager/run-manager";
import {
  auditEngineeringReviewSignoffCreated,
  auditEngineeringReviewSignoffRequested,
} from "../audit-ledger/engineering-review-signoff-audit-lifecycle";
import { buildEngineeringReviewEvidenceSnapshot } from "./build-engineering-review-evidence-snapshot";
import {
  getLatestEngineeringReviewSignoffForRun,
  insertEngineeringReviewSignoff,
} from "./engineering-review-signoff-manager";
import { hashEvidenceSnapshot } from "./hash-evidence-snapshot";
import {
  EngineeringReviewSignoffError,
  validateEngineeringReviewSignoffInput,
} from "./validate-engineering-review-signoff";

export { EngineeringReviewSignoffError } from "./validate-engineering-review-signoff";

export async function createEngineeringReviewSignoff(input: {
  runId: string;
  decision: string;
  reviewer: string;
  reason: string;
  qualityGateOverride?: boolean;
}): Promise<{
  runId: string;
  signoffId: string;
  decision: string;
  reviewer: string;
  createdAt: string;
  evidenceSnapshotHash: string;
  notMerge: true;
  notDeploy: true;
  notComplete: true;
}> {
  const validated = validateEngineeringReviewSignoffInput(input);
  const run = getRunById(validated.runId);
  if (!run) {
    throw new EngineeringReviewSignoffError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const snapshot = await buildEngineeringReviewEvidenceSnapshot(validated.runId);
  const evidenceSnapshotHash = hashEvidenceSnapshot(snapshot);
  const evidenceSummaryJson = JSON.stringify(snapshot);
  const qualityGateSummaryJson = JSON.stringify(
    validated.hermesSummary.postApplyQualityGates,
  );
  const patchApplicationSummaryJson = JSON.stringify(validated.hermesSummary.patchApplication);

  const pendingId = `pending-${Date.now()}`;
  auditEngineeringReviewSignoffRequested(
    validated.runId,
    run.taskId,
    pendingId,
    {
      decision: validated.decision,
      evidenceSnapshotHash,
      qualityGateOverride: validated.qualityGateOverride,
    },
    validated.reviewer,
  );

  const record = insertEngineeringReviewSignoff({
    runId: validated.runId,
    decision: validated.decision,
    reviewer: validated.reviewer,
    reason: validated.reason,
    evidenceSnapshotHash,
    evidenceSummaryJson,
    qualityGateSummaryJson,
    patchApplicationSummaryJson,
  });

  auditEngineeringReviewSignoffCreated(
    validated.runId,
    run.taskId,
    record.id,
    validated.decision,
    {
      decision: validated.decision,
      reviewer: validated.reviewer,
      reason: validated.reason,
      evidenceSnapshotHash,
      qualityGateOverride: validated.qualityGateOverride,
    },
    validated.reviewer,
  );

  return {
    runId: validated.runId,
    signoffId: record.id,
    decision: record.decision,
    reviewer: record.reviewer,
    createdAt: record.createdAt,
    evidenceSnapshotHash: record.evidenceSnapshotHash,
    notMerge: true,
    notDeploy: true,
    notComplete: true,
  };
}

export function summarizeLatestEngineeringReviewSignoff(runId: string): {
  latestReviewSignoff: {
    signoffId: string | null;
    reviewDecision: string | null;
    reviewedAt: string | null;
    reviewer: string | null;
    reason: string | null;
    evidenceSnapshotHash: string | null;
    notMerge: true;
    notDeploy: true;
  };
} {
  const latest = getLatestEngineeringReviewSignoffForRun(runId);
  if (!latest) {
    return {
      latestReviewSignoff: {
        signoffId: null,
        reviewDecision: null,
        reviewedAt: null,
        reviewer: null,
        reason: null,
        evidenceSnapshotHash: null,
        notMerge: true,
        notDeploy: true,
      },
    };
  }
  return {
    latestReviewSignoff: {
      signoffId: latest.id,
      reviewDecision: latest.decision,
      reviewedAt: latest.createdAt,
      reviewer: latest.reviewer,
      reason: latest.reason,
      evidenceSnapshotHash: latest.evidenceSnapshotHash,
      notMerge: true,
      notDeploy: true,
    },
  };
}
