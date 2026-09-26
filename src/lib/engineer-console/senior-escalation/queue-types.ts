import type { SeniorEscalationPackage, SeniorEscalationReason } from "./types";
import type {
  SeniorInvocationBlockedReason,
  SeniorInvocationGateDecision,
  SeniorInvocationResult,
  SeniorReviewResponse,
} from "./invoke-types";

export const SENIOR_REVIEW_QUEUE_V1_ID = "senior-review-queue-v1" as const;
export const SENIOR_REVIEW_QUEUE_WIRED_INTO_AE_LOOP = false;
export const SENIOR_REVIEW_REQUEST_CONFIRMATION = "REQUEST_SENIOR_REVIEW" as const;

export const SENIOR_REVIEW_QUEUE_STATUSES = [
  "not_requested",
  "package_ready",
  "blocked",
  "requested",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type SeniorReviewQueueStatus = (typeof SENIOR_REVIEW_QUEUE_STATUSES)[number];

export type SeniorReviewOperatorRequest = {
  requestedBy: string;
  requestedAt: string;
  confirmationText: string;
};

export type SeniorReviewQueueItem = {
  id: string;
  taskId: string | null;
  runId: string | null;
  status: SeniorReviewQueueStatus;
  packageSnapshot: SeniorEscalationPackage;
  escalationReasons: SeniorEscalationReason[];
  recommendedProfile: "deepseek-senior";
  gateDecision: SeniorInvocationGateDecision;
  invokable: boolean;
  operatorRequest: SeniorReviewOperatorRequest | null;
  invocationResult: SeniorInvocationResult | null;
  rawResponse: string | null;
  parsedReview: SeniorReviewResponse | null;
  blockedReasons: SeniorInvocationBlockedReason[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  advisoryOnly: true;
  humanGatesStillRequired: true;
};

export type SeniorReviewQueueSummary = {
  id: string;
  status: SeniorReviewQueueStatus;
  taskId: string | null;
  runId: string | null;
  objective: string;
  escalationReasons: SeniorEscalationReason[];
  recommendedProfile: "deepseek-senior";
  invokable: boolean;
  seniorEnabled: boolean;
  blockedReasons: SeniorInvocationBlockedReason[];
  warnings: string[];
  advisoryOnly: true;
  humanGatesStillRequired: true;
};

export type SeniorReviewQueueStore = {
  put(item: SeniorReviewQueueItem): void;
  get(id: string): SeniorReviewQueueItem | null;
  list(): SeniorReviewQueueItem[];
};

export type StageSeniorReviewPackageInput = {
  package: SeniorEscalationPackage;
  id?: string;
  env?: NodeJS.ProcessEnv;
  store?: SeniorReviewQueueStore;
  now?: () => string;
};

export type RequestSeniorReviewInput = {
  itemId?: string;
  item?: SeniorReviewQueueItem;
  package?: SeniorEscalationPackage;
  operatorRequested: boolean;
  operatorId: string;
  confirmationText: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  store?: SeniorReviewQueueStore;
  now?: () => string;
};
