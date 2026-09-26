/** Explicit fallback policy — disabled by default; never disguises worker identity. */

import type { SeniorBlockReason, SeniorCorrelationRecord } from "./types";

const ELIGIBLE_BEFORE_SUBMISSION = new Set<string>([
  "senior_service_unavailable_before_submission",
  "senior_service_not_ready",
  "senior_queue_capacity_reached",
  "senior_request_blocked_before_execution",
  "senior_route_disabled",
]);

const INELIGIBLE = new Set<string>([
  "senior_result_ambiguous",
  "senior_status_unknown",
  "senior_recovery_required",
  "senior_cancelled",
  "senior_execution_approval_mismatch",
  "senior_execution_approval_missing",
  "senior_nano_restore_failed",
  "senior_failed",
]);

export type FallbackDecision = {
  allowed: boolean;
  reason: string;
  fallbackWorker: string | null;
};

export function evaluateSeniorFallback(input: {
  record: Pick<SeniorCorrelationRecord, "allowFallback" | "s13RequestId" | "result" | "state">;
  failureCode: SeniorBlockReason | string;
  defaultWorker?: string;
}): FallbackDecision {
  if (!input.record.allowFallback) {
    return { allowed: false, reason: "fallback_disabled_by_default", fallbackWorker: null };
  }
  if (input.record.s13RequestId) {
    return { allowed: false, reason: "fallback_blocked_after_s13_submission", fallbackWorker: null };
  }
  if (input.record.result?.generatedTokens?.length) {
    return { allowed: false, reason: "fallback_blocked_after_senior_tokens", fallbackWorker: null };
  }
  if (INELIGIBLE.has(input.failureCode)) {
    return { allowed: false, reason: `fallback_ineligible:${input.failureCode}`, fallbackWorker: null };
  }
  if (!ELIGIBLE_BEFORE_SUBMISSION.has(input.failureCode)) {
    return { allowed: false, reason: `fallback_not_classified_eligible:${input.failureCode}`, fallbackWorker: null };
  }
  return {
    allowed: true,
    reason: `fallback_eligible:${input.failureCode}`,
    fallbackWorker: input.defaultWorker ?? "local-nemotron-nano-30b-console",
  };
}

/** Nano/default output must never be labeled as Nemotron Super. */
export function assertWorkerIdentityPreserved(result: {
  claimedModel?: string;
  actualWorker?: string;
}): void {
  const claimed = (result.claimedModel ?? "").toLowerCase();
  const actual = (result.actualWorker ?? "").toLowerCase();
  if (claimed.includes("super") && actual.includes("nano")) {
    throw new Error("worker_identity_disguise_forbidden");
  }
}
