import { isEngineerConsoleDbInitialized } from "../db/client";
import { getAutonomousState, patchAutonomousDocument } from "../autonomous-engineer/state-store";
import { blockedReasonLabel, seniorReviewStatusLabel } from "./panel-view";
import {
  SENIOR_REVIEW_DURABLE_MAX_ATTEMPTS,
  SENIOR_REVIEW_DURABLE_SCHEMA_VERSION,
  type DurableSeniorReviewAttempt,
  type DurableSeniorReviewAttemptStatus,
  type DurableSeniorReviewGateStatus,
  type DurableSeniorReviewState,
  type EvidenceSeniorReviewSummary,
} from "./durable-types";
import type { SeniorEscalationPackage } from "./types";
import type { SeniorInvocationBlockedReason } from "./invoke-types";
import {
  SENIOR_REVIEW_REQUEST_CONFIRMATION,
  type SeniorReviewQueueItem,
  type SeniorReviewQueueStore,
} from "./queue-types";

const UNSAFE_SENIOR_CONFIG =
  /127\.0\.0\.1:1919|:8081|:8082|ENGINEER_CONSOLE_SENIOR|\/mnt\/model-storage/i;

export function blobContainsUnsafeSeniorConfigLeak(value: unknown): boolean {
  const blob = typeof value === "string" ? value : JSON.stringify(value);
  return UNSAFE_SENIOR_CONFIG.test(blob);
}

function nowIso(now?: () => string): string {
  return now?.() ?? new Date().toISOString();
}

function canTouchAutonomousState(): boolean {
  return isEngineerConsoleDbInitialized() || Boolean(process.env.ENGINEER_CONSOLE_DB_PATH);
}

function redactPersistedString(value: string): string {
  if (!value) return value;
  return value
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/\S*)?/gi, "[redacted-local-endpoint]")
    .replace(/127\.0\.0\.1:1919/gi, "[redacted-senior-endpoint]")
    .replace(/:8081\b/g, ":[redacted-nano-port]")
    .replace(/:8082\b/g, ":[redacted-nano-port]")
    .replace(/ENGINEER_CONSOLE_SENIOR[A-Z0-9_]*/g, "[redacted-senior-env]")
    .replace(/\/mnt\/model-storage[^\s"]*/g, "[redacted-checkpoint]");
}

function redactUnknownForPersist(value: unknown): unknown {
  if (typeof value === "string") return redactPersistedString(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactUnknownForPersist);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === "openaiBaseUrl" ? "" : redactUnknownForPersist(nested);
  }
  return out;
}

export function redactPackageSnapshotForPersist(
  snapshot: SeniorEscalationPackage,
): SeniorEscalationPackage {
  return redactUnknownForPersist(structuredClone(snapshot)) as SeniorEscalationPackage;
}

function gateStatusFromItem(item: SeniorReviewQueueItem): DurableSeniorReviewGateStatus {
  return {
    allowed: item.gateDecision.allowed,
    seniorEnabled: item.gateDecision.seniorEnabled,
    reasonCodes: [...item.blockedReasons],
  };
}

function labelsFor(reasons: SeniorInvocationBlockedReason[]): string[] {
  return reasons.map(blockedReasonLabel);
}

function emptyDurable(clock: string): DurableSeniorReviewState {
  return {
    schemaVersion: SENIOR_REVIEW_DURABLE_SCHEMA_VERSION,
    advisoryOnly: true,
    humanGatesStillRequired: true,
    attempts: [],
    updatedAt: clock,
  };
}

function shouldRecordAttempt(item: SeniorReviewQueueItem): boolean {
  if (item.status === "succeeded" || item.status === "failed") return true;
  if (item.operatorRequest) return true;
  return item.warnings.some(
    (warning) => warning === "confirmation_invalid" || warning === "operator_request_missing",
  );
}

function attemptStatusFor(item: SeniorReviewQueueItem): DurableSeniorReviewAttemptStatus {
  if (item.status === "succeeded") return "succeeded";
  if (item.status === "failed") return "failed";
  return "blocked";
}

