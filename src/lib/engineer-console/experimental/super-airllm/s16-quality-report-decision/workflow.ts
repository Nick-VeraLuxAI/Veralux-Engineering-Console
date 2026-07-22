/** S16 workflow — advisory senior influence over existing quality-report gate. */

import {
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
} from "../../../worker/vera-post-patch-quality-report-types";
import {
  assertArchitectureInvariants,
  assertGatesAreSeparate,
  assertNoAction,
  assertSeniorCannotChangeLifecycle,
  type ForbiddenAction,
} from "./boundaries";
import { DecisionContextStore, newId, sha256Text, utcNow } from "./decision-store";
import {
  buildRecommendationSummary,
  canSeniorInfluence,
  detectStaleness,
  markSeniorStale,
  normalizeSeniorRecommendation,
} from "./influence";
import { buildSeniorQualityReportPrompt } from "./prompt";
import {
  buildDefaultReviewContent,
  recommendationFromQualityReportOverall,
} from "./recommendation";
import type {
  ApplyOperatorDecisionInput,
  AttachAcceptedSeniorInput,
  CreateContextInput,
  QualityReportDecisionContext,
  QualityReportLifecycleDecision,
} from "./types";
import { S15_RUNTIME_ID } from "../s15-senior-review-workflow/types";
import { S16_ARCHITECTURE, S16_DEFAULT_REVIEW_RUNTIME_ID, S16_SCHEMA, S16_TARGET_GATE } from "./types";

export type QualityReportDecisionWorkflowOptions = {
  store: DecisionContextStore;
  /** Optional injected lifecycle applicator (tests / live). */
  applyLifecycleDefault?: ApplyOperatorDecisionInput["applyLifecycle"];
};

export class QualityReportDecisionWorkflow {
  private readonly store: DecisionContextStore;
  private readonly applyLifecycleDefault?: ApplyOperatorDecisionInput["applyLifecycle"];
  private readonly consumedDecisionIds = new Set<string>();

  constructor(options: QualityReportDecisionWorkflowOptions) {
    assertArchitectureInvariants();
    this.store = options.store;
    this.applyLifecycleDefault = options.applyLifecycleDefault;
  }

  /** Scenario 1 path: create context from quality report without senior. */
  createContext(input: CreateContextInput): QualityReportDecisionContext {
    const content =
      input.defaultReviewContent ??
      buildDefaultReviewContent({
        qualityReportSha256: input.qualityReport.artifactSha256,
        overallStatus: input.qualityReport.overallStatus ?? "unknown",
        schemaVersion: input.qualityReport.schemaVersion,
      });
    const recommendation =
      input.defaultRecommendation ??
      recommendationFromQualityReportOverall(input.qualityReport.overallStatus);
    const now = utcNow();
    const context: QualityReportDecisionContext = {
      schema: S16_SCHEMA,
      decisionContextId: newId("s16-ctx"),
      targetGate: S16_TARGET_GATE,
      runId: input.runId,
      taskId: input.taskId,
      workOrderId: input.workOrderId,
      state: "default_only",
      qualityReport: input.qualityReport,
      defaultReview: {
        reviewId: newId("s16-default"),
        runtimeId: S16_DEFAULT_REVIEW_RUNTIME_ID,
        content,
        contentSha256: sha256Text(content),
        recommendation,
        createdAt: now,
      },
      recommendationSummary: {
        defaultRecommendation: recommendation,
        seniorRecommendation: null,
        recommendationsAgree: null,
        disagreements: [],
        unresolvedRisks: [],
      },
      lifecycleEffect: {
        applied: false,
        downstreamEligible: false,
        qualityReportDecision: "pending",
        appliedBySenior: false,
      },
      createdAt: now,
      updatedAt: now,
      revisionGeneration: 0,
    };
    this.store.appendEvent(context.decisionContextId, { event: "context_created" });
    return this.store.write(context);
  }

