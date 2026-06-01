export const ENGINEERING_REVIEW_SIGNOFF_DECISIONS = [
  "approved",
  "needs_changes",
  "blocked",
  "rejected",
] as const;

export type EngineeringReviewSignoffDecision =
  (typeof ENGINEERING_REVIEW_SIGNOFF_DECISIONS)[number];

export interface EngineeringReviewSignoffRecord {
  id: string;
  runId: string;
  decision: EngineeringReviewSignoffDecision;
  reviewer: string;
  reason: string;
  evidenceSnapshotHash: string;
  evidenceSummaryJson: string;
  qualityGateSummaryJson: string;
  patchApplicationSummaryJson: string;
  createdAt: string;
}

export interface EngineeringReviewEvidenceSnapshotV1 {
  schemaVersion: "engineering-review-evidence-snapshot/v1";
  runId: string;
  capturedAt: string;
  hermesWorker: {
    available: boolean;
    patchProposal: unknown;
    patchApplication: unknown;
    postApplyQualityGates: unknown;
  };
  bridgeSummary: Record<string, unknown> | null;
}
