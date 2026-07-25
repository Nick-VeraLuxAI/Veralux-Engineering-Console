/** S17 workflow — advisory senior influence over existing PR-readiness (Phase 2X) gate. */

import {
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
} from "../../../worker/vera-pull-request-preparation-types";
import {
  assertArchitectureInvariants,
  assertGatesAreSeparate,
  assertNoAction,
  assertSeniorCannotChangeLifecycle,
  type ForbiddenAction,
} from "./boundaries";
import { PrReadinessDecisionStore, newId, sha256Text, utcNow } from "./decision-store";
import {
  buildRecommendationSummary,
  canSeniorInfluence,
  detectStaleness,
  markSeniorStale,
} from "./influence";
import { buildSeniorPrReadinessPrompt } from "./prompt";
import { buildDefaultReviewContent, extractRecommendation } from "./recommendation";
import type {
  ApplyOperatorDecisionInput,
  AttachAcceptedSeniorInput,
  CreateContextInput,
  PrReadinessDecisionContext,
  PrReadinessLifecycleDecision,
  PrReadinessRecommendation,
} from "./types";
import {
  S17_ARCHITECTURE,
  S17_DEFAULT_REVIEW_RUNTIME_ID,
  S17_SCHEMA,
  S17_TARGET_GATE,
} from "./types";

export type PrReadinessDecisionWorkflowOptions = {
  store: PrReadinessDecisionStore;
  applyLifecycleDefault?: ApplyOperatorDecisionInput["applyLifecycle"];
};

function mapDecisionToRecommendation(
  decision: PrReadinessLifecycleDecision,
): PrReadinessRecommendation {
  if (decision === "mark_pr_ready") return "ready";
  if (decision === "mark_pr_not_ready") return "not_ready";
  return "needs_revision";
}

function mapDecisionToReadinessState(decision: PrReadinessLifecycleDecision) {
  if (decision === "mark_pr_ready") return "ready" as const;
  if (decision === "mark_pr_not_ready") return "not_ready" as const;
  return "revision_requested" as const;
}

function mapDecisionToContextState(decision: PrReadinessLifecycleDecision) {
  if (decision === "mark_pr_ready") return "operator_ready" as const;
  if (decision === "mark_pr_not_ready") return "operator_not_ready" as const;
  return "operator_revision_requested" as const;
}

export class PrReadinessDecisionWorkflow {
  private readonly store: PrReadinessDecisionStore;
  private readonly applyLifecycleDefault?: ApplyOperatorDecisionInput["applyLifecycle"];
  private readonly consumedDecisionIds = new Set<string>();

  constructor(options: PrReadinessDecisionWorkflowOptions) {
    assertArchitectureInvariants();
    this.store = options.store;
    this.applyLifecycleDefault = options.applyLifecycleDefault;
  }

