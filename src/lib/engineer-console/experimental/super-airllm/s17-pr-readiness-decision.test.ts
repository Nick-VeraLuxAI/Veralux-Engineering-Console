/**
 * S17 gated senior influence on PR-readiness (Phase 2X) decision tests.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  S17_ARCHITECTURE,
  createPrReadinessDecisionWorkflow,
  extractRecommendation,
  assertNoAction,
  assertGatesAreSeparate,
  sha256Text,
  type PrReadinessDecisionContext,
} from "./s17-pr-readiness-decision";
import {
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
  VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
  VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
} from "../../worker/vera-pull-request-preparation-types";
import { createSeniorReviewWorkflow } from "./s15-senior-review-workflow";

let roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "s17-"));
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

function samplePrep(sha = "prep-hash-aaa") {
  return {
    artifactPath: "/tmp/runs/r1/implementation-pull-request-preparation.json",
    artifactSha256: sha,
    schemaVersion: VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    branchName: "feature/x",
    commitSha: "abc123",
    qualityReportSha256: "qr-hash",
  };
}

/** Mock that emulates the Phase 2X prepare on mark_pr_ready, no-op otherwise. */
function mockLifecycle(calls: Array<Record<string, unknown>>) {
  return (input: {
    runId: string;
    decision: "mark_pr_ready" | "mark_pr_not_ready" | "request_pr_readiness_revision";
    confirmationText: string;
    requestedBy: string;
    note?: string | null;
  }) => {
    calls.push(input);
    if (input.decision === "mark_pr_ready") {
      return {
        nextStep: VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
        runStatus: "waiting_for_approval",
        priorStep: "implementation_commit_created",
        priorStatus: "waiting_for_approval",
      };
    }
    return {
      nextStep: "implementation_commit_created",
      runStatus: "waiting_for_approval",
      priorStep: "implementation_commit_created",
      priorStatus: "waiting_for_approval",
    };
  };
}

function createReady(root: string, calls: Array<Record<string, unknown>>) {
  return createPrReadinessDecisionWorkflow({
    stateRoot: root,
    applyLifecycleDefault: mockLifecycle(calls),
  });
}

