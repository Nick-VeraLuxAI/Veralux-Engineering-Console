import { buildRunEvidenceSummaryForBridge } from "../../bridge/run-evidence-summary";
import { ingestHermesWorkerEvidenceForRun } from "../../hermes-worker/hermes-evidence-ingest";
import type { EngineeringReviewEvidenceSnapshotV1 } from "./engineering-review-signoff-types";

export async function buildEngineeringReviewEvidenceSnapshot(
  runId: string,
): Promise<EngineeringReviewEvidenceSnapshotV1> {
  const hermes = ingestHermesWorkerEvidenceForRun(runId);
  const bridgeSummary = await buildRunEvidenceSummaryForBridge(runId);

  return {
    schemaVersion: "engineering-review-evidence-snapshot/v1",
    runId,
    capturedAt: new Date().toISOString(),
    hermesWorker: {
      available: hermes.summary.available,
      patchProposal: hermes.summary.patchProposal,
      patchApplication: hermes.summary.patchApplication,
      postApplyQualityGates: hermes.summary.postApplyQualityGates,
    },
    bridgeSummary: bridgeSummary
      ? {
          runId: bridgeSummary.runId,
          currentStatus: bridgeSummary.currentStatus,
          testStatus: bridgeSummary.testStatus,
          buildStatus: bridgeSummary.buildStatus,
          hermesPatchProposal: bridgeSummary.hermesPatchProposal,
          hermesPatchApplication: bridgeSummary.hermesPatchApplication,
          hermesPostApplyQualityGates: bridgeSummary.hermesPostApplyQualityGates,
        }
      : null,
  };
}