function attemptFromItem(item: SeniorReviewQueueItem, clock: string): DurableSeniorReviewAttempt {
  return {
    attemptId: `sra_${item.id}_${clock.replace(/[:.]/g, "")}`,
    itemId: item.id,
    requestedAt: item.operatorRequest?.requestedAt ?? clock,
    requestedBy: item.operatorRequest?.requestedBy,
    confirmationAccepted:
      item.operatorRequest?.confirmationText === SENIOR_REVIEW_REQUEST_CONFIRMATION,
    status: attemptStatusFor(item),
    blockedReasons: item.blockedReasons.length > 0 ? [...item.blockedReasons] : undefined,
    blockedReasonLabels:
      item.blockedReasons.length > 0 ? labelsFor(item.blockedReasons) : undefined,
    rawResponse: item.rawResponse ?? undefined,
    parsedReview: item.parsedReview,
    warnings: item.warnings.length > 0 ? [...item.warnings] : undefined,
    usage: item.invocationResult?.usage ?? undefined,
    timingMs: item.invocationResult?.timingMs,
    advisoryOnly: true,
    humanGatesStillRequired: true,
  };
}

function mergeAttempts(
  existing: DurableSeniorReviewAttempt[],
  item: SeniorReviewQueueItem,
  clock: string,
): DurableSeniorReviewAttempt[] {
  if (!shouldRecordAttempt(item)) return existing;
  const nextAttempt = attemptFromItem(item, clock);
  const last = existing[existing.length - 1];
  if (
    last
    && last.itemId === nextAttempt.itemId
    && last.status === nextAttempt.status
    && last.requestedAt === nextAttempt.requestedAt
    && last.confirmationAccepted === nextAttempt.confirmationAccepted
  ) {
    return existing;
  }
  return [...existing, nextAttempt].slice(-SENIOR_REVIEW_DURABLE_MAX_ATTEMPTS);
}

export function durableStateFromQueueItem(
  item: SeniorReviewQueueItem,
  previous: DurableSeniorReviewState | null,
  now?: () => string,
): DurableSeniorReviewState {
  const clock = nowIso(now);
  const prior = previous ?? emptyDurable(clock);
  return {
    schemaVersion: SENIOR_REVIEW_DURABLE_SCHEMA_VERSION,
    advisoryOnly: true,
    humanGatesStillRequired: true,
    latestItemId: item.id,
    latestStatus: item.status,
    stagedPackage: {
      stagedAt: item.createdAt,
      packageId: item.id,
      packageSnapshot: redactPackageSnapshotForPersist(item.packageSnapshot),
      gateStatus: gateStatusFromItem(item),
      blockedReasons: [...item.blockedReasons],
      blockedReasonLabels: labelsFor(item.blockedReasons),
    },
    attempts: mergeAttempts(prior.attempts, item, clock),
    updatedAt: clock,
  };
}

export function queueItemFromDurableState(
  state: DurableSeniorReviewState,
): SeniorReviewQueueItem | null {
  const staged = state.stagedPackage;
  if (!staged || !state.latestItemId || !state.latestStatus) return null;
  const latestAttempt = state.attempts[state.attempts.length - 1] ?? null;
  return {
    id: state.latestItemId,
    taskId: staged.packageSnapshot.taskId,
    runId: staged.packageSnapshot.runId,
    status: state.latestStatus,
    packageSnapshot: staged.packageSnapshot,
    escalationReasons: [...staged.packageSnapshot.decision.reasons],
    recommendedProfile: "deepseek-senior",
    gateDecision: {
      allowed: false,
      reasons: [...staged.gateStatus.reasonCodes],
      gates: [],
      baseUrl: null,
      model: null,
      seniorEnabled: staged.gateStatus.seniorEnabled,
    },
    invokable: state.latestStatus === "package_ready",
    operatorRequest: latestAttempt?.requestedBy
      ? {
          requestedBy: latestAttempt.requestedBy,
          requestedAt: latestAttempt.requestedAt,
          confirmationText: latestAttempt.confirmationAccepted
            ? SENIOR_REVIEW_REQUEST_CONFIRMATION
            : "",
        }
      : null,
    invocationResult: null,
    rawResponse: latestAttempt?.rawResponse ?? null,
    parsedReview: latestAttempt?.parsedReview ?? null,
    blockedReasons: [...staged.blockedReasons],
    warnings: latestAttempt?.warnings ?? [],
    createdAt: staged.stagedAt,
    updatedAt: state.updatedAt,
    advisoryOnly: true,
    humanGatesStillRequired: true,
  };
}

export function parseDurableSeniorReviewState(
  value: unknown,
): DurableSeniorReviewState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<DurableSeniorReviewState>;
  if (record.schemaVersion !== SENIOR_REVIEW_DURABLE_SCHEMA_VERSION) return null;
  if (record.advisoryOnly !== true || record.humanGatesStillRequired !== true) return null;
  if (!Array.isArray(record.attempts) || typeof record.updatedAt !== "string") return null;
  return record as DurableSeniorReviewState;
}

