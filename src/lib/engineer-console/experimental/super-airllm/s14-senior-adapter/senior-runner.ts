/** S14 senior request runner — approval → S13 submit → poll → correlate. */

import { evaluateSeniorFallback } from "./fallback-policy";
import { S13ClientError, S13LocalClient } from "./s13-client";
import { SeniorCorrelationStore } from "./correlation-store";
import { evaluateSeniorRouteDecision } from "./route-gate";
import { isTerminalS13State, mapS13StateToSenior } from "./state-map";
import {
  DEFAULT_DEADLINES,
  S14_EXECUTION_MODE,
  S14_GENERATION_STRATEGY,
  S14_RUNTIME_ID,
  type AdapterDeadlines,
  type SeniorApprovalArtifact,
  type SeniorCorrelationRecord,
  type SeniorGenerationRequest,
  type SeniorGenerationResult,
  type SeniorRouteDecision,
} from "./types";

export type SeniorRunnerOptions = {
  client: S13LocalClient;
  store: SeniorCorrelationStore;
  expectedSourceCommit?: string | null;
  expectedManifestSha?: string | null;
  deadlines?: Partial<AdapterDeadlines>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  routeEnabled?: boolean;
  runtimeAvailable?: boolean;
  consumedApprovals?: Set<string>;
};

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyRecord(request: SeniorGenerationRequest): SeniorCorrelationRecord {
  const now = new Date().toISOString();
  return {
    veraRequestId: request.veraRequestId,
    runId: request.runId ?? "",
    taskId: request.taskId ?? "",
    runtimeId: request.runtimeId ?? S14_RUNTIME_ID,
    approvalReference: request.approvalReference,
    s13RequestId: null,
    idempotencyKey: request.idempotencyKey,
    prompt: request.prompt,
    maxNewTokens: request.maxNewTokens,
    state: "senior_decision_blocked",
    lastS13State: null,
    submittedAt: null,
    updatedAt: now,
    completedAt: null,
    cancelRequestedAt: null,
    result: null,
    error: null,
    decision: null,
    allowFallback: Boolean(request.allowFallback),
    fallbackUsed: false,
    fallbackWorker: null,
  };
}

function tokensFromStatus(status: {
  result?: {
    generatedTokens?: Array<{ tokenId?: number; decoded?: string; selectedLogit?: number }>;
  };
  generatedTokens?: Array<{ tokenId?: number; decoded?: string; selectedLogit?: number }>;
}): SeniorGenerationResult["generatedTokens"] {
  const raw = status.result?.generatedTokens ?? status.generatedTokens ?? [];
  return raw.map((t) => ({
    tokenId: Number(t.tokenId ?? 0),
    decoded: String(t.decoded ?? ""),
    selectedLogit: Number(t.selectedLogit ?? 0),
  }));
}

export class SeniorRequestRunner {
  private readonly deadlines: AdapterDeadlines;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  readonly consumedApprovals: Set<string>;

  constructor(private readonly options: SeniorRunnerOptions) {
    this.deadlines = { ...DEFAULT_DEADLINES, ...options.deadlines };
    this.sleep = options.sleep ?? sleepDefault;
    this.now = options.now ?? Date.now;
    this.consumedApprovals = options.consumedApprovals ?? new Set();
  }

  decide(
    request: SeniorGenerationRequest,
    approval: SeniorApprovalArtifact | null,
  ): SeniorRouteDecision {
    const decision = evaluateSeniorRouteDecision({
      request,
      approval,
      routeEnabled: this.options.routeEnabled,
      runtimeAvailable: this.options.runtimeAvailable,
      consumedApprovals: this.consumedApprovals,
      nowMs: this.now(),
    });
    this.options.store.writeDecision(request.veraRequestId, decision);
    return decision;
  }