describe("S17 PR-readiness decision", () => {
  it("targets only the PR-readiness gate and keeps architecture truthful", () => {
    expect(S17_ARCHITECTURE.targetGate).toBe("pull_request_readiness_decision");
    expect(S17_ARCHITECTURE.usesS15NotS14OrS13Direct).toBe(true);
    expect(S17_ARCHITECTURE.allocatesCuda).toBe(false);
    expect(S17_ARCHITECTURE.stopsNano).toBe(false);
    expect(S17_ARCHITECTURE.nativeFp8KernelProven).toBe(false);
    expect(S17_ARCHITECTURE.maxNewTokens).toBe(32);
    expect(S17_ARCHITECTURE.automaticSeniorSelection).toBe(false);
    expect(S17_ARCHITECTURE.defaultSeniorRoute).toBe(false);
    expect(S17_ARCHITECTURE.seniorMayCreatePullRequest).toBe(false);
    expect(S17_ARCHITECTURE.prCreationRemainsSeparatelyGated).toBe(true);
  });

  it("scenario1: default-only PR readiness path unchanged (no senior)", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    const ctx = workflow.createContext({ runId: "run-1", prPreparation: samplePrep() });
    expect(ctx.state).toBe("default_only");
    expect(ctx.lifecycleEffect.prReadinessDecision).toBe("pending");
    expect(ctx.lifecycleEffect.prCreationAuthorized).toBe(false);
    expect(ctx.seniorReview).toBeUndefined();

    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      operatorId: "op-1",
    });
    expect(applied.state).toBe("operator_ready");
    expect(applied.lifecycleEffect.applied).toBe(true);
    expect(applied.lifecycleEffect.resultingStep).toBe(
      VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
    );
    expect(applied.lifecycleEffect.prReadinessDecision).toBe("ready");
    expect(applied.lifecycleEffect.prCreationAuthorized).toBe(false);
    expect(applied.lifecycleEffect.appliedBySenior).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("scenario1b: mark_pr_ready requires exact 2X confirmation", () => {
    const { workflow } = createReady(tempRoot(), []);
    const ctx = workflow.createContext({ runId: "run-1b", prPreparation: samplePrep() });
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "mark_pr_ready",
        confirmationText: "prepare vera pull request",
        reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      }),
    ).toThrow(/confirmation_invalid/);
  });

  it("scenario2: senior without execution approval blocked; default path remains", () => {
    const { workflow } = createReady(tempRoot(), []);
    const ctx = workflow.createContext({ runId: "run-2", prPreparation: samplePrep() });
    const blocked = workflow.markSeniorExecutionBlocked(ctx.decisionContextId);
    expect(blocked.state).toBe("senior_execution_blocked");
    expect(blocked.lifecycleEffect.prReadinessDecision).toBe("pending");
  });

  it("scenario3: unaccepted senior cannot influence", () => {
    const { workflow } = createReady(tempRoot(), []);
    const ctx = workflow.createContext({ runId: "run-3", prPreparation: samplePrep() });
    const next = workflow.recordUnacceptedSenior(ctx.decisionContextId, {
      reviewBundleId: "b1",
      reviewId: "s1",
      content: "recommendation: ready",
      contentSha256: sha256Text("recommendation: ready"),
      executionApprovalReference: "exec-1",
    });
    expect(next.state).toBe("senior_completed_unaccepted");
    expect(next.seniorReview?.accepted).toBe(false);
    expect(next.recommendationSummary.seniorRecommendation).toBeNull();
    expect(next.lifecycleEffect.prReadinessDecision).toBe("pending");
  });

  it("scenario4: accepted senior recommend ready; operator still required; then mark ready", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    let ctx = workflow.createContext({ runId: "run-4", prPreparation: samplePrep() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b4",
      reviewId: "s4",
      content: "recommendation: ready\nfinding: none",
      contentSha256: sha256Text("recommendation: ready\nfinding: none"),
      comparisonSha256: "cmp-4",
      executionApprovalReference: "exec-4",
      acceptanceDecisionReference: "acc-4",
    });
    expect(ctx.state).toBe("senior_accepted_pending_operator");
    expect(ctx.lifecycleEffect.prReadinessDecision).toBe("pending");
    expect(ctx.recommendationSummary.seniorRecommendation).toBe("ready");

    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
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

  it("scenario5+6: senior not_ready visible; operator may override to ready", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    let ctx = workflow.createContext({
      runId: "run-5",
      prPreparation: samplePrep(),
      defaultRecommendation: "ready",
    });
    const content = "recommendation: not_ready\nfinding: missing changelog";
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
    expect(ctx.recommendationSummary.seniorRecommendation).toBe("not_ready");

    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-5",
      seniorReviewConsidered: true,
    });
    expect(applied.operatorDecision?.followedSeniorRecommendation).toBe(false);
    expect(applied.recommendationSummary.disagreements.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it("scenario7: operator overrides senior ready with not_ready (no lifecycle transition)", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    let ctx = workflow.createContext({ runId: "run-7", prPreparation: samplePrep() });
    const content = "recommendation: ready";
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
      decision: "mark_pr_not_ready",
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-7",
      seniorReviewConsidered: true,
    });
    expect(applied.state).toBe("operator_not_ready");
    expect(applied.operatorDecision?.followedSeniorRecommendation).toBe(false);
    expect(applied.lifecycleEffect.applied).toBe(false);
    expect(applied.lifecycleEffect.prReadinessDecision).toBe("not_ready");
    expect(applied.lifecycleEffect.prCreationAuthorized).toBe(false);
  });

  it("scenario8: stale prep excludes senior and rejects old hashes", () => {
    const { workflow } = createReady(tempRoot(), []);
    let ctx = workflow.createContext({ runId: "run-8", prPreparation: samplePrep("hash-old") });
    const content = "recommendation: ready";
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
      prPreparationSha256: "hash-new",
      defaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    expect(stale.state).toBe("stale");
    expect(stale.seniorReview?.stale).toBe(true);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "mark_pr_ready",
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        reviewedPrPreparationSha256: "hash-old",
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
        reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
        seniorReviewConsidered: true,
      }),
    ).toThrow(/stale/i);
  });

  it("scenario8b: branch change invalidates readiness", () => {
    const { workflow } = createReady(tempRoot(), []);
    let ctx = workflow.createContext({ runId: "run-8b", prPreparation: samplePrep() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b",
      reviewId: "s",
      content: "recommendation: ready",
      contentSha256: sha256Text("recommendation: ready"),
      comparisonSha256: "cmp",
      executionApprovalReference: "e",
      acceptanceDecisionReference: "a",
    });
    const stale = workflow.invalidateForChangedArtifacts(ctx.decisionContextId, {
      prPreparationSha256: ctx.prPreparation.artifactSha256,
      defaultReviewSha256: ctx.defaultReview.contentSha256,
      branchName: "feature/different",
    });
    expect(stale.state).toBe("stale");
  });

  it("scenario8c: commit change invalidates readiness", () => {
    const { workflow } = createReady(tempRoot(), []);
    let ctx = workflow.createContext({ runId: "run-8c", prPreparation: samplePrep() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b",
      reviewId: "s",
      content: "recommendation: ready",
      contentSha256: sha256Text("recommendation: ready"),
      comparisonSha256: "cmp",
      executionApprovalReference: "e",
      acceptanceDecisionReference: "a",
    });
    const stale = workflow.invalidateForChangedArtifacts(ctx.decisionContextId, {
      prPreparationSha256: ctx.prPreparation.artifactSha256,
      defaultReviewSha256: ctx.defaultReview.contentSha256,
      commitSha: "def456",
    });
    expect(stale.state).toBe("stale");
  });

  it("scenario10+11: idempotent duplicate mark_ready; conflicting decision rejected", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    const ctx = workflow.createContext({ runId: "run-10", prPreparation: samplePrep() });
    const first = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    const second = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    expect(second.operatorDecision?.decisionId).toBe(first.operatorDecision?.decisionId);
    expect(calls).toHaveLength(1);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "mark_pr_not_ready",
        reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      }),
    ).toThrow(/conflicting/i);
  });

  it("scenario12: senior failure preserves default path", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    let ctx = workflow.createContext({ runId: "run-12", prPreparation: samplePrep() });
    ctx = workflow.markSeniorFailed(ctx.decisionContextId, "cancelled");
    expect(ctx.state).toBe("senior_cancelled");
    const applied = workflow.applyOperatorDecision({
      decisionContextId: ctx.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
    });
    expect(applied.state).toBe("operator_ready");
    expect(calls).toHaveLength(1);
  });

  it("scenario13: recover returns pending contexts without auto-mark-ready", () => {
    const { workflow } = createPrReadinessDecisionWorkflow({ stateRoot: tempRoot() });
    workflow.createContext({ runId: "run-13a", prPreparation: samplePrep("a") });
    let ctx = workflow.createContext({ runId: "run-13b", prPreparation: samplePrep("b") });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "b13",
      reviewId: "s13",
      content: "recommendation: ready",
      contentSha256: sha256Text("recommendation: ready"),
      comparisonSha256: "cmp-13",
      executionApprovalReference: "exec-13",
      acceptanceDecisionReference: "acc-13",
    });
    const pending = workflow.recover();
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.every((c: PrReadinessDecisionContext) => !c.lifecycleEffect.applied)).toBe(true);
  });

  it("scenario14: no-action boundary rejects patch/commit/push/pr/merge/deploy", () => {
    const { workflow } = createPrReadinessDecisionWorkflow({ stateRoot: tempRoot() });
    for (const action of [
      "apply_patch",
      "git_commit",
      "push_branch",
      "create_pr",
      "approve_pr",
      "merge",
      "deploy",
    ] as const) {
      const r = workflow.attemptForbiddenAction(action);
      expect(r.allowed).toBe(false);
      expect(r.counters[action]).toBe(0);
    }
    expect(assertNoAction("create_pr").allowed).toBe(false);
  });

  it("gate substitution assertions (four gates)", () => {
    expect(() =>
      assertGatesAreSeparate({ usingExecutionApprovalAsAcceptance: true }),
    ).toThrow(/execution_approval_is_not_acceptance/);
    expect(() =>
      assertGatesAreSeparate({ usingAcceptanceAsReadinessDecision: true }),
    ).toThrow(/acceptance_is_not_readiness_decision/);
    expect(() =>
      assertGatesAreSeparate({ usingReadinessDecisionAsPrCreation: true }),
    ).toThrow(/readiness_decision_is_not_pr_creation/);
    expect(() =>
      assertGatesAreSeparate({ usingAcceptanceAsPrCreation: true }),
    ).toThrow(/acceptance_is_not_pr_creation/);
  });

  it("recommendation extraction: explicit only; invalid → neutral", () => {
    expect(extractRecommendation("recommendation: ready")).toBe("ready");
    expect(extractRecommendation("recommendation: not_ready")).toBe("not_ready");
    expect(extractRecommendation("recommendation: needs_revision")).toBe("needs_revision");
    expect(extractRecommendation("this looks good, ship it")).toBe("neutral");
    expect(extractRecommendation("READY")).toBe("neutral");
    expect(extractRecommendation('{"recommendation": "ready"}')).toBe("neutral");
  });

  it("S17 uses S15 workflow types without calling S13", () => {
    const { workflow: s15 } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    const bundle = s15.createDefaultReview({
      runId: "s15-bridge",
      defaultContent: "finding: x\nrecommend: y",
    });
    expect(bundle.effectiveReview.downstreamActionAuthorized).toBe(false);
    expect(S17_ARCHITECTURE.usesS15NotS14OrS13Direct).toBe(true);
  });

  it("accepted senior cannot set readiness or authorize PR by itself", () => {
    const { workflow } = createPrReadinessDecisionWorkflow({ stateRoot: tempRoot() });
    let ctx = workflow.createContext({ runId: "run-bound", prPreparation: samplePrep() });
    ctx = workflow.attachAcceptedSenior({
      decisionContextId: ctx.decisionContextId,
      reviewBundleId: "bb",
      reviewId: "ss",
      content: "recommendation: ready",
      contentSha256: sha256Text("recommendation: ready"),
      comparisonSha256: "cmp",
      executionApprovalReference: "exec",
      acceptanceDecisionReference: "acc",
    });
    expect(ctx.lifecycleEffect.resultingStep).toBeUndefined();
    expect(ctx.lifecycleEffect.prReadinessDecision).toBe("pending");
    expect(ctx.lifecycleEffect.prCreationAuthorized).toBe(false);
    expect(ctx.lifecycleEffect.appliedBySenior).toBe(false);
  });

  it("operator decision validates prep and default-review hashes", () => {
    const { workflow } = createReady(tempRoot(), []);
    const ctx = workflow.createContext({ runId: "run-hash", prPreparation: samplePrep() });
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "mark_pr_ready",
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        reviewedPrPreparationSha256: "wrong-prep",
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      }),
    ).toThrow(/pr_preparation_hash_mismatch/);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "mark_pr_ready",
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
        reviewedDefaultReviewSha256: "wrong-default",
      }),
    ).toThrow(/default_review_hash_mismatch/);
  });

  it("operator considering senior must validate senior and comparison hashes", () => {
    const { workflow } = createReady(tempRoot(), []);
    let ctx = workflow.createContext({ runId: "run-shash", prPreparation: samplePrep() });
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
        decision: "mark_pr_ready",
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
        seniorReviewConsidered: true,
        reviewedSeniorReviewSha256: "wrong-senior",
        reviewedComparisonSha256: "cmp-ok",
      }),
    ).toThrow(/senior_review_hash_mismatch/);
    expect(() =>
      workflow.applyOperatorDecision({
        decisionContextId: ctx.decisionContextId,
        decision: "mark_pr_ready",
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
        reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
        seniorReviewConsidered: true,
        reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
        reviewedComparisonSha256: "wrong-cmp",
      }),
    ).toThrow(/comparison_hash_mismatch/);
  });

  it("neutral senior recommendation remains valid advisory input", () => {
    const calls: Array<Record<string, unknown>> = [];
    const { workflow } = createReady(tempRoot(), calls);
    let ctx = workflow.createContext({ runId: "run-neutral", prPreparation: samplePrep() });
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
      decision: "request_pr_readiness_revision",
      reviewedPrPreparationSha256: ctx.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: ctx.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: ctx.seniorReview!.contentSha256,
      reviewedComparisonSha256: "cmp-n",
      seniorReviewConsidered: true,
    });
    expect(applied.state).toBe("operator_revision_requested");
    expect(applied.lifecycleEffect.prReadinessDecision).toBe("revision_requested");
    expect(applied.lifecycleEffect.applied).toBe(false);
  });
});
