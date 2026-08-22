import type { SeniorInvocationBlockedReason } from "./invoke-types";
import { SENIOR_REVIEW_REQUEST_CONFIRMATION, type SeniorReviewQueueItem } from "./queue-types";

export const SENIOR_REVIEW_PANEL_V1_ID = "senior-review-run-detail-panel-v1" as const;
export const SENIOR_REVIEW_PANEL_WIRED_INTO_AE_LOOP = false;

export type SeniorAvailabilityLabel =
  | "not_enabled"
  | "not_configured"
  | "unavailable"
  | "ready_if_requested"
  | "advisory_complete"
  | "failed"
  | "not_recommended";

export type SeniorReviewPanelView = {
  runId: string | null;
  taskId: string | null;
  queueItemId: string | null;
  status: SeniorReviewQueueItem["status"];
  statusLabel: string;
  objective: string | null;
  escalationReasons: string[];
  invokable: boolean;
  canRequest: boolean;
  blockedReasonLabels: string[];
  seniorAvailability: SeniorAvailabilityLabel;
  confirmationRequired: typeof SENIOR_REVIEW_REQUEST_CONFIRMATION;
  advisoryOnly: true;
  humanGatesStillRequired: true;
  nextHumanGate: string;
  parsedReview: {
    rootCause: string;
    symptomPatchVsRealFix: string;
    nextWorkerMission: string;
    recommendedWorkerProfile: string;
    qcGates: string[];
    missingEvidence: string[];
  } | null;
  rawResponsePreview: string | null;
  warnings: string[];
};

const BLOCKED_REASON_LABELS: Record<SeniorInvocationBlockedReason, string> = {
  package_missing: "A senior review package is not available.",
  escalation_not_recommended: "Escalation is not recommended for this run.",
  profile_not_deepseek_senior: "Recommended senior profile is not the on-demand senior model.",
  operator_approval_missing: "An operator has not requested senior review yet.",
  senior_config_disabled: "Senior review is not enabled.",
  senior_base_url_not_explicit: "Senior endpoint is not configured.",
  senior_model_not_explicit: "Senior model is not configured.",
  senior_url_not_localhost: "Senior endpoint is not a local endpoint.",
  senior_url_is_nano_worker: "Senior endpoint must not be the Nano worker.",
  senior_model_mismatch: "Senior model is not the approved on-demand model.",
  requires_manual_serve_violated: "Senior review requires a manual local serve.",
  auto_serve_not_false: "Automatic senior serve is not allowed.",
  concurrent_with_nano_not_false: "Senior review cannot run concurrently with Nano.",
  auto_call_not_manual: "Senior review is operator-requested only.",
  package_already_invoked: "This package already recorded a live senior call.",
  senior_endpoint_unavailable: "Senior endpoint is not available.",
};

const STATUS_LABELS: Record<SeniorReviewQueueItem["status"], string> = {
  not_requested: "Not requested",
  package_ready: "Package ready — operator request required",
  blocked: "Blocked",
  requested: "Request in progress",
  succeeded: "Advisory review stored",
  failed: "Senior call failed",
  cancelled: "Cancelled",
};

function availabilityFor(item: SeniorReviewQueueItem): SeniorAvailabilityLabel {
  if (item.status === "succeeded") return "advisory_complete";
  if (item.status === "failed") return "failed";
  if (item.blockedReasons.includes("escalation_not_recommended")) return "not_recommended";
  if (item.blockedReasons.includes("senior_config_disabled")) return "not_enabled";
  if (
    item.blockedReasons.includes("senior_base_url_not_explicit")
    || item.blockedReasons.includes("senior_model_not_explicit")
  ) {
    return "not_configured";
  }
  if (item.blockedReasons.includes("senior_endpoint_unavailable")) return "unavailable";
  if (item.invokable) return "ready_if_requested";
  return "not_configured";
}

export function blockedReasonLabel(reason: SeniorInvocationBlockedReason): string {
  return BLOCKED_REASON_LABELS[reason];
}

export function toSeniorReviewPanelView(item: SeniorReviewQueueItem): SeniorReviewPanelView {
  const canRequest = item.invokable && item.status !== "succeeded" && item.status !== "cancelled";
  return {
    runId: item.runId,
    taskId: item.taskId,
    queueItemId: item.id,
    status: item.status,
    statusLabel: STATUS_LABELS[item.status],
    objective: item.packageSnapshot.objective,
    escalationReasons: item.escalationReasons,
    invokable: item.invokable,
    canRequest,
    blockedReasonLabels: item.blockedReasons.map(blockedReasonLabel),
    seniorAvailability: availabilityFor(item),
    confirmationRequired: SENIOR_REVIEW_REQUEST_CONFIRMATION,
    advisoryOnly: true,
    humanGatesStillRequired: true,
    nextHumanGate: "Authorize PR / inspect evidence — senior output cannot approve, merge, or deploy.",
    parsedReview: item.parsedReview
      ? {
        rootCause: item.parsedReview.rootCause,
        symptomPatchVsRealFix: item.parsedReview.symptomPatchVsRealFix,
        nextWorkerMission: item.parsedReview.nextWorkerMission,
        recommendedWorkerProfile: item.parsedReview.recommendedWorkerProfile,
        qcGates: item.parsedReview.qcGates,
        missingEvidence: item.parsedReview.missingEvidence,
      }
      : null,
    rawResponsePreview: item.rawResponse ? item.rawResponse.slice(0, 2000) : null,
    warnings: item.warnings,
  };
}

export function seniorReviewStatusLabel(
  status: SeniorReviewQueueItem["status"],
): string {
  return STATUS_LABELS[status];
}

export function viewContainsUnsafeConfigLeak(view: SeniorReviewPanelView): boolean {
  return /127\.0\.0\.1:1919|:8081|:8082|ENGINEER_CONSOLE_SENIOR|\/mnt\/model-storage/i.test(
    JSON.stringify(view),
  );
}
