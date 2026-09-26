/** S15 workflow orchestrator — default-first, dual preservation, operator acceptance. */

import type { SeniorApprovalArtifact } from "../s14-senior-adapter/types";
import { assertNoDefaultInvariants, GATED_SENIOR_REGISTRY_AFTER } from "../s14-senior-adapter/registry-view";
import { compareReviews, newId, sha256Text, utcNow } from "./comparison";
import { SeniorReviewBundleStore } from "./bundle-store";
import { validateAndBuildOperatorDecision } from "./acceptance-gate";
import {
  assertDownstreamActionBlocked,
  assertSeniorCannotSelfApprove,
  computeEffectiveReview,
} from "./eligibility";
import type {
  CreateBundleInput,
  DownstreamActionAttempt,
  OperatorDecisionInput,
  RecordSeniorResultInput,
  RequestSeniorInput,
  SeniorReviewBundle,
  SeniorReviewRecord,
} from "./types";
import {
  S15_DEFAULT_WORKER_RUNTIME_ID,
  S15_EXECUTION_MODE,
  S15_RUNTIME_ID,
  S15_SCHEMA,
} from "./types";

export type SeniorReviewWorkflowOptions = {
  store: SeniorReviewBundleStore;
  /** Injected S14 submit hook — S15 never calls S13 directly. */
  submitViaS14?: (input: {
    veraRequestId: string;
    approvalReference: string;
    prompt: string;
    idempotencyKey: string;
    maxNewTokens?: number;
  }) => Promise<{
    s14CorrelationId: string;
    s13RequestId?: string;
    state: string;
  }>;
  cancelViaS14?: (s14CorrelationId: string) => Promise<{ cancelled: boolean }>;
};

export class SeniorReviewWorkflow {
  private readonly store: SeniorReviewBundleStore;
  private readonly submitViaS14?: SeniorReviewWorkflowOptions["submitViaS14"];
  private readonly cancelViaS14?: SeniorReviewWorkflowOptions["cancelViaS14"];
  private readonly consumedDecisionIds = new Set<string>();

