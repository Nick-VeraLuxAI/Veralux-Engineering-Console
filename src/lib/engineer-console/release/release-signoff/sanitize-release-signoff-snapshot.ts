import { redactDeploymentOutput } from "../deployment-execution/redact-deployment-output";
import type { ReleaseSignoffSnapshotV1 } from "./release-signoff-types";

export function redactReleaseSignoffSnapshot(
  snapshot: ReleaseSignoffSnapshotV1,
): ReleaseSignoffSnapshotV1 {
  return {
    ...snapshot,
    taskTitle: redactDeploymentOutput(snapshot.taskTitle),
    rationale: snapshot.rationale ? redactDeploymentOutput(snapshot.rationale) : null,
    checklistItemSummaries: snapshot.checklistItemSummaries.map((item) => ({
      ...item,
      label: redactDeploymentOutput(item.label),
    })),
  };
}