  async run(
    request: SeniorGenerationRequest,
    approval: SeniorApprovalArtifact | null,
  ): Promise<SeniorCorrelationRecord> {
    const existing = this.options.store.read(request.veraRequestId);
    if (existing?.s13RequestId) {
      if (
        existing.prompt !== request.prompt ||
        existing.maxNewTokens !== request.maxNewTokens ||
        existing.approvalReference !== request.approvalReference ||
        existing.runtimeId !== (request.runtimeId ?? S14_RUNTIME_ID)
      ) {
        const conflict = {
          ...existing,
          state: "senior_failed" as const,
          error: {
            code: "senior_duplicate_payload_conflict",
            message: "conflicting duplicate payload for existing correlation",
          },
        };
        return this.options.store.write(conflict);
      }
      return this.pollUntilTerminal(existing);
    }

    let record = existing ?? emptyRecord(request);
    const decision = this.decide(request, approval);
    record = this.options.store.write({ ...record, decision });

    if (!decision.eligible || !decision.approved) {
      return this.options.store.write({
        ...record,
        state: "senior_decision_blocked",
        error: { code: decision.reason, message: decision.reason },
        completedAt: new Date().toISOString(),
      });
    }

    try {
      await this.validateServiceReady();
    } catch (error) {
      const code =
        error instanceof S13ClientError
          ? error.code
          : "senior_service_not_ready";
      const message = error instanceof Error ? error.message : String(error);
      record = this.options.store.write({
        ...record,
        state: "senior_failed",
        error: { code, message },
        completedAt: new Date().toISOString(),
      });
      const fb = evaluateSeniorFallback({ record, failureCode: code });
      if (fb.allowed) {
        return this.options.store.write({
          ...record,
          state: "senior_fallback_eligible",
          fallbackUsed: true,
          fallbackWorker: fb.fallbackWorker,
          error: { code, message: `${message}; ${fb.reason}` },
        });
      }
      return record;
    }

    if (approval) {
      this.options.store.writeApproval(approval.approvalReference, approval);
    }

    let submitted: { requestId: string };
    try {
      submitted = await this.options.client.submitGeneration({
        prompt: request.prompt,
        maxNewTokens: request.maxNewTokens,
        generationPolicy: "greedy",
        requestKey: request.idempotencyKey,
      });
    } catch (error) {
      const code =
        error instanceof S13ClientError
          ? error.code
          : "senior_service_unavailable_before_submission";
      const message = error instanceof Error ? error.message : String(error);
      record = this.options.store.write({
        ...record,
        state: "senior_failed",
        error: { code, message },
        completedAt: new Date().toISOString(),
      });
      const fb = evaluateSeniorFallback({ record, failureCode: code });
      if (fb.allowed) {
        return this.options.store.write({
          ...record,
          state: "senior_fallback_eligible",
          fallbackUsed: true,
          fallbackWorker: fb.fallbackWorker,
        });
      }
      return record;
    }

    if (approval?.oneUse) {
      this.consumedApprovals.add(approval.approvalReference);
    }

    record = this.options.store.write({
      ...record,
      s13RequestId: submitted.requestId,
      submittedAt: new Date().toISOString(),
      state: "senior_submitted",
      lastS13State: "queued",
      error: null,
    });

    return this.pollUntilTerminal(record);
  }

