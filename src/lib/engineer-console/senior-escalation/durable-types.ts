import type { SeniorEscalationPackage } from "./types";
import type { SeniorInvocationBlockedReason, SeniorReviewResponse } from "./invoke-types";
import type { SeniorReviewQueueStatus } from "./queue-types";

export const SENIOR_REVIEW_DURABLE_EVIDENCE_V1_ID = "senior-review-durable-evidence-v1" as const;
export const SENIOR_REVIEW_DURABLE_SCHEMA_VERSION = 1 as const;
export const SENIOR_REVIEW_DURABLE_MAX_ATTEMPTS = 20;
export const SENIOR_REVIEW_DURABLE_WIRED_INTO_AE_LOOP = false;

export type DurableSeniorReviewAttemptStatus = "blocked" | "succeeded" | "failed";

export type DurableSeniorReviewGateStatus = {
  allowed: boolean;
  seniorEnabled: boolean;
  reasonCodes: SeniorInvocationBlockedReason[];
};

export type DurableSeniorReviewStagedPackage = {
  stagedAt: string;
  packageId: string;
  packageSnapshot: SeniorEscalationPackage;
  gateStatus: DurableSeniorReviewGateStatus;
  blockedReasons: SeniorInvocationBlockedReason[];
  blockedReasonLabels: string[];
};

export type DurableSeniorReviewAttempt = {
  attemptId: string;
  itemId: string;
  requestedAt: string;
  requestedBy?: string;
  confirmationAccepted: boolean;
  status: DurableSeniorReviewAttemptStatus;
  blockedReasons?: SeniorInvocationBlockedReason[];
  blockedReasonLabels?: string[];
  rawResponse?: string;
  parsedReview?: SeniorReviewResponse | null;
  warnings?: string[];
  usage?: unknown;
  timingMs?: number;
  advisoryOnly: true;
  humanGatesStillRequired: true;
};

export type DurableSeniorReviewState = {
  schemaVersion: typeof SENIOR_REVIEW_DURABLE_SCHEMA_VERSION;
  advisoryOnly: true;
  humanGatesStillRequired: true;
  latestItemId?: string;
  latestStatus?: SeniorReviewQueueStatus;
  stagedPackage?: DurableSeniorReviewStagedPackage;
  attempts: DurableSeniorReviewAttempt[];
  updatedAt: string;
};

export type EvidenceSeniorReviewSummary = {
  schemaVersion: typeof SENIOR_REVIEW_DURABLE_SCHEMA_VERSION;
  advisoryOnly: true;
  humanGatesStillRequired: true;
  status: SeniorReviewQueueStatus | null;
  statusLabel: string;
  attemptedAt: string | null;
  requestedBy: string | null;
  confirmationAccepted: boolean | null;
  blockedReasonLabels: string[];
  hasParsedReview: boolean;
  rootCausePreview: string | null;
  nextWorkerMissionPreview: string | null;
  escalationReasons: string[];
  qcGates: string[];
  riskLabels: string[];
  warnings: string[];
  updatedAt: string;
  attemptCount: number;
};