  /** Scenario 1 path: create context from PR preparation without senior. */
  createContext(input: CreateContextInput): PrReadinessDecisionContext {
    const content =
      input.defaultReviewContent ??
      buildDefaultReviewContent({
        prPreparationSha256: input.prPreparation.artifactSha256,
        qualityReportSha256: input.qualityReportSha256,
        branchName: input.branchName,
        commitSha: input.targetCommit,
        schemaVersion: input.prPreparation.schemaVersion,
      });
    const recommendation = input.defaultRecommendation ?? extractRecommendation(content);
    const now = utcNow();
    const branchName = input.branchName ?? input.prPreparation.branchName;
    const targetCommit = input.targetCommit ?? input.prPreparation.commitSha;
    const qualityReportSha256 =
      input.qualityReportSha256 ?? input.prPreparation.qualityReportSha256;
    const context: PrReadinessDecisionContext = {
      schema: S17_SCHEMA,
      decisionContextId: newId("s17-ctx"),
      targetGate: S17_TARGET_GATE,
      runId: input.runId,
      taskId: input.taskId,
      workOrderId: input.workOrderId,
      targetRepository: input.targetRepository,
      branchName,
      targetCommit,
      state: "default_only",
      qualityReportSha256,
      prPreparation: input.prPreparation,
      defaultReview: {
        reviewId: newId("s17-default"),
        runtimeId: S17_DEFAULT_REVIEW_RUNTIME_ID,
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
        prReadinessDecision: "pending",
        prCreationAuthorized: false,
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
    return buildSeniorPrReadinessPrompt({
      prPreparationSummary: ctx.defaultReview.content,
      prPreparationSha256: ctx.prPreparation.artifactSha256,
      qualityReportSha256: ctx.qualityReportSha256,
      defaultReviewContent: ctx.defaultReview.content,
      defaultReviewSha256: ctx.defaultReview.contentSha256,
      branchName: ctx.branchName,
      commitSha: ctx.targetCommit,
    });
  }

  markSeniorExecutionBlocked(decisionContextId: string): PrReadinessDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const next: PrReadinessDecisionContext = { ...ctx, state: "senior_execution_blocked" };
    this.store.appendEvent(decisionContextId, { event: "senior_execution_blocked" });
    return this.store.write(next);
  }

  markSeniorRequested(
    decisionContextId: string,
    refs: { s15ReviewBundleId: string; executionApprovalReference: string },
  ): PrReadinessDecisionContext {
    assertGatesAreSeparate({});
    const ctx = this.store.require(decisionContextId);
    const next: PrReadinessDecisionContext = {
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
  ): PrReadinessDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const next: PrReadinessDecisionContext = {
      ...ctx,
      state: "senior_completed_unaccepted",
      s15ReviewBundleId: input.reviewBundleId,
      seniorReview: {
        reviewBundleId: input.reviewBundleId,
        reviewId: input.reviewId,
        runtimeId: S17_ARCHITECTURE.seniorRuntimeId,
        content: input.content,
        contentSha256: input.contentSha256,
        comparisonSha256: input.comparisonSha256 ?? "",
        executionApprovalReference: input.executionApprovalReference,
        acceptanceDecisionReference: "",
        accepted: false,
        stale: false,
        recommendation: extractRecommendation(input.content),
        createdAt: utcNow(),
      },
      // Unaccepted senior must not influence the summary.
      recommendationSummary: buildRecommendationSummary({
        defaultReview: ctx.defaultReview,
        seniorReview: undefined,
      }),
    };
    this.store.appendEvent(decisionContextId, { event: "senior_completed_unaccepted" });
    return this.store.write(next);
  }

  attachAcceptedSenior(input: AttachAcceptedSeniorInput): PrReadinessDecisionContext {
    assertGatesAreSeparate({ usingAcceptanceAsReadinessDecision: false });
    const ctx = this.store.require(input.decisionContextId);
    const recommendation = input.recommendation ?? extractRecommendation(input.content);
    const senior = {
      reviewBundleId: input.reviewBundleId,
      reviewId: input.reviewId,
      runtimeId: input.runtimeId ?? S17_ARCHITECTURE.seniorRuntimeId,
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
    const next: PrReadinessDecisionContext = {
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
        prReadinessDecision: "pending",
        prCreationAuthorized: false,
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
  ): PrReadinessDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const next: PrReadinessDecisionContext = {
      ...ctx,
      state: kind === "cancelled" ? "senior_cancelled" : "senior_failed",
      recommendationSummary: buildRecommendationSummary({
        defaultReview: ctx.defaultReview,
        seniorReview: undefined,
      }),
      lifecycleEffect: {
        ...ctx.lifecycleEffect,
        prReadinessDecision: "pending",
        appliedBySenior: false,
      },
    };
    this.store.appendEvent(decisionContextId, { event: `senior_${kind}` });
    return this.store.write(next);
  }

  invalidateForChangedArtifacts(
    decisionContextId: string,
    current: {
      prPreparationSha256: string;
      defaultReviewSha256: string;
      qualityReportSha256?: string;
      branchName?: string;
      commitSha?: string;
      seniorReviewSha256?: string;
      comparisonSha256?: string;
    },
  ): PrReadinessDecisionContext {
    const ctx = this.store.require(decisionContextId);
    const { stale, reasons } = detectStaleness(ctx, current);
    if (!stale) return ctx;
    const next = markSeniorStale(ctx, reasons.join(","));
    this.store.appendEvent(decisionContextId, { event: "marked_stale", reasons });
    return this.store.write(next);
  }

  applyOperatorDecision(input: ApplyOperatorDecisionInput): PrReadinessDecisionContext {
    assertGatesAreSeparate({
      usingAcceptanceAsReadinessDecision: false,
      usingExecutionApprovalAsReadinessDecision: false,
      usingReadinessDecisionAsPrCreation: false,
    });
    const ctx = this.store.require(input.decisionContextId);
    if (ctx.state === "stale") {
      throw new Error("stale_decision_context_rejected");
    }
    const terminalStates = ["operator_ready", "operator_not_ready", "operator_revision_requested"];
    if (ctx.operatorDecision?.consumed) {
      if (ctx.operatorDecision.decision === input.decision) return ctx;
      throw new Error("conflicting_terminal_decision");
    }
    if (terminalStates.includes(ctx.state)) {
      if (ctx.operatorDecision?.decision === input.decision) return ctx;
      throw new Error("conflicting_terminal_decision");
    }

    if (input.reviewedPrPreparationSha256 !== ctx.prPreparation.artifactSha256) {
      throw new Error("pr_preparation_hash_mismatch");
    }
    if (input.reviewedDefaultReviewSha256 !== ctx.defaultReview.contentSha256) {
      throw new Error("default_review_hash_mismatch");
    }
    if (
      input.reviewedQualityReportSha256 &&
      ctx.qualityReportSha256 &&
      input.reviewedQualityReportSha256 !== ctx.qualityReportSha256
    ) {
      throw new Error("quality_report_hash_mismatch");
    }
    if (input.reviewedBranchName && ctx.branchName && input.reviewedBranchName !== ctx.branchName) {
      throw new Error("branch_mismatch");
    }
    if (input.reviewedCommitSha && ctx.targetCommit && input.reviewedCommitSha !== ctx.targetCommit) {
      throw new Error("commit_mismatch");
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

    // mark_pr_ready requires the exact 2X confirmation phrase for the lifecycle prepare.
    if (input.decision === "mark_pr_ready") {
      if (input.confirmationText !== VERA_PULL_REQUEST_PREPARATION_CONFIRMATION) {
        throw new Error("confirmation_invalid");
      }
    }

    const followed =
      seniorConsidered && ctx.seniorReview
        ? mapDecisionToRecommendation(input.decision) === ctx.seniorReview.recommendation
        : null;

    const decisionId = newId("s17-op");
    const applyLifecycle = input.applyLifecycle ?? this.applyLifecycleDefault;
    if (!applyLifecycle) {
      throw new Error("lifecycle_applicator_required");
    }

    const priorStatus = ctx.lifecycleEffect.priorRunStatus ?? "waiting_for_approval";
    const priorStep = ctx.lifecycleEffect.priorStep;
    const lifecycleResult = applyLifecycle({
      runId: ctx.runId,
      decision: input.decision,
      confirmationText: input.confirmationText ?? "",
      requestedBy: input.operatorId ?? "operator",
      note: input.reason ?? null,
    });

    const readinessState = mapDecisionToReadinessState(input.decision);
    const next: PrReadinessDecisionContext = {
      ...ctx,
      state: mapDecisionToContextState(input.decision),
      operatorDecision: {
        decisionId,
        decision: input.decision,
        operatorId: input.operatorId,
        reason: input.reason,
        decidedAt: utcNow(),
        reviewedPrPreparationSha256: input.reviewedPrPreparationSha256,
        reviewedDefaultReviewSha256: input.reviewedDefaultReviewSha256,
        reviewedQualityReportSha256: input.reviewedQualityReportSha256,
        reviewedBranchName: input.reviewedBranchName,
        reviewedCommitSha: input.reviewedCommitSha,
        reviewedSeniorReviewSha256: input.reviewedSeniorReviewSha256,
        reviewedComparisonSha256: input.reviewedComparisonSha256,
        seniorReviewConsidered: seniorConsidered,
        followedSeniorRecommendation: followed,
        confirmationText: input.confirmationText,
        consumed: true,
      },
      lifecycleEffect: {
        applied: input.decision === "mark_pr_ready",
        priorRunStatus: priorStatus,
        resultingRunStatus: lifecycleResult.runStatus,
        priorStep,
        resultingStep: lifecycleResult.nextStep,
        prReadinessDecision: readinessState,
        prCreationAuthorized: false,
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

  recover(): PrReadinessDecisionContext[] {
    const all = this.store.list();
    return all.filter(
      (c) =>
        !c.lifecycleEffect.applied &&
        (c.state === "default_only" ||
          c.state === "senior_accepted_pending_operator" ||
          c.state === "senior_completed_unaccepted" ||
          c.state === "senior_requested" ||
          c.state === "senior_execution_blocked" ||
          c.state === "operator_not_ready" ||
          c.state === "operator_revision_requested"),
    );
  }
}

export function createPrReadinessDecisionWorkflow(input: {
  stateRoot: string;
  applyLifecycleDefault?: ApplyOperatorDecisionInput["applyLifecycle"];
}): { workflow: PrReadinessDecisionWorkflow; store: PrReadinessDecisionStore } {
  const store = new PrReadinessDecisionStore(input.stateRoot);
  const workflow = new PrReadinessDecisionWorkflow({
    store,
    applyLifecycleDefault: input.applyLifecycleDefault,
  });
  return { workflow, store };
}

export { S17_ARCHITECTURE };
