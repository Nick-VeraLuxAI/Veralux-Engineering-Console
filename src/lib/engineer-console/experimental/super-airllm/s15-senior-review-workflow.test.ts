/**
 * S15 approved senior-review workflow tests.
 * Covers dual preservation, approval separation, comparison, acceptance, recovery, and no-default.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  S15_EXECUTION_MODE,
  S15_WORKFLOW_ARCHITECTURE,
  createSeniorReviewWorkflow,
  sha256Text,
  compareReviews,
  assertDownstreamActionBlocked,
} from "./s15-senior-review-workflow";
import {
  GATED_SENIOR_REGISTRY_AFTER as S14_REGISTRY,
  assertNoDefaultInvariants as s14Assert,
} from "./s14-senior-adapter/registry-view";

let roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "s15-"));
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

const DEFAULT_CONTENT = [
  "finding: missing null check in parser",
  "recommend: add unit test",
  "severity: medium",
].join("\n");

const SENIOR_CONTENT = [
  "finding: missing null check in parser",
  "finding: race on shutdown path",
  "recommend: add unit test",
  "recommend: use bounded shutdown coordinator",
  "severity: high",
  "action: do not auto-merge",
].join("\n");

describe("S15 approved senior-review workflow", () => {
  it("scenario1: default review only — effective is default", () => {
    const { workflow } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    const bundle = workflow.createDefaultReview({
      runId: "run-1",
      defaultContent: DEFAULT_CONTENT,
    });
    expect(bundle.state).toBe("default_only");
    expect(bundle.effectiveReview.source).toBe("default");
    expect(bundle.effectiveReview.eligibleForDownstreamUse).toBe(true);
    expect(bundle.seniorReview).toBeUndefined();
    expect(bundle.decisionReason).toBe("senior_review_not_requested");
  });

  it("scenario2: senior requested without execution approval is blocked", async () => {
    const { workflow } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    const bundle = workflow.createDefaultReview({ runId: "run-2", defaultContent: DEFAULT_CONTENT });
    const blocked = await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "missing",
      executionApprovalPresent: false,
    });
    expect(blocked.state).toBe("senior_execution_blocked");
    expect(blocked.decisionReason).toBe("senior_execution_not_approved");
    expect(blocked.seniorReviewRequest).toBeUndefined();
    expect(blocked.effectiveReview.source).toBe("default");
    expect(blocked.operatorDecision).toBeUndefined();
  });

  it("scenario3: approved senior review succeeds — default remains effective before acceptance", async () => {
    let s14Calls = 0;
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async (req) => {
        s14Calls += 1;
        return {
          s14CorrelationId: `corr-${req.veraRequestId}`,
          s13RequestId: "s13-abc",
          state: "senior_submitted",
        };
      },
    });
    const bundle = workflow.createDefaultReview({ runId: "run-3", defaultContent: DEFAULT_CONTENT });
    const requested = await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "s14-approval-1",
      executionApprovalPresent: true,
    });
    expect(requested.seniorReviewRequest?.s13RequestId).toBe("s13-abc");
    expect(s14Calls).toBe(1);
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
      s13RequestId: "s13-abc",
      generatedTokenIds: [1044],
      syntheticOrFixture: true,
    });
    expect(withSenior.state).toBe("pending_operator_review");
    expect(withSenior.defaultReview.contentSha256).toBe(sha256Text(DEFAULT_CONTENT));
    expect(withSenior.seniorReview?.contentSha256).toBe(sha256Text(SENIOR_CONTENT));
    expect(withSenior.comparison?.autoSelectedWinner).toBe(false);
    expect(withSenior.effectiveReview.source).toBe("default");
    expect(withSenior.comparison?.seniorOnlyFindings.length).toBeGreaterThan(0);
    expect(withSenior.comparison?.agreements.length).toBeGreaterThan(0);
  });

  it("scenario4: operator accepts senior — senior becomes effective; no action executes", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c1", s13RequestId: "s13-1", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-4", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "appr-4",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    const accepted = workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "accept_senior",
      operatorId: "human-operator",
      reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
      reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
      reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
    });
    expect(accepted.state).toBe("senior_accepted");
    expect(accepted.effectiveReview.source).toBe("senior");
    expect(accepted.effectiveReview.eligibleForDownstreamUse).toBe(true);
    expect(accepted.effectiveReview.downstreamActionAuthorized).toBe(false);
    expect(accepted.defaultReview.content).toBe(DEFAULT_CONTENT);
    const gate = workflow.attemptDownstreamAction(bundle.reviewBundleId, "git_commit");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("accepted_senior_still_requires_action_gates");
  });

  it("scenario5: operator rejects senior — default remains effective", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-5", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a5",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    const rejected = workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "reject_senior",
      reason: "disagreement_on_severity",
      reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
      reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
      reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
    });
    expect(rejected.state).toBe("senior_rejected");
    expect(rejected.effectiveReview.source).toBe("default");
    expect(rejected.seniorReview?.content).toBe(SENIOR_CONTENT);
  });

  it("scenario6: operator keeps default explicitly", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-6", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a6",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    const kept = workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "keep_default",
      reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
      reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
      reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
    });
    expect(kept.state).toBe("default_retained");
    expect(kept.decisionReason).toBe("operator_retained_default");
    expect(kept.effectiveReview.source).toBe("default");
  });

  it("scenario7: review revision after acceptance becomes stale", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-7", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a7",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "accept_senior",
      operatorId: "op",
      reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
      reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
      reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
    });
    const revised = workflow.reviseDefaultReview(bundle.reviewBundleId, DEFAULT_CONTENT + "\nfinding: new issue");
    expect(revised.state).toBe("stale");
    expect(revised.decisionReason).toBe("review_artifact_changed");
    expect(revised.effectiveReview.source).toBe("default");
    expect(revised.comparison).toBeUndefined();
    expect(revised.seniorReview?.content).toBe(SENIOR_CONTENT);
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: revised.defaultReview.contentSha256,
        reviewedSeniorSha256: revised.seniorReview!.contentSha256,
        reviewedComparisonSha256: "stale",
      }),
    ).toThrow(/review_artifact_changed|comparison/);
  });

  it("scenario8: duplicate senior request is idempotent", async () => {
    let calls = 0;
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async (req) => {
        calls += 1;
        return { s14CorrelationId: `corr-${req.idempotencyKey}`, s13RequestId: "s13-dup", state: "ok" };
      },
    });
    const bundle = workflow.createDefaultReview({ runId: "run-8", defaultContent: DEFAULT_CONTENT });
    const a = await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a8",
      executionApprovalPresent: true,
      idempotencyKey: "idem-8",
    });
    const b = await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a8",
      executionApprovalPresent: true,
      idempotencyKey: "idem-8",
    });
    expect(calls).toBe(1);
    expect(a.seniorReviewRequest?.s14CorrelationId).toBe(b.seniorReviewRequest?.s14CorrelationId);
    await expect(
      workflow.requestSeniorReview({
        reviewBundleId: bundle.reviewBundleId,
        approvalReference: "a8-other",
        executionApprovalPresent: true,
        idempotencyKey: "idem-8",
      }),
    ).rejects.toThrow(/senior_duplicate_payload_conflict/);
  });

  it("scenario9: cancellation preserves default and blocks acceptance", async () => {
    let cancelled = false;
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "corr-9", state: "senior_executing" }),
      cancelViaS14: async () => {
        cancelled = true;
        return { cancelled: true };
      },
    });
    const bundle = workflow.createDefaultReview({ runId: "run-9", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a9",
      executionApprovalPresent: true,
    });
    const done = await workflow.cancelSeniorReview(bundle.reviewBundleId);
    expect(cancelled).toBe(true);
    expect(done.state).toBe("senior_cancelled");
    expect(done.effectiveReview.source).toBe("default");
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: done.defaultReview.contentSha256,
        reviewedSeniorSha256: "none",
        reviewedComparisonSha256: "none",
      }),
    ).toThrow();
  });

  it("scenario10: senior failure/recovery preserves default", () => {
    const { workflow } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    const bundle = workflow.createDefaultReview({ runId: "run-10", defaultContent: DEFAULT_CONTENT });
    const failed = workflow.recordSeniorFailure(bundle.reviewBundleId, "recovery_required");
    expect(failed.state).toBe("senior_recovery_required");
    expect(failed.effectiveReview.source).toBe("default");
    expect(failed.seniorReview).toBeUndefined();
  });

  it("scenario11: restart recovers pending decision without auto-accept", async () => {
    const root = tempRoot();
    const first = createSeniorReviewWorkflow({
      stateRoot: root,
      submitViaS14: async () => ({ s14CorrelationId: "c11", s13RequestId: "s13-11", state: "ok" }),
    });
    const bundle = first.workflow.createDefaultReview({ runId: "run-11", defaultContent: DEFAULT_CONTENT });
    await first.workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a11",
      executionApprovalPresent: true,
    });
    first.workflow.recordSeniorResult({ reviewBundleId: bundle.reviewBundleId, content: SENIOR_CONTENT });

    const second = createSeniorReviewWorkflow({ stateRoot: root });
    const recovered = second.workflow.recoverAfterRestart();
    const pending = recovered.find((b) => b.reviewBundleId === bundle.reviewBundleId);
    expect(pending?.state).toBe("pending_operator_review");
    expect(pending?.operatorDecision).toBeUndefined();
    expect(pending?.effectiveReview.source).toBe("default");
    expect(pending?.seniorReviewRequest?.s14CorrelationId).toBe("c11");
  });

  it("scenario12: approval separation — execution approval is not acceptance; reuse rejected", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c12", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-12", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "exec-appr",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        executionApprovalAsAcceptance: true,
        reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
        reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
        reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
      }),
    ).toThrow(/execution_approval_is_not_acceptance/);
    expect(() => workflow.rejectExecutionApprovalAsAcceptance(null)).toThrow(
      /execution_approval_is_not_acceptance/,
    );

    const accepted = workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "accept_senior",
      operatorId: "op",
      reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
      reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
      reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
    });
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: accepted.reviewBundleId,
        decision: "accept_senior",
        reuseDecisionId: accepted.operatorDecision!.decisionId,
        reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
        reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
        reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
      }),
    ).toThrow(/acceptance_reuse_rejected/);

    // Wrong bundle
    const other = workflow.createDefaultReview({ runId: "run-12b", defaultContent: DEFAULT_CONTENT });
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: other.reviewBundleId,
        decision: "keep_default",
        reviewedDefaultSha256: "wrong",
      }),
    ).toThrow(/acceptance_hash_mismatch/);
  });

  it("scenario13: downstream boundary — unaccepted senior cannot trigger actions", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c13", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-13", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a13",
      executionApprovalPresent: true,
    });
    workflow.recordSeniorResult({ reviewBundleId: bundle.reviewBundleId, content: SENIOR_CONTENT });
    const blocked = workflow.attemptDownstreamAction(bundle.reviewBundleId, "deploy");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("unaccepted_senior_cannot_trigger_actions");
  });

  it("scenario14: no-default regression — registry remains gated", () => {
    s14Assert(S14_REGISTRY);
    expect(S14_REGISTRY.defaultRoute).toBe(false);
    expect(S14_REGISTRY.automaticSelection).toBe(false);
    expect(S14_REGISTRY.explicitApprovalRequired).toBe(true);
    expect(S14_REGISTRY.nativeFp8KernelProven).toBe(false);
    expect(S15_EXECUTION_MODE).toBe("modelopt_fake_quant_cuda");
    expect(S15_WORKFLOW_ARCHITECTURE.usesS14NotS13Direct).toBe(true);
    expect(S15_WORKFLOW_ARCHITECTURE.allocatesCuda).toBe(false);
    expect(S15_WORKFLOW_ARCHITECTURE.stopsNano).toBe(false);
    expect(S15_WORKFLOW_ARCHITECTURE.longFormSeniorReviewProven).toBe(false);
  });

  it("default review must exist first", async () => {
    const { workflow, store } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    // Manually craft invalid path is not exposed; requesting on missing id fails.
    await expect(
      workflow.requestSeniorReview({
        reviewBundleId: "missing",
        approvalReference: "a",
        executionApprovalPresent: true,
      }),
    ).rejects.toThrow(/review_bundle_not_found/);
    expect(store.list()).toHaveLength(0);
  });

  it("default and senior reviews are preserved immutably; comparison does not overwrite", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-imm", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    expect(() =>
      workflow.recordSeniorResult({
        reviewBundleId: bundle.reviewBundleId,
        content: "different senior content",
      }),
    ).toThrow(/immutable/);
    expect(withSenior.defaultReview.content).toBe(DEFAULT_CONTENT);
    expect(withSenior.seniorReview?.content).toBe(SENIOR_CONTENT);
    expect(withSenior.comparison?.autoSelectedWinner).toBe(false);
  });

  it("acceptance is bound to hashes; wrong hashes rejected", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-hash", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: "bad",
        reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
        reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
      }),
    ).toThrow(/acceptance_hash_mismatch/);
  });

  it("senior cannot approve itself", async () => {
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-self", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        operatorId: withSenior.seniorReview!.runtimeId,
        reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
        reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
        reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
      }),
    ).toThrow(/senior_cannot_approve_itself/);
  });

  it("rule-based comparison records agreements and unique findings without picking a winner", () => {
    const cmp = compareReviews(
      {
        reviewId: "d",
        runtimeId: "default",
        content: DEFAULT_CONTENT,
        contentSha256: sha256Text(DEFAULT_CONTENT),
        createdAt: new Date().toISOString(),
      },
      {
        reviewId: "s",
        runtimeId: "senior",
        executionMode: S15_EXECUTION_MODE,
        content: SENIOR_CONTENT,
        contentSha256: sha256Text(SENIOR_CONTENT),
        createdAt: new Date().toISOString(),
      },
    );
    expect(cmp.autoSelectedWinner).toBe(false);
    expect(cmp.comparisonRuntime).toBe("rule_based_s15_v1");
    expect(cmp.agreements.length).toBeGreaterThan(0);
    expect(cmp.disagreements.length).toBeGreaterThan(0);
    expect(cmp.seniorOnlyFindings.length).toBeGreaterThan(0);
  });

  it("stale decision cannot keep senior effective after hash drift on recover", async () => {
    const root = tempRoot();
    const { workflow, store } = createSeniorReviewWorkflow({
      stateRoot: root,
      submitViaS14: async () => ({ s14CorrelationId: "c", state: "ok" }),
    });
    const bundle = workflow.createDefaultReview({ runId: "run-stale", defaultContent: DEFAULT_CONTENT });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "a",
      executionApprovalPresent: true,
    });
    const withSenior = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: SENIOR_CONTENT,
    });
    workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "accept_senior",
      operatorId: "op",
      reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
      reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
      reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
    });
    // Simulate external corruption / drift of default hash binding
    const accepted = store.read(bundle.reviewBundleId)!;
    store.write({
      ...accepted,
      defaultReview: { ...accepted.defaultReview, contentSha256: "drifted" },
    });
    const { workflow: w2 } = createSeniorReviewWorkflow({ stateRoot: root });
    const recovered = w2.recoverAfterRestart().find((b) => b.reviewBundleId === bundle.reviewBundleId)!;
    expect(recovered.state).toBe("stale");
    expect(recovered.effectiveReview.source).toBe("default");
  });

  it("assertDownstreamActionBlocked helper rejects unaccepted senior actions", () => {
    const result = assertDownstreamActionBlocked(
      {
        schema: "s15_senior_review_bundle_v1",
        reviewBundleId: "b",
        runId: "r",
        state: "pending_operator_review",
        defaultReview: {
          reviewId: "d",
          runtimeId: "def",
          content: "x",
          contentSha256: sha256Text("x"),
          createdAt: "",
        },
        seniorReview: {
          reviewId: "s",
          runtimeId: "sen",
          executionMode: S15_EXECUTION_MODE,
          content: "y",
          contentSha256: sha256Text("y"),
          createdAt: "",
        },
        effectiveReview: {
          source: "default",
          reviewId: "d",
          contentSha256: sha256Text("x"),
          eligibleForDownstreamUse: true,
          downstreamActionAuthorized: false,
        },
        decisionReason: "operator_decision_missing",
        createdAt: "",
        updatedAt: "",
        revisionGeneration: 0,
      },
      "merge",
    );
    expect(result.allowed).toBe(false);
  });
});
