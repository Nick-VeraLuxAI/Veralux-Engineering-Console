#!/usr/bin/env npx tsx
/**
 * S15 approved senior-review workflow verification (fixture-based).
 * Does not perform live S13 routing unless separately authorized.
 * Distinguishes workflow integration proof from long-form senior generation proof.
 */

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  S15_WORKFLOW_ARCHITECTURE,
  createSeniorReviewWorkflow,
  sha256Text,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function writeJson(file: string, payload: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function fileSha(rel: string): string {
  const abs = path.join(ROOT, rel);
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

async function main(): Promise<number> {
  const flags = new Set(process.argv.slice(2));
  if (flags.has("--allow-s15-runtime-verification") || flags.has("--confirm-s15-runtime-verification")) {
    const { runS15LiveVerification } = await import("./s15-senior-review-live-verify");
    return runS15LiveVerification(process.argv.slice(2));
  }

  const runId = `${utcStamp()}-s15`;
  const verDir = path.join(ROOT, ".download-logs", "s15-senior-review-verification", runId);
  mkdirSync(verDir, { recursive: true });
  const stateRoot = path.join(verDir, "workflow-state");

  const s131 = JSON.parse(
    readFileSync(path.join(ROOT, ".download-logs", "s13-1-baseline-commit.json"), "utf8"),
  );
  writeJson(path.join(verDir, "s13-1-baseline.json"), s131);

  writeJson(path.join(verDir, "workflow-architecture.json"), S15_WORKFLOW_ARCHITECTURE);

  const scenarios: Record<string, unknown> = {};
  let s14Calls = 0;
  const { workflow, store } = createSeniorReviewWorkflow({
    stateRoot,
    submitViaS14: async (req) => {
      s14Calls += 1;
      return {
        s14CorrelationId: `s14-${req.veraRequestId}`,
        s13RequestId: `s13-${req.veraRequestId}`,
        state: "senior_submitted",
      };
    },
    cancelViaS14: async () => ({ cancelled: true }),
  });

  const DEFAULT = "finding: null check\nrecommend: add test\nseverity: medium";
  const SENIOR =
    "finding: null check\nfinding: shutdown deadlock\nrecommend: add test\nrecommend: bounded shutdown\nseverity: high\naction: do not auto-merge";

  // Scenario 1
  const b1 = workflow.createDefaultReview({ runId: "s15-sc1", defaultContent: DEFAULT });
  scenarios.scenario1_default_only = {
    passed: b1.effectiveReview.source === "default" && !b1.seniorReview,
    bundleId: b1.reviewBundleId,
  };

  // Scenario 2
  const b2 = workflow.createDefaultReview({ runId: "s15-sc2", defaultContent: DEFAULT });
  const blocked = await workflow.requestSeniorReview({
    reviewBundleId: b2.reviewBundleId,
    approvalReference: "none",
    executionApprovalPresent: false,
  });
  scenarios.scenario2_no_execution_approval = {
    passed: blocked.state === "senior_execution_blocked" && !blocked.seniorReviewRequest,
  };

  // Scenario 3
  const b3 = workflow.createDefaultReview({ runId: "s15-sc3", defaultContent: DEFAULT });
  await workflow.requestSeniorReview({
    reviewBundleId: b3.reviewBundleId,
    approvalReference: "exec-3",
    executionApprovalPresent: true,
  });
  const pending = workflow.recordSeniorResult({
    reviewBundleId: b3.reviewBundleId,
    content: SENIOR,
    syntheticOrFixture: true,
  });
  scenarios.scenario3_approved_senior_pending = {
    passed:
      pending.state === "pending_operator_review" &&
      pending.effectiveReview.source === "default" &&
      !!pending.comparison &&
      pending.comparison.autoSelectedWinner === false,
  };

  // Scenario 4
  const accepted = workflow.applyOperatorDecision({
    reviewBundleId: b3.reviewBundleId,
    decision: "accept_senior",
    operatorId: "verification-operator",
    reviewedDefaultSha256: pending.defaultReview.contentSha256,
    reviewedSeniorSha256: pending.seniorReview!.contentSha256,
    reviewedComparisonSha256: pending.comparison!.comparisonSha256,
  });
  scenarios.scenario4_operator_accepts = {
    passed:
      accepted.state === "senior_accepted" &&
      accepted.effectiveReview.source === "senior" &&
      accepted.effectiveReview.downstreamActionAuthorized === false,
  };

  // Scenario 5
  const b5 = workflow.createDefaultReview({ runId: "s15-sc5", defaultContent: DEFAULT });
  await workflow.requestSeniorReview({
    reviewBundleId: b5.reviewBundleId,
    approvalReference: "exec-5",
    executionApprovalPresent: true,
  });
  const s5 = workflow.recordSeniorResult({ reviewBundleId: b5.reviewBundleId, content: SENIOR });
  const rejected = workflow.applyOperatorDecision({
    reviewBundleId: b5.reviewBundleId,
    decision: "reject_senior",
    reviewedDefaultSha256: s5.defaultReview.contentSha256,
    reviewedSeniorSha256: s5.seniorReview!.contentSha256,
    reviewedComparisonSha256: s5.comparison!.comparisonSha256,
  });
  scenarios.scenario5_operator_rejects = {
    passed: rejected.state === "senior_rejected" && rejected.effectiveReview.source === "default",
  };

  // Scenario 6
  const b6 = workflow.createDefaultReview({ runId: "s15-sc6", defaultContent: DEFAULT });
  await workflow.requestSeniorReview({
    reviewBundleId: b6.reviewBundleId,
    approvalReference: "exec-6",
    executionApprovalPresent: true,
  });
  const s6 = workflow.recordSeniorResult({ reviewBundleId: b6.reviewBundleId, content: SENIOR });
  const kept = workflow.applyOperatorDecision({
    reviewBundleId: b6.reviewBundleId,
    decision: "keep_default",
    reviewedDefaultSha256: s6.defaultReview.contentSha256,
    reviewedSeniorSha256: s6.seniorReview!.contentSha256,
    reviewedComparisonSha256: s6.comparison!.comparisonSha256,
  });
  scenarios.scenario6_keep_default = {
    passed: kept.state === "default_retained" && kept.effectiveReview.source === "default",
  };

  // Scenario 7 — revise after accept on a fresh bundle
  const b7 = workflow.createDefaultReview({ runId: "s15-sc7", defaultContent: DEFAULT });
  await workflow.requestSeniorReview({
    reviewBundleId: b7.reviewBundleId,
    approvalReference: "exec-7",
    executionApprovalPresent: true,
  });
  const s7 = workflow.recordSeniorResult({ reviewBundleId: b7.reviewBundleId, content: SENIOR });
  workflow.applyOperatorDecision({
    reviewBundleId: b7.reviewBundleId,
    decision: "accept_senior",
    operatorId: "op",
    reviewedDefaultSha256: s7.defaultReview.contentSha256,
    reviewedSeniorSha256: s7.seniorReview!.contentSha256,
    reviewedComparisonSha256: s7.comparison!.comparisonSha256,
  });
  const stale = workflow.reviseDefaultReview(b7.reviewBundleId, DEFAULT + "\nfinding: new");
  scenarios.scenario7_revision_stale = {
    passed: stale.state === "stale" && stale.effectiveReview.source === "default",
  };

  // Scenario 8 duplicate
  const b8 = workflow.createDefaultReview({ runId: "s15-sc8", defaultContent: DEFAULT });
  const before = s14Calls;
  await workflow.requestSeniorReview({
    reviewBundleId: b8.reviewBundleId,
    approvalReference: "exec-8",
    executionApprovalPresent: true,
    idempotencyKey: "idem-8",
  });
  await workflow.requestSeniorReview({
    reviewBundleId: b8.reviewBundleId,
    approvalReference: "exec-8",
    executionApprovalPresent: true,
    idempotencyKey: "idem-8",
  });
  scenarios.scenario8_duplicate_idempotent = { passed: s14Calls === before + 1 };

  // Scenario 9 cancel
  const b9 = workflow.createDefaultReview({ runId: "s15-sc9", defaultContent: DEFAULT });
  await workflow.requestSeniorReview({
    reviewBundleId: b9.reviewBundleId,
    approvalReference: "exec-9",
    executionApprovalPresent: true,
  });
  const cancelled = await workflow.cancelSeniorReview(b9.reviewBundleId);
  scenarios.scenario9_cancellation = {
    passed: cancelled.state === "senior_cancelled" && cancelled.effectiveReview.source === "default",
  };

  // Scenario 10 failure
  const b10 = workflow.createDefaultReview({ runId: "s15-sc10", defaultContent: DEFAULT });
  const failed = workflow.recordSeniorFailure(b10.reviewBundleId, "recovery_required");
  scenarios.scenario10_failure_recovery = {
    passed: failed.state === "senior_recovery_required" && failed.effectiveReview.source === "default",
  };

  // Scenario 11 restart
  const b11 = workflow.createDefaultReview({ runId: "s15-sc11", defaultContent: DEFAULT });
  await workflow.requestSeniorReview({
    reviewBundleId: b11.reviewBundleId,
    approvalReference: "exec-11",
    executionApprovalPresent: true,
  });
  workflow.recordSeniorResult({ reviewBundleId: b11.reviewBundleId, content: SENIOR });
  const { workflow: w2 } = createSeniorReviewWorkflow({ stateRoot });
  const recovered = w2.recoverAfterRestart().find((b) => b.reviewBundleId === b11.reviewBundleId);
  scenarios.scenario11_restart_recovery = {
    passed: recovered?.state === "pending_operator_review" && !recovered.operatorDecision,
  };
  writeJson(path.join(verDir, "restart-recovery.json"), { recovered });

  // Scenario 12 approval separation
  let execAsAcceptBlocked = false;
  try {
    workflow.rejectExecutionApprovalAsAcceptance(null);
  } catch {
    execAsAcceptBlocked = true;
  }
  scenarios.scenario12_approval_separation = { passed: execAsAcceptBlocked };

  // Scenario 13 downstream
  const gate = workflow.attemptDownstreamAction(b3.reviewBundleId, "deploy");
  // b3 was accepted — still cannot authorize action in S15
  scenarios.scenario13_downstream_boundary = {
    passed: gate.allowed === false && gate.reason === "accepted_senior_still_requires_action_gates",
  };
  writeJson(path.join(verDir, "downstream-boundary.json"), gate);

  // Scenario 14 no-default
  scenarios.scenario14_no_default = {
    passed:
      S15_WORKFLOW_ARCHITECTURE.usesS14NotS13Direct &&
      !S15_WORKFLOW_ARCHITECTURE.longFormSeniorReviewProven &&
      S15_WORKFLOW_ARCHITECTURE.allocatesCuda === false,
  };
  writeJson(path.join(verDir, "no-default-regression.json"), scenarios.scenario14_no_default);

  writeJson(path.join(verDir, "scenario-results.json"), scenarios);

  // Copy durable artifacts into verification dirs
  for (const name of ["bundles", "comparisons", "operator-decisions", "execution-approvals", "senior-correlations"] as const) {
    const src = path.join(stateRoot, name);
    const dst = path.join(verDir, name === "bundles" ? "review-bundles" : name);
    if (existsSync(src)) cpSync(src, dst, { recursive: true });
  }

  const allPassed = Object.values(scenarios).every((s) => (s as { passed: boolean }).passed);

  const sourceFiles = [
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/types.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/comparison.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/bundle-store.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/acceptance-gate.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/eligibility.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/workflow.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow/index.ts",
    "src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow.test.ts",
    "scripts/runtime/super-airllm/s15-senior-review-workflow.ts",
    "docs/source-of-truth/implementation-audit/35-super-airllm-repair-s15-approved-senior-review-workflow-v1.md",
  ];

  const manifest = {
    phase: "S15",
    files: sourceFiles.filter((f) => existsSync(path.join(ROOT, f))).map((f) => ({
      path: f,
      sha256: fileSha(f),
    })),
  };
  const manifestSha = createHash("sha256")
    .update(JSON.stringify(manifest.files))
    .digest("hex");
  (manifest as { manifestSha256?: string }).manifestSha256 = manifestSha;
  writeJson(path.join(verDir, "source-manifest.json"), manifest);
  writeJson(path.join(ROOT, ".download-logs", "s15-baseline-source-manifest.json"), manifest);

  // Live runtime verification not authorized in this launcher.
  const verdict = allPassed
    ? "s15_runtime_verification_not_authorized"
    : "s15_approved_senior_review_failed";

  const result = {
    phase: "S15",
    runId,
    verdict,
    status:
      verdict === "s15_runtime_verification_not_authorized"
        ? "S15 BLOCKED — RUNTIME VERIFICATION NOT AUTHORIZED"
        : "S15 FAILED",
    note:
      "Workflow integration proven with fixture/synthetic senior outputs. Live S13/S14 senior-review routing not authorized in this launcher. Long-form senior review generation is not claimed.",
    s13_1_baseline: {
      commit: s131.commit,
      treeSha: s131.treeSha,
      verdict: s131.verdict,
    },
    workflowIntegrationProven: allPassed,
    longFormSeniorReviewProven: false,
    scenarios,
    s14SubmitCalls: s14Calls,
    architecture: S15_WORKFLOW_ARCHITECTURE,
    sourceManifestSha256: manifestSha,
    verificationDir: verDir,
    createdAt: new Date().toISOString(),
  };

  writeJson(path.join(verDir, "result.json"), result);
  writeJson(path.join(ROOT, ".download-logs", "super-s15-senior-review-result.json"), result);
  writeJson(
    path.join(ROOT, ".download-logs", `super-s15-senior-review-result-${utcStamp()}.json`),
    result,
  );
  writeFileSync(path.join(verDir, "stdout.log"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(path.join(verDir, "stderr.log"), "");

  console.log(JSON.stringify({ verdict, runId, allPassed, scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, (v as { passed: boolean }).passed])) }, null, 2));
  return allPassed ? 0 : 2;
}

main().then((code) => process.exit(code));
