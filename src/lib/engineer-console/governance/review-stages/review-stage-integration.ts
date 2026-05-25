import { refreshRunEvidenceBundle } from "../evidence-bundles/evidence-bundle-manager";
import type { WorkerPlanReportSummary } from "../../types";
import { reconcileReviewStagesForRun } from "./review-stage-manager";

export interface ReconcileReviewStagesAfterPolicyInput {
  changedFiles?: string[];
  diffSummary?: string;
  workerPlanSummary?: WorkerPlanReportSummary | null;
  skipEvidenceRefresh?: boolean;
}

export async function reconcileReviewStagesAfterPolicy(
  runId: string,
  input: ReconcileReviewStagesAfterPolicyInput = {},
): Promise<void> {
  reconcileReviewStagesForRun(runId, { audit: true });

  if (input.skipEvidenceRefresh) {
    return;
  }

  await refreshRunEvidenceBundle({
    runId,
    changedFiles: input.changedFiles,
    diffSummary: input.diffSummary,
    workerPlanSummary: input.workerPlanSummary,
  });
}