  async cancel(veraRequestId: string): Promise<SeniorCorrelationRecord> {
    const record = this.options.store.read(veraRequestId);
    if (!record) {
      throw new Error(`correlation_not_found:${veraRequestId}`);
    }
    if (
      record.state === "senior_completed" ||
      record.state === "senior_cancelled" ||
      record.state === "senior_failed" ||
      record.state === "senior_decision_blocked"
    ) {
      return record;
    }
    const cancelRequestedAt = record.cancelRequestedAt ?? new Date().toISOString();
    let next = this.options.store.write({ ...record, cancelRequestedAt });
    if (!next.s13RequestId) {
      return this.options.store.write({
        ...next,
        state: "senior_cancelled",
        completedAt: new Date().toISOString(),
        error: { code: "senior_cancelled", message: "cancelled before s13 submission" },
      });
    }
    try {
      await this.options.client.cancelGeneration(next.s13RequestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next = this.options.store.write({
        ...next,
        error: { code: "senior_failed", message: `cancel_call_failed:${message}` },
      });
    }
    return this.pollUntilTerminal(next, this.deadlines.cancellationMs);
  }

  async reconcileActive(): Promise<SeniorCorrelationRecord[]> {
    const out: SeniorCorrelationRecord[] = [];
    for (const record of this.options.store.listNonterminal()) {
      if (!record.s13RequestId) {
        out.push(record);
        continue;
      }
      try {
        out.push(await this.pollUntilTerminal(record, 30_000));
      } catch {
        out.push(
          this.options.store.write({
            ...record,
            state: "senior_status_unknown",
            error: { code: "senior_status_unknown", message: "reconcile_poll_failed" },
          }),
        );
      }
    }
    return out;
  }

  private async validateServiceReady(): Promise<void> {
    const health = await this.options.client.health(this.deadlines.connectMs);
    const readiness = await this.options.client.readiness(this.deadlines.connectMs);
    if (!health.httpLocalOnly && health.bind && !String(health.bind).startsWith("127.0.0.1")) {
      throw new S13ClientError("s13_not_local_only", "senior_non_loopback_url_rejected");
    }
    if (health.recoveryRequired || readiness.recoveryRequired) {
      throw new S13ClientError("s13_recovery_required", "senior_recovery_required");
    }
    if (health.serviceState === "failed" || health.serviceState === "stopping" || health.serviceState === "stopped") {
      throw new S13ClientError(`s13_state:${health.serviceState}`, "senior_service_not_ready");
    }
    if (readiness.serviceReady === false || readiness.acceptingRequests === false) {
      // Busy with largeModelRunning may still accept queue — only block when not accepting.
      if (readiness.acceptingRequests === false && readiness.largeModelRunning !== true) {
        throw new S13ClientError("s13_not_accepting", "senior_service_not_ready");
      }
      if (readiness.serviceReady === false && readiness.largeModelRunning !== true) {
        throw new S13ClientError("s13_not_ready", "senior_service_not_ready");
      }
    }
    if (
      this.options.expectedSourceCommit &&
      health.sourceCommit &&
      health.sourceCommit !== this.options.expectedSourceCommit
    ) {
      throw new S13ClientError("source_commit_mismatch", "senior_source_fingerprint_mismatch");
    }
    if (
      this.options.expectedManifestSha &&
      health.sourceManifestSha256 &&
      health.sourceManifestSha256 !== this.options.expectedManifestSha
    ) {
      throw new S13ClientError("source_manifest_mismatch", "senior_source_fingerprint_mismatch");
    }
    if (health.executionMode && health.executionMode !== S14_EXECUTION_MODE) {
      throw new S13ClientError(`execution_mode:${health.executionMode}`, "senior_service_not_ready");
    }
  }

  private async pollUntilTerminal(
    record: SeniorCorrelationRecord,
    overallMs?: number,
  ): Promise<SeniorCorrelationRecord> {
    if (!record.s13RequestId) return record;
    const deadline =
      this.now() +
      (overallMs ??
        this.deadlines.queuedWaitMs +
          this.deadlines.activeExecutionMs +
          this.deadlines.operationalCleanupMs);
    let current = record;
    while (this.now() < deadline) {
      let status;
      try {
        status = await this.options.client.getGeneration(current.s13RequestId, this.deadlines.connectMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        current = this.options.store.write({
          ...current,
          state: "senior_status_unknown",
          error: { code: "senior_status_unknown", message },
        });
        await this.sleep(this.deadlines.pollIntervalMs);
        continue;
      }
      const s13State = String(status.state ?? "");
      const mapped = mapS13StateToSenior(s13State);
      current = this.options.store.write({
        ...current,
        lastS13State: s13State,
        state: mapped,
      });
      if (isTerminalS13State(s13State)) {
        if (s13State === "completed") {
          const resultPayload = status.result ?? status;
          const nanoRestored = Boolean(
            status.result?.nanoRestored ?? status.nanoRestored ?? resultPayload.nanoRestored,
          );
          const fallbackDetected = Boolean(status.result?.fallbackDetected ?? false);
          const tokens = tokensFromStatus(status);
          if (!nanoRestored || fallbackDetected || tokens.length === 0) {
            return this.options.store.write({
              ...current,
              state: "senior_failed",
              completedAt: new Date().toISOString(),
              error: {
                code: fallbackDetected ? "senior_failed" : "senior_result_ambiguous",
                message: !nanoRestored
                  ? "nano_not_restored"
                  : fallbackDetected
                    ? "fallback_detected"
                    : "missing_tokens",
              },
            });
          }
          const result: SeniorGenerationResult = {
            veraRequestId: current.veraRequestId,
            s13RequestId: current.s13RequestId!,
            state: "completed",
            model: String(status.result?.model ?? "Nemotron-Super-120B-A12B-FP8"),
            executionMode: S14_EXECUTION_MODE,
            generationStrategy: S14_GENERATION_STRATEGY,
            generatedTokens: tokens,
            nanoRestored: true,
            fallbackDetected: false,
            startedAt: String(status.result?.createdAt ?? current.submittedAt ?? ""),
            completedAt: String(status.result?.completedAt ?? new Date().toISOString()),
          };
          return this.options.store.write({
            ...current,
            state: "senior_completed",
            result,
            completedAt: result.completedAt,
            error: null,
          });
        }
        if (s13State === "cancelled") {
          return this.options.store.write({
            ...current,
            state: "senior_cancelled",
            completedAt: new Date().toISOString(),
            error: { code: "senior_cancelled", message: "s13_cancelled" },
          });
        }
        if (s13State === "recovery_required") {
          return this.options.store.write({
            ...current,
            state: "senior_recovery_required",
            error: { code: "senior_recovery_required", message: "s13_recovery_required" },
          });
        }
        return this.options.store.write({
          ...current,
          state: "senior_failed",
          completedAt: new Date().toISOString(),
          error: { code: "senior_failed", message: status.error ?? s13State },
        });
      }
      await this.sleep(this.deadlines.pollIntervalMs);
    }
    return this.options.store.write({
      ...current,
      state: "senior_status_unknown",
      error: {
        code: "senior_status_unknown",
        message: "adapter_deadline_expired_correlation_preserved",
      },
    });
  }
}