  constructor(options: SeniorReviewWorkflowOptions) {
    this.store = options.store;
    this.submitViaS14 = options.submitViaS14;
    this.cancelViaS14 = options.cancelViaS14;
    // Preserve no-default invariants at construction.
    assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);
  }

  /** Scenario 1: create default-only bundle. */
  createDefaultReview(input: CreateBundleInput): SeniorReviewBundle {
    const contentSha256 = sha256Text(input.defaultContent);
    const reviewId = input.defaultReviewId ?? newId("s15-default");
    const now = input.createdAt ?? utcNow();
    const bundle: SeniorReviewBundle = {
      schema: S15_SCHEMA,
      reviewBundleId: newId("s15-bundle"),
      runId: input.runId,
      taskId: input.taskId,
      workOrderId: input.workOrderId,
      state: "default_only",
      defaultReview: {
        reviewId,
        runtimeId: input.defaultRuntimeId ?? S15_DEFAULT_WORKER_RUNTIME_ID,
        content: input.defaultContent,
        contentSha256,
        createdAt: now,
      },
      effectiveReview: {
        source: "default",
        reviewId,
        contentSha256,
        eligibleForDownstreamUse: true,
        downstreamActionAuthorized: false,
      },
      decisionReason: "senior_review_not_requested",
      createdAt: now,
      updatedAt: now,
      revisionGeneration: 0,
    };
    return this.store.write(bundle);
  }

  /**
   * Request senior review via S14 (never S13 directly).
   * Requires default review first and a separate execution approval.
   */
  async requestSeniorReview(input: RequestSeniorInput): Promise<SeniorReviewBundle> {
    const bundle = this.requireBundle(input.reviewBundleId);
    if (!bundle.defaultReview?.contentSha256) {
      throw new Error("senior_review_requested_before_default_review");
    }
    if (!input.executionApprovalPresent) {
      const blocked: SeniorReviewBundle = {
        ...bundle,
        state: "senior_execution_blocked",
        decisionReason: "senior_execution_not_approved",
        effectiveReview: computeEffectiveReview(bundle),
      };
      return this.store.write(blocked);
    }

    // Idempotent: same bundle + same idempotency key returns existing request.
    const idempotencyKey = input.idempotencyKey ?? `s15-senior-${bundle.reviewBundleId}`;
    if (
      bundle.seniorReviewRequest &&
      bundle.seniorReviewRequest.idempotencyKey === idempotencyKey &&
      bundle.seniorReviewRequest.approvalReference === input.approvalReference
    ) {
      return bundle;
    }
    if (
      bundle.seniorReviewRequest &&
      bundle.seniorReviewRequest.idempotencyKey === idempotencyKey &&
      bundle.seniorReviewRequest.approvalReference !== input.approvalReference
    ) {
      throw new Error("senior_duplicate_payload_conflict");
    }
    if (bundle.seniorReviewRequest && bundle.seniorReviewRequest.idempotencyKey !== idempotencyKey) {
      // Conflicting second senior request while one exists
      throw new Error("senior_duplicate_payload_conflict");
    }

    const requestId = input.requestId ?? newId("s15-senior-req");
    let s14CorrelationId = requestId;
    let s13RequestId: string | undefined;
    let state = "senior_requested";

    if (this.submitViaS14) {
      const submitted = await this.submitViaS14({
        veraRequestId: requestId,
        approvalReference: input.approvalReference,
        prompt: input.prompt ?? `S15 senior review for bundle ${bundle.reviewBundleId}`,
        idempotencyKey,
        maxNewTokens: input.maxNewTokens,
      });
      s14CorrelationId = submitted.s14CorrelationId;
      s13RequestId = submitted.s13RequestId;
      state = submitted.state;
    }

    const next: SeniorReviewBundle = {
      ...bundle,
      state: state === "senior_executing" ? "senior_executing" : "senior_requested",
      seniorReviewRequest: {
        requestId,
        runtimeId: S15_RUNTIME_ID,
        approvalReference: input.approvalReference,
        s14CorrelationId,
        s13RequestId,
        state,
        requestedAt: utcNow(),
        idempotencyKey,
      },
      decisionReason: "senior_review_pending",
      effectiveReview: computeEffectiveReview(bundle),
    };
    this.store.writeExecutionApproval(input.approvalReference, {
      schema: "s14_senior_execution_approval_v1",
      approvalReference: input.approvalReference,
      note: "execution_only_not_acceptance",
    });
    return this.store.write(next);
  }

  /** Record senior result (fixture or S14-mapped). Preserves default immutably. */
  recordSeniorResult(input: RecordSeniorResultInput): SeniorReviewBundle {
    const bundle = this.requireBundle(input.reviewBundleId);
    if (!bundle.defaultReview) {
      throw new Error("senior_review_requested_before_default_review");
    }
    // Immutable: if senior already recorded with same content, return as-is.
    if (bundle.seniorReview && bundle.seniorReview.contentSha256 === sha256Text(input.content)) {
      return bundle;
    }
    if (bundle.seniorReview) {
      throw new Error("senior_review_immutable_cannot_overwrite");
    }

    const isPartial =
      input.partial === true ||
      input.complete === false ||
      input.s15AcceptanceEligible === false ||
      input.completionReason === "cancelled" ||
      input.completionReason === "failed" ||
      input.completionReason === "recovery_required" ||
      input.completionReason === "truncated";

    if (isPartial) {
      const seniorPartial: SeniorReviewRecord = {
        reviewId: newId("s15-senior"),
        runtimeId: S15_RUNTIME_ID,
        executionMode: S15_EXECUTION_MODE,
        content: input.content,
        contentSha256: sha256Text(input.content),
        generatedTokenIds: input.generatedTokenIds,
        createdAt: input.createdAt ?? utcNow(),
        syntheticOrFixture: input.syntheticOrFixture ?? false,
        completionReason: input.completionReason ?? "cancelled",
        tokensCompleted: input.tokensCompleted ?? input.generatedTokenIds?.length ?? 0,
        requestedMaxNewTokens: input.requestedMaxNewTokens,
        complete: false,
        s15AcceptanceEligible: false,
      };
      const state =
        input.completionReason === "cancelled"
          ? "senior_cancelled"
          : input.completionReason === "recovery_required"
            ? "senior_recovery_required"
            : "senior_failed";
      const next: SeniorReviewBundle = {
        ...bundle,
        state,
        seniorReview: seniorPartial,
        comparison: undefined,
        decisionReason:
          input.completionReason === "cancelled"
            ? "senior_review_cancelled"
            : "senior_output_partial_not_acceptable",
        effectiveReview: {
          source: "default",
          reviewId: bundle.defaultReview.reviewId,
          contentSha256: bundle.defaultReview.contentSha256,
          eligibleForDownstreamUse: true,
          downstreamActionAuthorized: false,
        },
        seniorReviewRequest: bundle.seniorReviewRequest
          ? {
              ...bundle.seniorReviewRequest,
              s13RequestId: input.s13RequestId ?? bundle.seniorReviewRequest.s13RequestId,
              state,
            }
          : undefined,
      };
      return this.store.write(next);
    }

    const complete = input.complete !== false;
    const eligible = input.s15AcceptanceEligible !== false && complete;
    const senior: SeniorReviewRecord = {
      reviewId: newId("s15-senior"),
      runtimeId: S15_RUNTIME_ID,
      executionMode: S15_EXECUTION_MODE,
      content: input.content,
      contentSha256: sha256Text(input.content),
      generatedTokenIds: input.generatedTokenIds,
      createdAt: input.createdAt ?? utcNow(),
      syntheticOrFixture: input.syntheticOrFixture ?? true,
      completionReason: input.completionReason ?? (input.syntheticOrFixture === false ? "max_new_tokens" : "fixture"),
      tokensCompleted: input.tokensCompleted ?? input.generatedTokenIds?.length,
      requestedMaxNewTokens: input.requestedMaxNewTokens,
      complete,
      s15AcceptanceEligible: eligible,
    };
    const comparison = compareReviews(bundle.defaultReview, senior);
    const next: SeniorReviewBundle = {
      ...bundle,
      state: "pending_operator_review",
      seniorReview: senior,
      comparison,
      seniorReviewRequest: bundle.seniorReviewRequest
        ? {
            ...bundle.seniorReviewRequest,
            s13RequestId: input.s13RequestId ?? bundle.seniorReviewRequest.s13RequestId,
            state: "senior_completed",
          }
        : undefined,
      decisionReason: "operator_decision_missing",
      effectiveReview: {
        source: "default",
        reviewId: bundle.defaultReview.reviewId,
        contentSha256: bundle.defaultReview.contentSha256,
        eligibleForDownstreamUse: true,
        downstreamActionAuthorized: false,
      },
    };
    return this.store.write(next);
  }

  recordSeniorFailure(
    reviewBundleId: string,
    kind: "failed" | "recovery_required" | "cancelled",
  ): SeniorReviewBundle {
    const bundle = this.requireBundle(reviewBundleId);
    const state =
      kind === "cancelled"
        ? "senior_cancelled"
        : kind === "recovery_required"
          ? "senior_recovery_required"
          : "senior_failed";
    const next: SeniorReviewBundle = {
      ...bundle,
      state,
      decisionReason:
        kind === "cancelled" ? "senior_review_cancelled" : "senior_review_failed",
      effectiveReview: {
        source: "default",
        reviewId: bundle.defaultReview.reviewId,
        contentSha256: bundle.defaultReview.contentSha256,
        eligibleForDownstreamUse: true,
        downstreamActionAuthorized: false,
      },
      seniorReviewRequest: bundle.seniorReviewRequest
        ? { ...bundle.seniorReviewRequest, state }
        : undefined,
    };
    return this.store.write(next);
  }

  async cancelSeniorReview(reviewBundleId: string): Promise<SeniorReviewBundle> {
    const bundle = this.requireBundle(reviewBundleId);
    if (bundle.seniorReviewRequest && this.cancelViaS14) {
      await this.cancelViaS14(bundle.seniorReviewRequest.s14CorrelationId);
    }
    return this.recordSeniorFailure(reviewBundleId, "cancelled");
  }

  applyOperatorDecision(input: OperatorDecisionInput): SeniorReviewBundle {
    const bundle = this.requireBundle(input.reviewBundleId);
    if (bundle.state === "senior_accepted" || bundle.state === "senior_rejected" || bundle.state === "default_retained") {
      throw new Error("acceptance_reuse_rejected:bundle_already_decided");
    }
    if (bundle.state === "stale") {
      throw new Error("review_artifact_changed:new_acceptance_required");
    }
    assertSeniorCannotSelfApprove({
      decisionOperatorId: input.operatorId,
      seniorRuntimeId: S15_RUNTIME_ID,
    });
    const validated = validateAndBuildOperatorDecision(bundle, input, {
      consumedDecisionIds: this.consumedDecisionIds,
    });
    if (!validated.ok) {
      throw new Error(`${validated.reason}:${validated.message}`);
    }
    const decision = validated.decision;
    let state: SeniorReviewBundle["state"] = "pending_operator_review";
    let decisionReason: SeniorReviewBundle["decisionReason"] = "operator_decision_missing";
    if (decision.decision === "accept_senior") {
      state = "senior_accepted";
      decisionReason = "operator_accepted_senior";
    } else if (decision.decision === "reject_senior") {
      state = "senior_rejected";
      decisionReason = "operator_rejected_senior";
    } else if (decision.decision === "keep_default") {
      state = "default_retained";
      decisionReason = "operator_retained_default";
    } else {
      state = "revision_requested";
      decisionReason = "operator_decision_missing";
    }

    const next: SeniorReviewBundle = {
      ...bundle,
      state,
      operatorDecision: decision,
      decisionReason,
      effectiveReview: {
        source: "default",
        reviewId: bundle.defaultReview.reviewId,
        contentSha256: bundle.defaultReview.contentSha256,
        eligibleForDownstreamUse: true,
        downstreamActionAuthorized: false,
      },
    };
    if (decision.decision === "accept_senior") {
      this.consumedDecisionIds.add(decision.decisionId);
      next.operatorDecision = { ...decision, consumed: true };
    }
    next.effectiveReview = computeEffectiveReview(next);
    if (decision.decision === "accept_senior") {
      this.store.markDecisionConsumed(decision.decisionId);
    }
    return this.store.write(next);
  }

  /**
   * Supported revision: replace default or senior content through a new revision generation.
   * Prior acceptance becomes stale; effective review returns to default.
   */
  reviseDefaultReview(reviewBundleId: string, newContent: string): SeniorReviewBundle {
    const bundle = this.requireBundle(reviewBundleId);
    const next: SeniorReviewBundle = {
      ...bundle,
      revisionGeneration: bundle.revisionGeneration + 1,
      defaultReview: {
        ...bundle.defaultReview,
        content: newContent,
        contentSha256: sha256Text(newContent),
        reviewId: newId("s15-default"),
        createdAt: utcNow(),
      },
      comparison: undefined,
      operatorDecision: bundle.operatorDecision
        ? { ...bundle.operatorDecision, decision: "request_revision" }
        : undefined,
      state: "stale",
      decisionReason: "review_artifact_changed",
      effectiveReview: {
        source: "default",
        reviewId: "",
        contentSha256: "",
        eligibleForDownstreamUse: true,
        downstreamActionAuthorized: false,
      },
    };
    next.effectiveReview = {
      source: "default",
      reviewId: next.defaultReview.reviewId,
      contentSha256: next.defaultReview.contentSha256,
      eligibleForDownstreamUse: true,
      downstreamActionAuthorized: false,
    };
    // Senior content remains preserved but acceptance is stale.
    return this.store.write(next);
  }

  /** Recover nonterminal bundles after process restart — never auto-accept. */
  recoverAfterRestart(): SeniorReviewBundle[] {
    const recovered = this.store.list().map((b) => {
      if (b.state === "senior_accepted" && b.operatorDecision) {
        // Re-validate hashes; stale if mismatch.
        const hashesOk =
          b.operatorDecision.reviewedDefaultSha256 === b.defaultReview.contentSha256 &&
          (!b.seniorReview ||
            b.operatorDecision.reviewedSeniorSha256 === b.seniorReview.contentSha256) &&
          (!b.comparison ||
            b.operatorDecision.reviewedComparisonSha256 === b.comparison.comparisonSha256);
        if (!hashesOk) {
          const stale: SeniorReviewBundle = {
            ...b,
            state: "stale",
            decisionReason: "review_artifact_changed",
            effectiveReview: {
              source: "default",
              reviewId: b.defaultReview.reviewId,
              contentSha256: b.defaultReview.contentSha256,
              eligibleForDownstreamUse: true,
              downstreamActionAuthorized: false,
            },
          };
          return this.store.write(stale);
        }
      }
      if (b.state === "pending_operator_review") {
        // Remain pending — no auto-acceptance.
        return b;
      }
      const withEffective = { ...b, effectiveReview: computeEffectiveReview(b) };
      return this.store.write(withEffective);
    });
    return recovered;
  }

  attemptDownstreamAction(reviewBundleId: string, action: DownstreamActionAttempt) {
    const bundle = this.requireBundle(reviewBundleId);
    return assertDownstreamActionBlocked(bundle, action);
  }

  /** Reject using execution approval artifact as acceptance. */
  rejectExecutionApprovalAsAcceptance(approval: SeniorApprovalArtifact | null): never {
    void approval;
    throw new Error("execution_approval_is_not_acceptance");
  }

  getBundle(reviewBundleId: string): SeniorReviewBundle | null {
    return this.store.read(reviewBundleId);
  }

  private requireBundle(id: string): SeniorReviewBundle {
    const b = this.store.read(id);
    if (!b) throw new Error(`review_bundle_not_found:${id}`);
    return b;
  }
}

export function createSeniorReviewWorkflow(input: {
  stateRoot: string;
  submitViaS14?: SeniorReviewWorkflowOptions["submitViaS14"];
  cancelViaS14?: SeniorReviewWorkflowOptions["cancelViaS14"];
}): { store: SeniorReviewBundleStore; workflow: SeniorReviewWorkflow } {
  const store = new SeniorReviewBundleStore(input.stateRoot);
  const workflow = new SeniorReviewWorkflow({
    store,
    submitViaS14: input.submitViaS14,
    cancelViaS14: input.cancelViaS14,
  });
  return { store, workflow };
}
