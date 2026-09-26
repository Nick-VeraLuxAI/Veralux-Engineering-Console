/**
 * S16 gated senior influence on quality-report decision tests.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  S16_ARCHITECTURE,
  createQualityReportDecisionWorkflow,
  extractRecommendation,
  assertNoAction,
  assertGatesAreSeparate,
  sha256Text,
  type QualityReportDecisionContext,
} from "./s16-quality-report-decision";
import {
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
  VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
} from "../../worker/vera-post-patch-quality-report-types";

import { createSeniorReviewWorkflow } from "./s15-senior-review-workflow";

let roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "s16-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  roots = [];
});

function sampleReport(sha = "qr-hash-aaa") {
  return {
    artifactPath: `/tmp/runs/r1/post-patch-quality-report.json`,
    artifactSha256: sha,
    schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    overallStatus: "passed",
  };
}

function mockLifecycle(calls: Array<Record<string, unknown>>) {
  return (input: {
    runId: string;
    decision: "approved" | "rejected";
    confirmationText: string;
    reviewer: string;
  }) => {
    calls.push(input);
    return {
      nextStep:
        input.decision === "approved"
          ? VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP
          : VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
      runStatus: "waiting_for_approval",
      priorStep: "implementation_post_patch_quality_gates_completed",
      priorStatus: "waiting_for_approval",
    };
  };
}

describe("S16 quality-report decision", () => {
  it("targets only the quality-report gate and keeps architecture truthful", () => {
    expect(S16_ARCHITECTURE.targetGate).toBe("post_patch_quality_report_decision");
    expect(S16_ARCHITECTURE.usesS15NotS14OrS13Direct).toBe(true);
    expect(S16_ARCHITECTURE.allocatesCuda).toBe(false);
    expect(S16_ARCHITECTURE.stopsNano).toBe(false);
    expect(S16_ARCHITECTURE.nativeFp8KernelProven).toBe(false);
    expect(S16_ARCHITECTURE.maxNewTokens).toBe(32);
    expect(S16_ARCHITECTURE.automaticSeniorSelection).toBe(false);
    expect(S16_ARCHITECTURE.defaultSeniorRoute).toBe(false);
  });

  it("scenario1: default-only approval path unchanged (no senior)", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    const ctx = workflow.createContext({ runId: "run-1", qualityReport: sampleReport() });
    expect(ctx.state).toBe("default_only");
    expect(ctx.lifecycleEffect.qualityReportDecision).toBe("pending");
    expect(ctx.lifecycleEffect.downstreamEligible).toBe(false);
    expect(ctx.seniorReview).toBeUndefined();

    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      operatorId: "op-1",
    });
    expect(applied.state).toBe("operator_approved");
    expect(applied.lifecycleEffect.applied).toBe(true);
    expect(applied.lifecycleEffect.resultingStep).toBe(
      VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
    );
    expect(applied.lifecycleEffect.appliedBySenior).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("scenario2: senior without execution approval blocked; default path remains", () => {
    const { workflow } = createQualityReportDecisionWorkflow({ stateRoot: tempRoot() });
    const ctx = workflow.createContext({ runId: "run-2", qualityReport: sampleReport() });
    const blocked = workflow.markSeniorExecutionBlocked(ctx.decisionContextId);
    expect(blocked.state).toBe("senior_execution_blocked");
    expect(blocked.lifecycleEffect.qualityReportDecision).toBe("pending");
  });

  it("scenario3: unaccepted senior cannot influence", () => {
    const { workflow } = createQualityReportDecisionWorkflow({ stateRoot: tempRoot() });
    const ctx = workflow.createContext({ runId: "run-3", qualityReport: sampleReport() });
    const next = workflow.recordUnacceptedSenior(ctx.decisionContextId, {
      reviewBundleId: "b1",
      reviewId: "s1",
      content: "recommendation: approve",
      contentSha256: sha256Text("recommendation: approve"),
      executionApprovalReference: "exec-1",
    });
    expect(next.state).toBe("senior_completed_unaccepted");
    expect(next.seniorReview?.accepted).toBe(false);
    expect(next.recommendationSummary.seniorRecommendation).toBeNull();
    expect(next.lifecycleEffect.downstreamEligible).toBe(false);
  });

  it("scenario4: accepted senior recommend approve; operator still required; then approve", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    let ctx = workflow.createContext({ runId: "run-4", qualityReport: sampleReport() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b4",
      reviewId: "s4",
      content: "recommendation: approve\nfinding: none",
      contentSha256: sha256Text("recommendation: approve\nfinding: none"),
      comparisonSha256: "cmp-4",
      executionApprovalReference: "exec-4",
      acceptanceDecisionReference: "acc-4",
    });
    expect(ctx.state).toBe("senior_accepted_pending_operator");
    expect(ctx.lifecycleEffect.qualityReportDecision).toBe("pending");
    expect(ctx.lifecycleEffect.downstreamEligible).toBe(false);
    expect(ctx.recommendationSummary.seniorRecommendation).toBe("approve");

    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-4",
      seniorReviewConsidered: true,
      operatorId: "op-4",
    });
    expect(applied.operatorDecision?.followedSeniorRecommendation).toBe(true);
    expect(applied.lifecycleEffect.appliedBySenior).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("scenario5+6: senior reject visible; operator may override to approve", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    let ctx = workflow.createContext({ runId: "run-5", qualityReport: sampleReport() });
    const content = "recommendation: reject\nfinding: missing tests";
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b5",
      reviewId: "s5",
      content,
      contentSha256: sha256Text(content),
      comparisonSha256: "cmp-5",
      executionApprovalReference: "exec-5",
      acceptanceDecisionReference: "acc-5",
    });
    expect(ctx.recommendationSummary.seniorRecommendation).toBe("reject");
    expect(ctx.lifecycleEffect.qualityReportDecision).toBe("pending");

    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-5",
      seniorReviewConsidered: true,
    });
    expect(applied.operatorDecision?.followedSeniorRecommendation).toBe(false);
    expect(applied.recommendationSummary.disagreements.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it("scenario7: operator overrides senior approve with reject", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    let ctx = workflow.createContext({ runId: "run-7", qualityReport: sampleReport() });
    const content = "recommendation: approve";
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b7",
      reviewId: "s7",
      content,
      contentSha256: sha256Text(content),
      comparisonSha256: "cmp-7",
      executionApprovalReference: "exec-7",
      acceptanceDecisionReference: "acc-7",
    });
    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "reject_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-7",
      seniorReviewConsidered: true,
    });
    expect(applied.state).toBe("operator_rejected");
    expect(applied.operatorDecision?.followedSeniorRecommendation).toBe(false);
    expect(applied.lifecycleEffect.downstreamEligible).toBe(false);
  });

  it("scenario8: stale report excludes senior and rejects old hashes", () => {
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle([]),
    });
    let ctx = workflow.createContext({ runId: "run-8", qualityReport: sampleReport("hash-old") });
    const content = "recommendation: approve";
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b8",
      reviewId: "s8",
      content,
      contentSha256: sha256Text(content),
      comparisonSha256: "cmp-8",
      executionApprovalReference: "exec-8",
      acceptanceDecisionReference: "acc-8",
    });
    const stale = workflow.invalidateForChangedArtifacts(ctx.decisionContextId, {
      qualityReportSha256: "hash-new",
      defaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    expect(stale.state).toBe("stale");
    expect(stale.seniorReview?.stale).toBe(true);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "approve_quality_report",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewedQualityReportSha256: "hash-old",
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
        reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
        seniorReviewConsidered: true,
      }),
    ).toThrow(/stale/i);
  });

  it("scenario10+11: idempotent duplicate approve; conflicting reject rejected", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    const ctx = workflow.createContext({ runId: "run-10", qualityReport: sampleReport() });
    const first = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    const second = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    expect(second.operatorDecision?.decisionId).toBe(first.operatorDecision?.decisionId);
    expect(calls).toHaveLength(1);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "reject_quality_report",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
        reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      }),
    ).toThrow(/conflicting/i);
  });

  it("scenario12: senior failure preserves default path", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    let ctx = workflow.createContext({ runId: "run-12", qualityReport: sampleReport() });
    ctx = workflow.markSeniorFailed(ctx.decisionContextId, "cancelled");
    expect(ctx.state).toBe("senior_cancelled");
    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    expect(applied.state).toBe("operator_approved");
    expect(calls).toHaveLength(1);
  });

  it("scenario13: recover returns pending contexts without auto-approve", () => {
    const { workflow } = createQualityReportDecisionWorkflow({ stateRoot: tempRoot() });
    workflow.createContext({ runId: "run-13a", qualityReport: sampleReport("a") });
    let ctx = workflow.createContext({ runId: "run-13b", qualityReport: sampleReport("b") });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b13",
      reviewId: "s13",
      content: "recommendation: approve",
      contentSha256: sha256Text("recommendation: approve"),
      comparisonSha256: "cmp-13",
      executionApprovalReference: "exec-13",
      acceptanceDecisionReference: "acc-13",
    });
    const pending = workflow.recover();
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.every((c: QualityReportDecisionContext) => !c.lifecycleEffect.applied)).toBe(true);
  });

  it("scenario14: no-action boundary rejects patch/commit/pr/merge/deploy", () => {
    const { workflow } = createQualityReportDecisionWorkflow({ stateRoot: tempRoot() });
    for (const action of ["apply_patch", "git_commit", "create_pr", "merge", "deploy"] as const) {
      const r = workflow.attemptForbiddenAction(action);
      expect(r.allowed).toBe(false);
      expect(r.counters[action]).toBe(0);
    }
    expect(assertNoAction("apply_patch").allowed).toBe(false);
  });

  it("gate substitution assertions", () => {
    expect(() =>
      assertGatesAreSeparate({ usingExecutionApprovalAsAcceptance: true }),
    ).toThrow(/execution_approval_is_not_acceptance/);
    expect(() =>
      assertGatesAreSeparate({ usingAcceptanceAsLifecycleDecision: true }),
    ).toThrow(/acceptance_is_not_lifecycle_decision/);
  });

  it("recommendation extraction: explicit only; invalid → neutral", () => {
    expect(extractRecommendation("recommendation: approve")).toBe("approve");
    expect(extractRecommendation("recommendation: reject")).toBe("reject");
    expect(extractRecommendation("recommendation: needs_revision")).toBe("needs_revision");
    expect(extractRecommendation("this looks good, ship it")).toBe("neutral");
    expect(extractRecommendation("APPROVE")).toBe("neutral");
  });

  it("S16 uses S15 workflow types without calling S13", () => {
    const { workflow: s15 } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    const bundle = s15.createDefaultReview({
      runId: "s15-bridge",
      defaultContent: "finding: x\nrecommend: y",
    });
    expect(bundle.effectiveReview.downstreamActionAuthorized).toBe(false);
    expect(S16_ARCHITECTURE.usesS15NotS14OrS13Direct).toBe(true);
  });

  it("accepted senior cannot set approved hash or run step by itself", () => {
    const { workflow } = createQualityReportDecisionWorkflow({ stateRoot: tempRoot() });
    let ctx = workflow.createContext({ runId: "run-bound", qualityReport: sampleReport() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "bb",
      reviewId: "ss",
      content: "recommendation: approve",
      contentSha256: sha256Text("recommendation: approve"),
      comparisonSha256: "cmp",
      executionApprovalReference: "exec",
      acceptanceDecisionReference: "acc",
    });
    expect(ctx.lifecycleEffect.resultingStep).toBeUndefined();
    expect(ctx.lifecycleEffect.qualityReportDecision).toBe("pending");
    expect(ctx.lifecycleEffect.appliedBySenior).toBe(false);
  });

  it("operator decision validates quality-report and default-review hashes", () => {
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle([]),
    });
    const ctx = workflow.createContext({ runId: "run-hash", qualityReport: sampleReport() });
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "approve_quality_report",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewedQualityReportSha256: "wrong-qr",
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      }),
    ).toThrow(/quality_report_hash_mismatch/);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "approve_quality_report",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
        reviewedDefaultReviewSha256: "wrong-default",
      }),
    ).toThrow(/default_review_hash_mismatch/);
  });

  it("operator considering senior must validate senior and comparison hashes", () => {
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle([]),
    });
    let ctx = workflow.createContext({ runId: "run-shash", qualityReport: sampleReport() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b",
      reviewId: "s",
      content: "recommendation: neutral",
      contentSha256: sha256Text("recommendation: neutral"),
      comparisonSha256: "cmp-ok",
      executionApprovalReference: "exec",
      acceptanceDecisionReference: "acc",
    });
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "approve_quality_report",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
        seniorReviewConsidered: true,
        reviewedSeniorReviewSha256: "wrong-senior",
        reviewedComparisonSha256: "cmp-ok",
      }),
    ).toThrow(/senior_review_hash_mismatch/);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "approve_quality_report",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
        seniorReviewConsidered: true,
        reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
        reviewedComparisonSha256: "wrong-cmp",
      }),
    ).toThrow(/comparison_hash_mismatch/);
  });

  it("unaccepted senior leaves default-only operator path; neutral remains valid", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createQualityReportDecisionWorkflow({
      stateRoot: tempRoot(),
      applyLifecycleDefault: mockLifecycle(calls),
    });
    let ctx = workflow.createContext({ runId: "run-neutral", qualityReport: sampleReport() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "bn",
      reviewId: "sn",
      content: "recommendation: neutral",
      contentSha256: sha256Text("recommendation: neutral"),
      comparisonSha256: "cmp-n",
      executionApprovalReference: "exec-n",
      acceptanceDecisionReference: "acc-n",
    });
    expect(ctx.recommendationSummary.seniorRecommendation).toBe("neutral");
    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "reject_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
      reviewedQualityReportSha256: ctx.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-n",
      seniorReviewConsidered: true,
    });
    expect(applied.operatorDecision?.followedSeniorRecommendation).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("default-review change marks senior stale", () => {
    const { workflow } = createQualityReportDecisionWorkflow({ stateRoot: tempRoot() });
    let ctx = workflow.createContext({ runId: "run-dr", qualityReport: sampleReport() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "bd",
      reviewId: "sd",
      content: "recommendation: approve",
      contentSha256: sha256Text("recommendation: approve"),
      comparisonSha256: "cmp-d",
      executionApprovalReference: "exec-d",
      acceptanceDecisionReference: "acc-d",
    });
    const stale = workflow.invalidateForChangedArtifacts(ctx.decisionContextId, {
      qualityReportSha256: ctx.qualityReport.artifactSha256,
      defaultReviewSha256: "changed-default",
    });
    expect(stale.seniorReview?.stale).toBe(true);
    expect(stale.state).toBe("stale");
  });
});
