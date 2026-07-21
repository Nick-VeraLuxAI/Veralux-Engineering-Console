/**
 * S15.1 bounded long-form senior generation contract tests.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  S14_CONFIGURED_MAX_NEW_TOKENS,
  S14_VERIFIED_MAX_NEW_TOKENS,
  DEFAULT_DEADLINES,
} from "./s14-senior-adapter/types";
import { createSeniorApprovalArtifact, validateSeniorApproval } from "./s14-senior-adapter/approval-gate";
import { evaluateSeniorRouteDecision } from "./s14-senior-adapter/route-gate";
import {
  GATED_SENIOR_REGISTRY_AFTER,
  assertNoDefaultInvariants,
} from "./s14-senior-adapter/registry-view";
import {
  S15_WORKFLOW_ARCHITECTURE,
  createSeniorReviewWorkflow,
  sha256Text,
} from "./s15-senior-review-workflow";

let roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "s15-1-"));
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

describe("S15.1 bounded long-form contracts", () => {
  it("keeps 1 and 2 token requests supported and accepts 32", () => {
    for (const n of [1, 2, 32]) {
      const decision = evaluateSeniorRouteDecision({
        request: {
          veraRequestId: `v-${n}`,
          prompt: "review",
          maxNewTokens: n,
          approvalReference: `a-${n}`,
          idempotencyKey: `k-${n}`,
          requestedAt: new Date().toISOString(),
          seniorRequested: true,
        },
        approval: createSeniorApprovalArtifact({ veraRequestId: `v-${n}`, maxNewTokens: n, approvalReference: `a-${n}` }),
      });
      expect(decision.approved).toBe(true);
    }
  });

  it("rejects above configured maximum and non-positive counts", () => {
    for (const n of [0, -1, 33, 128]) {
      const decision = evaluateSeniorRouteDecision({
        request: {
          veraRequestId: "v-bad",
          prompt: "review",
          maxNewTokens: n,
          approvalReference: "a",
          idempotencyKey: "k",
          requestedAt: new Date().toISOString(),
          seniorRequested: true,
        },
        approval: createSeniorApprovalArtifact({ veraRequestId: "v-bad", maxNewTokens: 32 }),
      });
      expect(decision.approved).toBe(false);
      expect(decision.reason).toBe("senior_request_shape_unsupported");
    }
  });

  it("binds approval scope so 2-token approval cannot authorize 32", () => {
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "v1", maxNewTokens: 2 });
    const result = validateSeniorApproval(
      {
        veraRequestId: "v1",
        prompt: "x",
        maxNewTokens: 32,
        approvalReference: artifact.approvalReference,
        idempotencyKey: "k",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      artifact,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("senior_execution_approval_scope_mismatch");
    }
  });

  it("allows early EOS under a 32-token approval scope (request <= approved)", () => {
    const artifact = createSeniorApprovalArtifact({ veraRequestId: "v1", maxNewTokens: 32 });
    const result = validateSeniorApproval(
      {
        veraRequestId: "v1",
        prompt: "x",
        maxNewTokens: 8,
        approvalReference: artifact.approvalReference,
        idempotencyKey: "k",
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      artifact,
    );
    expect(result.ok).toBe(true);
  });

  it("registry remains no-default and truthful about long-form limits", () => {
    assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);
    expect(GATED_SENIOR_REGISTRY_AFTER.configuredMaxNewTokens).toBe(S14_CONFIGURED_MAX_NEW_TOKENS);
    expect(GATED_SENIOR_REGISTRY_AFTER.verifiedMaxNewTokens).toBe(S14_VERIFIED_MAX_NEW_TOKENS);
    expect(GATED_SENIOR_REGISTRY_AFTER.kvCacheClaimed).toBe(false);
    expect(GATED_SENIOR_REGISTRY_AFTER.generationStrategy).toBe("full_prefix_recomputation");
    expect(GATED_SENIOR_REGISTRY_AFTER.nativeFp8KernelProven).toBe(false);
    expect(GATED_SENIOR_REGISTRY_AFTER.maxNewTokens).toEqual([1, 32]);
  });

  it("adapter polling budget supports longer full-prefix requests", () => {
    expect(DEFAULT_DEADLINES.activeExecutionMs).toBeGreaterThanOrEqual(86_400_000);
  });

  it("S15 uses S14 only and rejects incomplete senior output for acceptance", async () => {
    let seenMax: number | undefined;
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: tempRoot(),
      submitViaS14: async (req) => {
        seenMax = req.maxNewTokens;
        return { s14CorrelationId: "corr", s13RequestId: "s13-1", state: "senior_submitted" };
      },
    });
    const bundle = workflow.createDefaultReview({
      runId: "run-lf",
      defaultContent: "finding: default\nrecommend: keep",
    });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "apr",
      executionApprovalPresent: true,
      maxNewTokens: 32,
      prompt: "Senior review prompt",
    });
    expect(seenMax).toBe(32);

    const partial = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: "partial senior text",
      generatedTokenIds: [1, 2, 3],
      tokensCompleted: 3,
      requestedMaxNewTokens: 32,
      completionReason: "cancelled",
      partial: true,
      complete: false,
      s15AcceptanceEligible: false,
      syntheticOrFixture: false,
    });
    expect(partial.seniorReview?.content).toBe("partial senior text");
    expect(partial.seniorReview?.s15AcceptanceEligible).toBe(false);
    expect(partial.comparison).toBeUndefined();
    expect(partial.effectiveReview.source).toBe("default");

    expect(() =>
      workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: bundle.defaultReview.contentSha256,
        reviewedSeniorSha256: partial.seniorReview!.contentSha256,
      }),
    ).toThrow(/senior_output|partial|cancelled|cannot accept|comparison/i);
  });

  it("complete senior output still requires separate operator acceptance and cannot execute actions", async () => {
    const { workflow } = createSeniorReviewWorkflow({ stateRoot: tempRoot() });
    const bundle = workflow.createDefaultReview({
      runId: "run-complete",
      defaultContent: "finding: a\nrecommend: b",
    });
    await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: "apr2",
      executionApprovalPresent: true,
      maxNewTokens: 32,
    });
    const completed = workflow.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content: "finding: a\nfinding: c\nrecommend: b",
      generatedTokenIds: Array.from({ length: 8 }, (_, i) => i + 1),
      tokensCompleted: 8,
      requestedMaxNewTokens: 32,
      completionReason: "eos",
      complete: true,
      s15AcceptanceEligible: true,
      syntheticOrFixture: false,
    });
    expect(completed.state).toBe("pending_operator_review");
    expect(completed.effectiveReview.source).toBe("default");
    expect(completed.comparison).toBeDefined();

    const accepted = workflow.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "accept_senior",
      reviewedDefaultSha256: completed.defaultReview.contentSha256,
      reviewedSeniorSha256: completed.seniorReview!.contentSha256,
      reviewedComparisonSha256: completed.comparison!.comparisonSha256,
    });
    expect(accepted.effectiveReview.source).toBe("senior");
    expect(accepted.effectiveReview.downstreamActionAuthorized).toBe(false);
  });

  it("architecture constants remain truthful", () => {
    expect(S15_WORKFLOW_ARCHITECTURE.usesS14NotS13Direct).toBe(true);
    expect(S15_WORKFLOW_ARCHITECTURE.kvCacheClaimed).toBe(false);
    expect(S15_WORKFLOW_ARCHITECTURE.partialOutputAcceptanceAllowed).toBe(false);
    expect(S15_WORKFLOW_ARCHITECTURE.configuredMaxNewTokens).toBe(32);
    expect(S15_WORKFLOW_ARCHITECTURE.longFormSeniorReviewProven).toBe(false);
    expect(sha256Text("x")).toHaveLength(64);
  });
});