  buildSeniorPrompt(decisionContextId: string) {
    const ctx = this.store.require(decisionContextId);
    return buildSeniorQualityReportPrompt({
      qualityReportSummary: ctx.defaultReview.content,
      qualityReportSha256: ctx.qualityReport.artifactSha256,
      defaultReviewContent: ctx.defaultReview.content,
      defaultReviewSha256: ctx.defaultReview.contentSha256,
    });
  }

  markSeniorExecutionBlocked(decisionContextId: string): QualityReportDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const next: QualityReportDecisionContext = {
      ...ctx,
      state: "senior_execution_blocked",
    };
    this.store.appendEvent(decisionContextId, { event: "senior_execution_blocked" });
    return this.store.write(next);
  }

  markSeniorRequested(
    decisionContextId: string,
    refs: { s15ReviewBundleId: string; executionApprovalReference: string },
  ): QualityReportDecisionContext {
    assertGatesAreSeparate({});
    const ctx = this.store.require(decisionContextId);
    const next: QualityReportDecisionContext = {
      ...ctx,
      state: "senior_requested",
      s15ReviewBundleId: refs.s15ReviewBundleId,
    };
    this.store.appendEvent(decisionContextId, {
      event: "senior_requested",
      executionApprovalReference: refs.executionApprovalReference,
    });
    return this.store.write(next);
  }

  recordUnacceptedSenior(
    decisionContextId: string,
    input: {
      reviewBundleId: string;
      reviewId: string;
      content: string;
      contentSha256: string;
      comparisonSha256?: string;
      executionApprovalReference: string;
    },
  ): QualityReportDecisionContext {
    const ctx = this.store.require(decisionContextId);
    // Unaccepted senior is preserved but cannot influence.
    const next: QualityReportDecisionContext = {
      ...ctx,
      state: "senior_completed_unaccepted",
      seniorReview: {
        reviewBundleId: input.reviewBundleId,
        reviewId: input.reviewId,
        runtimeId: S15_RUNTIME_ID,
        content: input.content,
        contentSha256: input.contentSha256,
        comparisonSha256: input.comparisonSha256 ?? "",
        executionApprovalReference: input.executionApprovalReference,
        acceptanceDecisionReference: "",
        accepted: false,
        stale: false,
        recommendation: normalizeSeniorRecommendation(input.content),
        createdAt: utcNow(),
      },
      recommendationSummary: buildRecommendationSummary({
        defaultReview: ctx.defaultReview,
        seniorReview: undefined,
      }),
      lifecycleEffect: {
        ...ctx.lifecycleEffect,
        qualityReportDecision: "pending",
        downstreamEligible: false,
        appliedBySenior: false,
      },
    };
    assertSeniorCannotChangeLifecycle(next);
    this.store.appendEvent(decisionContextId, { event: "senior_unaccepted_recorded" });
    return this.store.write(next);
  }

  attachAcceptedSenior(input: AttachAcceptedSeniorInput): QualityReportDecisionContext {
    assertGatesAreSeparate({ usingExecutionApprovalAsAcceptance: false });
    const ctx = this.store.require(input.decisionContextId);
    if (ctx.operatorDecision) {
      throw new Error("cannot_attach_senior_after_operator_decision");
    }
    const recommendation = normalizeSeniorRecommendation(input.content, input.recommendation);
    const senior = {
      reviewBundleId: input.reviewBundleId,
      reviewId: input.reviewId,
      runtimeId: input.runtimeId ?? S15_RUNTIME_ID,
      content: input.content,
      contentSha256: input.contentSha256,
      comparisonSha256: input.comparisonSha256,
      executionApprovalReference: input.executionApprovalReference,
      acceptanceDecisionReference: input.acceptanceDecisionReference,
      accepted: true,
      stale: false,
      recommendation,
      createdAt: utcNow(),
      promptSha256: input.promptSha256,
      generatedTokenIds: input.generatedTokenIds,
      completionReason: input.completionReason,
      s14CorrelationId: input.s14CorrelationId,
      s13RequestId: input.s13RequestId,
    };
    const next: QualityReportDecisionContext = {
      ...ctx,
      state: "senior_accepted_pending_operator",
      s15ReviewBundleId: input.reviewBundleId,
      seniorReview: senior,
      recommendationSummary: buildRecommendationSummary({
        defaultReview: ctx.defaultReview,
        seniorReview: senior,
      }),
      lifecycleEffect: {
        applied: false,
        downstreamEligible: false,
        qualityReportDecision: "pending",
        appliedBySenior: false,
        priorRunStatus: ctx.lifecycleEffect.priorRunStatus,
        priorStep: ctx.lifecycleEffect.priorStep,
      },
    };
    assertSeniorCannotChangeLifecycle(next);
    if (!canSeniorInfluence(next)) {
      throw new Error("senior_influence_precondition_failed");
    }
    this.store.appendEvent(input.decisionContextId, {
      event: "senior_accepted_attached",
      recommendation,
    });
    return this.store.write(next);
  }

  markSeniorFailed(
    decisionContextId: string,
    kind: "cancelled" | "failed",
  ): QualityReportDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const next: QualityReportDecisionContext = {
      ...ctx,
      state: kind === "cancelled" ? "senior_cancelled" : "senior_failed",
      recommendationSummary: buildRecommendationSummary({
        defaultReview: ctx.defaultReview,
        seniorReview: undefined,
      }),
      lifecycleEffect: {
        ...ctx.lifecycleEffect,
        qualityReportDecision: "pending",
        downstreamEligible: false,
        appliedBySenior: false,
      },
    };
    this.store.appendEvent(decisionContextId, { event: `senior_${kind}` });
    return this.store.write(next);
  }

  invalidateForChangedArtifacts(
    decisionContextId: string,
    current: {
      qualityReportSha256: string;
      defaultReviewSha256: string;
      seniorReviewSha256?: string;
      comparisonSha256?: string;
    },
  ): QualityReportDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const { stale, reasons } = detectStaleness(ctx, current);
    if (!stale) return ctx;
    const next = markSeniorStale(ctx, reasons.join(","));
    this.store.appendEvent(decisionContextId, { event: "marked_stale", reasons });
    return this.store.write(next);
  }

  applyOperatorDecision(input: ApplyOperatorDecisionInput): QualityReportDecisionContext {
    assertGatesAreSeparate({
      usingAcceptanceAsLifecycleDecision: false,
      usingExecutionApprovalAsLifecycleDecision: false,
    });
    const ctx = this.store.require(input.decisionContextId);
    if (ctx.state === "stale") {
      throw new Error("stale_decision_context_rejected");
    }
    if (ctx.operatorDecision?.consumed) {
      // Idempotent identical decision
      if (ctx.operatorDecision.decision === input.decision) {
        return ctx;
      }
      throw new Error("conflicting_terminal_decision");
    }
    if (ctx.state === "operator_approved" || ctx.state === "operator_rejected") {
      if (ctx.operatorDecision?.decision === input.decision) return ctx;
      throw new Error("conflicting_terminal_decision");
    }

    if (input.reviewedQualityReportSha256 !== ctx.qualityReport.artifactSha256) {
      throw new Error("quality_report_hash_mismatch");
    }
    if (input.reviewedDefaultReviewSha256 !== ctx.defaultReview.contentSha256) {
      throw new Error("default_review_hash_mismatch");
    }

    const seniorConsidered =
      input.seniorReviewConsidered === true &&
      Boolean(ctx.seniorReview?.accepted && !ctx.seniorReview.stale);

    if (seniorConsidered) {
      if (!ctx.seniorReview) throw new Error("senior_review_missing");
      if (input.reviewedSeniorReviewSha256 !== ctx.seniorReview.contentSha256) {
        throw new Error("senior_review_hash_mismatch");
      }
      if (
        input.reviewedComparisonSha256 &&
        input.reviewedComparisonSha256 !== ctx.seniorReview.comparisonSha256
      ) {
        throw new Error("comparison_hash_mismatch");
      }
    } else if (ctx.seniorReview?.stale && input.seniorReviewConsidered) {
      throw new Error("stale_senior_cannot_influence");
    }

    const expectedConfirm =
      input.decision === "approve_quality_report"
        ? VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION
        : VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION;
    if (input.confirmationText !== expectedConfirm) {
      throw new Error("confirmation_invalid");
    }

    const followed =
      seniorConsidered && ctx.seniorReview
        ? mapLifecycleToRecommendation(input.decision) === ctx.seniorReview.recommendation
        : null;

    const decisionId = newId("s16-op");
    const applyLifecycle = input.applyLifecycle ?? this.applyLifecycleDefault;
    if (!applyLifecycle) {
      throw new Error("lifecycle_applicator_required");
    }

    const priorStatus = ctx.lifecycleEffect.priorRunStatus ?? "waiting_for_approval";
    const priorStep = ctx.lifecycleEffect.priorStep;
    const lifecycleResult = applyLifecycle({
      runId: ctx.runId,
      decision: input.decision === "approve_quality_report" ? "approved" : "rejected",
      confirmationText: input.confirmationText,
      reviewer: input.operatorId ?? "operator",
      reviewerNote: input.reason ?? null,
    });

    const next: QualityReportDecisionContext = {
      ...ctx,
      state: input.decision === "approve_quality_report" ? "operator_approved" : "operator_rejected",
      operatorDecision: {
        decisionId,
        decision: input.decision,
        operatorId: input.operatorId,
        reason: input.reason,
        decidedAt: utcNow(),
        reviewedQualityReportSha256: input.reviewedQualityReportSha256,
        reviewedDefaultReviewSha256: input.reviewedDefaultReviewSha256,
        reviewedSeniorReviewSha256: input.reviewedSeniorReviewSha256,
        reviewedComparisonSha256: input.reviewedComparisonSha256,
        seniorReviewConsidered: seniorConsidered,
        followedSeniorRecommendation: followed,
        confirmationText: input.confirmationText,
        consumed: true,
      },
      lifecycleEffect: {
        applied: true,
        priorRunStatus: priorStatus,
        resultingRunStatus: lifecycleResult.runStatus,
        priorStep,
        resultingStep: lifecycleResult.nextStep,
        downstreamEligible: input.decision === "approve_quality_report",
        qualityReportDecision: input.decision === "approve_quality_report" ? "approved" : "rejected",
        appliedBySenior: false,
      },
    };
    this.consumedDecisionIds.add(decisionId);
    this.store.appendEvent(input.decisionContextId, {
      event: "operator_decision_applied",
      decision: input.decision,
      followedSeniorRecommendation: followed,
      seniorReviewConsidered: seniorConsidered,
    });
    return this.store.write(next);
  }

  attemptForbiddenAction(action: ForbiddenAction) {
    return assertNoAction(action);
  }

  recover(): QualityReportDecisionContext[] {
    const all = this.store.list();
    // Do not auto-approve or auto-reject; return pending contexts for operator.
    return all.filter(
      (c) =>
        !c.lifecycleEffect.applied &&
        (c.state === "default_only" ||
          c.state === "senior_accepted_pending_operator" ||
          c.state === "senior_completed_unaccepted" ||
          c.state === "senior_requested" ||
          c.state === "senior_execution_blocked"),
    );
  }
}

function mapLifecycleToRecommendation(
  decision: QualityReportLifecycleDecision,
): "approve" | "reject" {
  return decision === "approve_quality_report" ? "approve" : "reject";
}

export function createQualityReportDecisionWorkflow(input: {
  stateRoot: string;
  applyLifecycleDefault?: ApplyOperatorDecisionInput["applyLifecycle"];
}): { workflow: QualityReportDecisionWorkflow; store: DecisionContextStore } {
  const store = new DecisionContextStore(input.stateRoot);
  const workflow = new QualityReportDecisionWorkflow({
    store,
    applyLifecycleDefault: input.applyLifecycleDefault,
  });
  return { workflow, store };
}

export { S16_ARCHITECTURE };