export function loadDurableSeniorReviewState(
  runId: string,
): DurableSeniorReviewState | null {
  if (!canTouchAutonomousState()) return null;
  try {
    const state = getAutonomousState(runId);
    return parseDurableSeniorReviewState(state?.document.seniorReview);
  } catch {
    return null;
  }
}

export function persistDurableSeniorReviewState(
  runId: string,
  evidence: DurableSeniorReviewState,
): boolean {
  if (!canTouchAutonomousState()) return false;
  try {
    if (!getAutonomousState(runId)) return false;
    patchAutonomousDocument(runId, { seniorReview: evidence });
    return true;
  } catch {
    return false;
  }
}

export function persistQueueItemToRun(
  runId: string,
  item: SeniorReviewQueueItem,
  now?: () => string,
): DurableSeniorReviewState | null {
  const next = durableStateFromQueueItem(item, loadDurableSeniorReviewState(runId), now);
  if (!persistDurableSeniorReviewState(runId, next)) return null;
  return next;
}

export function hydrateQueueStoreFromDurable(
  runId: string,
  store: SeniorReviewQueueStore,
): SeniorReviewQueueItem | null {
  const durable = loadDurableSeniorReviewState(runId);
  if (!durable) return null;
  const item = queueItemFromDurableState(durable);
  if (!item) return null;
  store.put(item);
  return item;
}

export function wrapStoreWithDurablePersistence(
  runId: string,
  store: SeniorReviewQueueStore,
  now?: () => string,
): SeniorReviewQueueStore {
  return {
    get: (id) => store.get(id),
    list: () => store.list(),
    put(item) {
      store.put(item);
      if (item.runId === runId || item.id.endsWith(runId)) {
        persistQueueItemToRun(runId, item, now);
      }
    },
  };
}

export function toEvidenceSeniorReviewSummary(
  state: DurableSeniorReviewState | null,
): EvidenceSeniorReviewSummary | null {
  if (!state) return null;
  const latest = state.attempts[state.attempts.length - 1] ?? null;
  const summary: EvidenceSeniorReviewSummary = {
    schemaVersion: SENIOR_REVIEW_DURABLE_SCHEMA_VERSION,
    advisoryOnly: true,
    humanGatesStillRequired: true,
    status: state.latestStatus ?? null,
    statusLabel: state.latestStatus ? seniorReviewStatusLabel(state.latestStatus) : "Not requested",
    attemptedAt: latest?.requestedAt ?? state.updatedAt,
    requestedBy: latest?.requestedBy ?? null,
    confirmationAccepted: latest ? latest.confirmationAccepted : null,
    blockedReasonLabels: latest?.blockedReasonLabels
      ?? state.stagedPackage?.blockedReasonLabels
      ?? [],
    hasParsedReview: Boolean(latest?.parsedReview),
    rootCausePreview: latest?.parsedReview?.rootCause
      ? latest.parsedReview.rootCause.slice(0, 280)
      : null,
    nextWorkerMissionPreview: latest?.parsedReview?.nextWorkerMission
      ? latest.parsedReview.nextWorkerMission.slice(0, 280)
      : null,
    escalationReasons: (state.stagedPackage?.packageSnapshot.decision.reasons ?? [])
      .filter((reason) => !blobContainsUnsafeSeniorConfigLeak(reason)),
    qcGates: (latest?.parsedReview?.qcGates ?? [])
      .filter((gate) => !blobContainsUnsafeSeniorConfigLeak(gate))
      .slice(0, 12),
    riskLabels: latest?.parsedReview
      ? [
          latest.parsedReview.risks.approval,
          latest.parsedReview.risks.security,
          latest.parsedReview.risks.dataContract,
        ].filter((label) => label.trim().length > 0 && !blobContainsUnsafeSeniorConfigLeak(label))
      : [],
    warnings: (latest?.warnings ?? [])
      .filter((warning) => !blobContainsUnsafeSeniorConfigLeak(warning))
      .slice(0, 12),
    updatedAt: state.updatedAt,
    attemptCount: state.attempts.length,
  };
  return blobContainsUnsafeSeniorConfigLeak(summary) ? null : summary;
}

export function emptyDurableSeniorReviewState(
  now?: () => string,
): DurableSeniorReviewState {
  return emptyDurable(nowIso(now));
}
