import { checkSeniorInvocationGates } from "./gates";
import { invokeSeniorReview } from "./invoke";
import type { SeniorInvocationBlockedReason, SeniorInvocationResult } from "./invoke-types";
import { getDefaultSeniorReviewQueueStore } from "./queue-store";
import {
  SENIOR_REVIEW_REQUEST_CONFIRMATION,
  type RequestSeniorReviewInput,
  type SeniorReviewQueueItem,
  type SeniorReviewQueueStore,
  type SeniorReviewQueueSummary,
  type StageSeniorReviewPackageInput,
} from "./queue-types";

const STAGING_ONLY_BLOCK = "operator_approval_missing" as const satisfies SeniorInvocationBlockedReason;

function nowIso(now?: () => string): string {
  return now?.() ?? new Date().toISOString();
}

function clonePackage<T>(value: T): T {
  return structuredClone(value);
}

function nextId(clock: string): string {
  return `srq_${clock.replace(/[:.]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
}

function stagingInvokable(reasons: SeniorInvocationBlockedReason[]): boolean {
  return reasons.length === 1 && reasons[0] === STAGING_ONLY_BLOCK;
}

export function applyInvocationToItem(
  item: SeniorReviewQueueItem,
  invocation: SeniorInvocationResult,
  clock: string,
): SeniorReviewQueueItem {
  const next: SeniorReviewQueueItem = {
    ...item,
    invocationResult: invocation,
    updatedAt: clock,
    humanGatesStillRequired: true,
    advisoryOnly: true,
  };

  if (invocation.status === "succeeded") {
    next.status = "succeeded";
    next.rawResponse = invocation.rawResponse;
    next.parsedReview = invocation.parsedReview;
    next.blockedReasons = [];
    next.warnings = invocation.warnings;
    next.invokable = false;
    return next;
  }

  if (invocation.status === "failed") {
    next.status = "failed";
    next.rawResponse = invocation.rawResponse;
    next.parsedReview = null;
    next.blockedReasons = [];
    next.warnings = [...invocation.warnings, invocation.failureMessage];
    next.invokable = false;
    return next;
  }

  next.status = "blocked";
  next.rawResponse = null;
  next.parsedReview = null;
  next.blockedReasons = invocation.blockedReasons;
  next.warnings = invocation.warnings;
  next.invokable = false;
  return next;
}

/**
 * Stage a senior escalation package. Never fetches and never auto-requests invocation.
 */
export function stageSeniorReviewPackage(input: StageSeniorReviewPackageInput): SeniorReviewQueueItem {
  const clock = nowIso(input.now);
  const pkg = clonePackage(input.package);
  const gateDecision = checkSeniorInvocationGates({
    package: pkg,
    env: input.env,
  });
  const blockedReasons = gateDecision.reasons.filter((reason) => reason !== STAGING_ONLY_BLOCK);
  const invokable = stagingInvokable(gateDecision.reasons);
  const item: SeniorReviewQueueItem = {
    id: input.id ?? nextId(clock),
    taskId: pkg.taskId,
    runId: pkg.runId,
    status: invokable ? "package_ready" : "blocked",
    packageSnapshot: pkg,
    escalationReasons: [...pkg.decision.reasons],
    recommendedProfile: "deepseek-senior",
    gateDecision,
    invokable,
    operatorRequest: null,
    invocationResult: null,
    rawResponse: null,
    parsedReview: null,
    blockedReasons,
    warnings: [],
    createdAt: clock,
    updatedAt: clock,
    advisoryOnly: true,
    humanGatesStillRequired: true,
  };
  const store = input.store ?? getDefaultSeniorReviewQueueStore();
  store.put(item);
  return item;
}

export function summarizeSeniorReviewQueueItem(item: SeniorReviewQueueItem): SeniorReviewQueueSummary {
  return {
    id: item.id,
    status: item.status,
    taskId: item.taskId,
    runId: item.runId,
    objective: item.packageSnapshot.objective,
    escalationReasons: item.escalationReasons,
    recommendedProfile: "deepseek-senior",
    invokable: item.invokable,
    seniorEnabled: item.gateDecision.seniorEnabled,
    blockedReasons: item.blockedReasons,
    warnings: item.warnings,
    advisoryOnly: true,
    humanGatesStillRequired: true,
  };
}

export function getSeniorReviewQueueItem(
  id: string,
  store = getDefaultSeniorReviewQueueStore(),
): SeniorReviewQueueItem | null {
  return store.get(id);
}

export function listSeniorReviewQueue(
  store = getDefaultSeniorReviewQueueStore(),
): SeniorReviewQueueItem[] {
  return store.list();
}

function resolveQueuedItem(input: RequestSeniorReviewInput): SeniorReviewQueueItem | null {
  const store = input.store ?? getDefaultSeniorReviewQueueStore();
  if (input.item) return input.item;
  if (input.itemId) return store.get(input.itemId);
  if (input.package) {
    return stageSeniorReviewPackage({
      package: input.package,
      env: input.env,
      store,
      now: input.now,
    });
  }
  return null;
}

function markOperatorBlocked(
  item: SeniorReviewQueueItem,
  warning: string,
  store: SeniorReviewQueueStore,
  clock: string,
): SeniorReviewQueueItem {
  const next: SeniorReviewQueueItem = {
    ...item,
    status: item.status === "package_ready" ? "blocked" : item.status,
    warnings: item.warnings.includes(warning) ? item.warnings : [...item.warnings, warning],
    updatedAt: clock,
    humanGatesStillRequired: true,
  };
  store.put(next);
  return next;
}

export function cancelSeniorReviewQueueItem(
  id: string,
  store = getDefaultSeniorReviewQueueStore(),
  now?: () => string,
): SeniorReviewQueueItem | null {
  const item = store.get(id);
  if (!item) return null;
  const cancelled: SeniorReviewQueueItem = {
    ...item,
    status: "cancelled",
    invokable: false,
    updatedAt: nowIso(now),
    humanGatesStillRequired: true,
  };
  store.put(cancelled);
  return cancelled;
}

/**
 * Explicit operator command. Calls invokeSeniorReview only after confirmation and V2 gates.
 */
export async function requestSeniorReviewForPackage(
  input: RequestSeniorReviewInput,
): Promise<{ item: SeniorReviewQueueItem | null; invocation: SeniorInvocationResult | null }> {
  const store = input.store ?? getDefaultSeniorReviewQueueStore();
  const clock = nowIso(input.now);
  const item = resolveQueuedItem(input);
  if (!item) {
    return { item: null, invocation: null };
  }

  if (input.operatorRequested !== true || !input.operatorId?.trim()) {
    return { item: markOperatorBlocked(item, "operator_request_missing", store, clock), invocation: null };
  }
  if (input.confirmationText !== SENIOR_REVIEW_REQUEST_CONFIRMATION) {
    return { item: markOperatorBlocked(item, "confirmation_invalid", store, clock), invocation: null };
  }

  if (item.status === "cancelled") {
    return { item, invocation: null };
  }
  if (item.status === "succeeded") {
    return { item, invocation: item.invocationResult };
  }

  const requested: SeniorReviewQueueItem = {
    ...item,
    status: "requested",
    operatorRequest: {
      requestedBy: input.operatorId,
      requestedAt: clock,
      confirmationText: input.confirmationText,
    },
    updatedAt: clock,
    humanGatesStillRequired: true,
    advisoryOnly: true,
  };
  store.put(requested);

  const invocation = await invokeSeniorReview({
    package: requested.packageSnapshot,
    operatorApproval: {
      approved: true,
      invocationRequested: true,
      approvedBy: input.operatorId,
      approvedAt: clock,
      packageTaskId: requested.taskId,
      packageRunId: requested.runId,
    },
    env: input.env,
    fetchFn: input.fetchFn,
  });

  const next = applyInvocationToItem(requested, invocation, nowIso(input.now));
  store.put(next);
  return { item: next, invocation };
}
