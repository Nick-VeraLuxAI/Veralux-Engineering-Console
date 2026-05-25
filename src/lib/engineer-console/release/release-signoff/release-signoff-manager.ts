import type { ReleaseSignoffSnapshotV1 } from "./release-signoff-types";
import { createReleaseSignoff, type CreateReleaseSignoffInput } from "./create-release-signoff";
import {
  getLatestReleaseSignoffForRun,
  listReleaseSignoffsForRun,
} from "./list-release-signoffs";

export { createReleaseSignoff, type CreateReleaseSignoffInput };
export { listReleaseSignoffsForRun, getLatestReleaseSignoffForRun };
export { ReleaseSignoffError } from "./release-signoff-types";
export type { ReleaseSignoffRecord, ReleaseSignoffDecision } from "./release-signoff-types";

export function parseReleaseSignoffSnapshot(json: string): ReleaseSignoffSnapshotV1 {
  return JSON.parse(json) as ReleaseSignoffSnapshotV1;
}

export function toPublicReleaseSignoff(record: ReturnType<typeof listReleaseSignoffsForRun>[0]) {
  const snapshot = parseReleaseSignoffSnapshot(record.signoffSnapshotJson);
  return {
    id: record.id,
    runId: record.runId,
    decision: record.decision,
    releaseChecklistId: record.releaseChecklistId,
    releaseChecklistStatus: record.releaseChecklistStatus,
    actorLabel: record.actorLabel,
    rationale: record.rationale,
    evidenceBundleHashPrefix: record.evidenceBundleHash?.slice(0, 12) ?? null,
    auditChainHashPrefix: record.auditChainHash?.slice(0, 12) ?? null,
    createdAt: record.createdAt,
    snapshot: {
      taskTitle: snapshot.taskTitle,
      checklistItemSummaries: snapshot.checklistItemSummaries,
      latestDeploymentExecutionStatus: snapshot.latestDeploymentExecutionStatus,
      latestHealthPolicyStatus: snapshot.latestHealthPolicyStatus,
      latestReplayVerificationStatus: snapshot.latestReplayVerificationStatus,
      latestPolicyResultStatus: snapshot.latestPolicyResultStatus,
      reviewStageSummary: snapshot.reviewStageSummary,
      latestHumanDecision: snapshot.latestHumanDecision,
      signedOffAt: snapshot.signedOffAt,
    },
  };
}

export function summarizeReleaseSignoffForRun(runId: string): {
  signoffCount: number;
  latestDecision: string | null;
  latestChecklistStatus: string | null;
  latestActorLabel: string | null;
  latestCreatedAt: string | null;
} {
  const signoffs = listReleaseSignoffsForRun(runId);
  const latest = signoffs[0] ?? null;
  return {
    signoffCount: signoffs.length,
    latestDecision: latest?.decision ?? null,
    latestChecklistStatus: latest?.releaseChecklistStatus ?? null,
    latestActorLabel: latest?.actorLabel ?? null,
    latestCreatedAt: latest?.createdAt ?? null,
  };
}
