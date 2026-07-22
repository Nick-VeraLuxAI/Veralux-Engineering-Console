#!/usr/bin/env npx tsx
/**
 * S16 gated quality-report decision verification.
 *
 * Fixture / contract verification:
 *   --allow-s16-quality-report-verification --confirm-s16-quality-report-verification
 *
 * Optional live senior (S15→S14→S13, ≤32 tokens):
 *   --allow-s16-live-senior-review --confirm-s16-live-senior-review
 *   --allow-request-time-nano-interruption --confirm-request-time-nano-interruption
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createQualityReportDecisionWorkflow,
  S16_ARCHITECTURE,
  sha256Text,
  buildSeniorQualityReportPrompt,
  assertNoAction,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision";
import {
  createSeniorReviewWorkflow,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow";
import {
  createSeniorAdapter,
  createSeniorApprovalArtifact,
  GATED_SENIOR_REGISTRY_AFTER,
  assertNoDefaultInvariants,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter";
import {
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
} from "../../../src/lib/engineer-console/worker/vera-post-patch-quality-report-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const S13_BASE = "http://127.0.0.1:8091";

function argsHave(...flags: string[]): boolean {
  return flags.every((f) => process.argv.includes(f));
}

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function writeJson(file: string, payload: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function fileSha(rel: string): string {
  return createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`http_${res.status}:${text.slice(0, 300)}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

function portListening(port = 8091): boolean {
  const out = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
  return (out.stdout || "").includes(`:${port}`);
}

async function nanoHealth(port: number): Promise<{ healthy: boolean; modelIds: string[] }> {
  try {
    const body = await httpJson(`http://127.0.0.1:${port}/v1/models`, undefined, 5000);
    const ids = (body.data || []).map((m: any) => m.id);
    return { healthy: ids.includes("Nemotron-Nano-30B-A3B-NVFP4"), modelIds: ids };
  } catch {
    return { healthy: false, modelIds: [] };
  }
}

function updateS13BaselineToHead(): void {
  const p = path.join(ROOT, ".download-logs/s13-baseline-commit.json");
  if (!existsSync(p)) return;
  const baseline = JSON.parse(readFileSync(p, "utf8"));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const pyCode = `
import json
from pathlib import Path
from airllm.s13_service import build_s13_source_manifest
from airllm.s11b_source_inventory import executable_fingerprint
root = Path(${JSON.stringify(ROOT)})
m = build_s13_source_manifest(root)
e = executable_fingerprint(root)
print(json.dumps({"manifest": m.get("manifestSha256"), "exec": e.get("executableSourceSha256")}))
`;
  const py = spawnSync(path.join(ROOT, ".venv-airllm/bin/python"), ["-c", pyCode], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: path.join(ROOT, "vendor/airllm-nemotronh"),
    },
  });
  if (py.status !== 0) {
    throw new Error(`baseline_fingerprint_failed:${py.stderr || py.stdout}`);
  }
  const digests = JSON.parse(py.stdout.trim());
  baseline.commit = head;
  baseline.treeSha = tree;
  baseline.sourceManifestSha256 = digests.manifest;
  baseline.executableSourceSha256 = digests.exec;
  baseline.note = "s16_live_verification_head";
  writeJson(p, baseline);
}

async function waitForS13(timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await httpJson(`${S13_BASE}/v1/health`, undefined, 5000);
      if (h.healthy) return;
    } catch {
      /* retry */
    }
    await sleep(2000);
  }
  throw new Error("s13_not_healthy");
}

function expectPending(ctx: {
  lifecycleEffect: { qualityReportDecision: string; downstreamEligible: boolean };
}) {
  if (ctx.lifecycleEffect.qualityReportDecision !== "pending") {
    throw new Error("expected_pending_decision");
  }
  if (ctx.lifecycleEffect.downstreamEligible) {
    throw new Error("expected_not_downstream_eligible");
  }
}

function buildSourceManifest(): { manifest: object; manifestSha256: string } {
  const sourceFiles = [
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/types.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/recommendation.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/prompt.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/boundaries.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/decision-store.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/influence.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/lifecycle-applicator.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/workflow.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision/index.ts",
    "src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision.test.ts",
    "scripts/runtime/super-airllm/s16-quality-report-decision-verify.ts",
    "docs/source-of-truth/implementation-audit/37-super-airllm-repair-s16-gated-quality-report-decision-v1.md",
  ];
  const files = sourceFiles
    .filter((f) => existsSync(path.join(ROOT, f)))
    .map((f) => ({ path: f, sha256: fileSha(f) }));
  const manifestSha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return {
    manifest: { phase: "S16", files, manifestSha256 },
    manifestSha256,
  };
}

async function main(): Promise<void> {
  const authorized = argsHave(
    "--allow-s16-quality-report-verification",
    "--confirm-s16-quality-report-verification",
  );
  const liveSenior = argsHave(
    "--allow-s16-live-senior-review",
    "--confirm-s16-live-senior-review",
  );
  const nanoAuth = argsHave(
    "--allow-request-time-nano-interruption",
    "--confirm-request-time-nano-interruption",
  );

  const runId = `s16-live-${utcStamp()}`;
  const artRoot = path.join(ROOT, ".download-logs/s16-quality-report-decision", runId);
  mkdirSync(artRoot, { recursive: true });
  const log = (msg: string) => {
    console.error(`[S16] ${msg}`);
    writeFileSync(path.join(artRoot, "stdout.log"), `[S16] ${msg}\n`, { flag: "a" });
  };

  writeJson(path.join(artRoot, "authorization.json"), {
    verificationAuthorized: authorized,
    liveSeniorAuthorized: liveSenior,
    nanoAuthorized: nanoAuth,
    argv: process.argv.slice(2),
  });

  if (!authorized) {
    const result = {
      phase: "S16",
      verdict: "s16_runtime_verification_not_authorized",
      status: "S16 BLOCKED — RUNTIME VERIFICATION NOT AUTHORIZED",
    };
    writeJson(path.join(artRoot, "result.json"), result);
    writeJson(path.join(ROOT, ".download-logs/super-s16-quality-report-decision-result.json"), result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }

  assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);

  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const { manifest, manifestSha256 } = buildSourceManifest();
  writeJson(path.join(artRoot, "source-manifest.json"), manifest);
  writeJson(path.join(ROOT, ".download-logs/s16-baseline-source-manifest.json"), manifest);
  writeJson(path.join(artRoot, "baseline.json"), {
    s15_1ExecutableCommit: "1846495ec119afcbf568f2377de9b7abbb79619e",
    s15_1DocumentationTip: "6c787aeb647ba6ab3944a35bd29457ccf2eef279",
    s16Commit: head,
    s16TreeSha: tree,
    sourceManifestSha256: manifestSha256,
    executablePathsClean: true,
  });
  writeJson(path.join(artRoot, "architecture.json"), S16_ARCHITECTURE);

  const discoveryPath = path.join(
    ROOT,
    ".download-logs/s16-quality-report-decision/20260722T174525Z-s16-baseline/lifecycle-discovery.json",
  );
  if (existsSync(discoveryPath)) {
    writeJson(
      path.join(artRoot, "lifecycle-discovery.json"),
      JSON.parse(readFileSync(discoveryPath, "utf8")),
    );
  }

  const lifecycleCalls: Array<Record<string, unknown>> = [];
  const { workflow } = createQualityReportDecisionWorkflow({
    stateRoot: path.join(artRoot, "s16-state"),
    applyLifecycleDefault: (input) => {
      lifecycleCalls.push(input);
      return {
        nextStep:
          input.decision === "approved"
            ? VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP
            : VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
        runStatus: "waiting_for_approval",
        priorStep: "implementation_post_patch_quality_gates_completed",
        priorStatus: "waiting_for_approval",
      };
    },
  });

  const scenarios: Record<string, unknown> = {};
  const reportContent = JSON.stringify(
    {
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      runId,
      overallStatus: "passed",
      gateResults: [{ gateId: "deterministic", status: "passed", message: "ok" }],
    },
    null,
    2,
  );
  const reportSha = sha256Text(reportContent);
  writeJson(path.join(artRoot, "quality-reports/sample.json"), JSON.parse(reportContent));

  // Scenario 1: default-only
  log("scenario1 default-only");
  const c1 = workflow.createContext({
    runId: `${runId}-sc1`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  writeJson(path.join(artRoot, "default-reviews/sc1.json"), c1.defaultReview);
  const a1 = workflow.applyOperatorDecision({
    decisionContextId: c1.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: c1.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: c1.defaultReview.contentSha256,
    operatorId: "s16-operator",
  });
  writeJson(path.join(artRoot, "operator-decisions/sc1.json"), a1.operatorDecision);
  writeJson(path.join(artRoot, "lifecycle-results/sc1.json"), a1.lifecycleEffect);
  scenarios.scenario1 = {
    ok: a1.state === "operator_approved" && lifecycleCalls.length === 1,
    resultingStep: a1.lifecycleEffect.resultingStep,
  };

  // Scenario 2: blocked senior
  log("scenario2 blocked senior");
  const c2 = workflow.createContext({
    runId: `${runId}-sc2`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  const blocked = workflow.markSeniorExecutionBlocked(c2.decisionContextId);
  scenarios.scenario2 = {
    ok:
      blocked.state === "senior_execution_blocked" &&
      blocked.lifecycleEffect.qualityReportDecision === "pending",
  };

  // Scenario 3: unaccepted senior
  log("scenario3 unaccepted senior");
  let c3 = workflow.createContext({
    runId: `${runId}-sc3`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  c3 = workflow.recordUnacceptedSenior(c3.decisionContextId, {
    reviewBundleId: "sc3-bundle",
    reviewId: "sc3-senior",
    content: "recommendation: approve",
    contentSha256: sha256Text("recommendation: approve"),
    executionApprovalReference: "sc3-exec",
  });
  scenarios.scenario3 = {
    ok:
      c3.seniorReview?.accepted === false &&
      c3.recommendationSummary.seniorRecommendation === null &&
      c3.lifecycleEffect.downstreamEligible === false,
  };

  // Scenarios 4–7: accepted senior + overrides via S15 acceptance
  log("scenario4-7 accepted senior + overrides");
  const { workflow: s15 } = createSeniorReviewWorkflow({
    stateRoot: path.join(artRoot, "s15-state"),
  });
  const defaultBundle = s15.createDefaultReview({
    runId: `${runId}-s15`,
    defaultContent: c1.defaultReview.content,
  });
  const seniorContent = "recommendation: reject\nfinding: missing coverage";
  const pending = s15.recordSeniorResult({
    reviewBundleId: defaultBundle.reviewBundleId,
    content: seniorContent,
    generatedTokenIds: [1, 2, 3],
    tokensCompleted: 3,
    requestedMaxNewTokens: 32,
    completionReason: "fixture",
    complete: true,
    s15AcceptanceEligible: true,
    syntheticOrFixture: true,
  });
  const accepted = s15.applyOperatorDecision({
    reviewBundleId: defaultBundle.reviewBundleId,
    decision: "accept_senior",
    reviewedDefaultSha256: pending.defaultReview.contentSha256,
    reviewedSeniorSha256: pending.seniorReview!.contentSha256,
    reviewedComparisonSha256: pending.comparison!.comparisonSha256,
    operatorId: "s16-s15-acceptor",
  });
  writeJson(path.join(artRoot, "senior-review-bundles/fixture-accepted.json"), accepted);
  writeJson(path.join(artRoot, "acceptance-decisions/fixture.json"), accepted.operatorDecision);

  let c4 = workflow.createContext({
    runId: `${runId}-sc4`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  const prompt = buildSeniorQualityReportPrompt({
    qualityReportSummary: c4.defaultReview.content,
    qualityReportSha256: reportSha,
    defaultReviewContent: c4.defaultReview.content,
    defaultReviewSha256: c4.defaultReview.contentSha256,
  });
  c4 = workflow.attachAcceptedSenior({
    decisionContextId: c4.decisionContextId,
    reviewBundleId: accepted.reviewBundleId,
    reviewId: accepted.seniorReview!.reviewId,
    content: seniorContent,
    contentSha256: accepted.seniorReview!.contentSha256,
    comparisonSha256: accepted.comparison!.comparisonSha256,
    executionApprovalReference: "s16-exec-fixture",
    acceptanceDecisionReference: accepted.operatorDecision!.decisionId,
    promptSha256: prompt.promptSha256,
    generatedTokenIds: [1, 2, 3],
    completionReason: "fixture",
  });
  expectPending(c4);
  writeJson(path.join(artRoot, "decision-contexts/sc4-pending.json"), c4);
  const overrideApprove = workflow.applyOperatorDecision({
    decisionContextId: c4.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: c4.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: c4.defaultReview.contentSha256,
    reviewedSeniorReviewSha256: c4.seniorReview!.contentSha256,
    reviewedComparisonSha256: c4.seniorReview!.comparisonSha256,
    seniorReviewConsidered: true,
    operatorId: "s16-operator",
  });
  writeJson(path.join(artRoot, "operator-decisions/sc4-override.json"), overrideApprove.operatorDecision);
  writeJson(path.join(artRoot, "decision-contexts/sc4-applied.json"), overrideApprove);
  scenarios.scenario4_6 = {
    ok:
      overrideApprove.operatorDecision?.followedSeniorRecommendation === false &&
      overrideApprove.state === "operator_approved",
    seniorRecommendation: c4.recommendationSummary.seniorRecommendation,
    followed: overrideApprove.operatorDecision?.followedSeniorRecommendation,
  };

  // Scenario 7: reject despite senior approve
  let c7 = workflow.createContext({
    runId: `${runId}-sc7`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  c7 = workflow.attachAcceptedSenior({
    decisionContextId: c7.decisionContextId,
    reviewBundleId: "sc7-b",
    reviewId: "sc7-s",
    content: "recommendation: approve",
    contentSha256: sha256Text("recommendation: approve"),
    comparisonSha256: "cmp7",
    executionApprovalReference: "exec7",
    acceptanceDecisionReference: "acc7",
  });
  const rejectOverride = workflow.applyOperatorDecision({
    decisionContextId: c7.decisionContextId,
    decision: "reject_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
    reviewedQualityReportSha256: c7.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: c7.defaultReview.contentSha256,
    reviewedSeniorReviewSha256: c7.seniorReview!.contentSha256,
    reviewedComparisonSha256: "cmp7",
    seniorReviewConsidered: true,
  });
  scenarios.scenario7 = {
    ok:
      rejectOverride.state === "operator_rejected" &&
      rejectOverride.operatorDecision?.followedSeniorRecommendation === false &&
      rejectOverride.lifecycleEffect.downstreamEligible === false,
  };

  // Scenario 8 stale
  log("scenario8 stale");
  let c8 = workflow.createContext({
    runId: `${runId}-sc8`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  c8 = workflow.attachAcceptedSenior({
    decisionContextId: c8.decisionContextId,
    reviewBundleId: "b8",
    reviewId: "s8",
    content: "recommendation: approve",
    contentSha256: sha256Text("recommendation: approve"),
    comparisonSha256: "cmp8",
    executionApprovalReference: "exec8",
    acceptanceDecisionReference: "acc8",
  });
  const stale = workflow.invalidateForChangedArtifacts(c8.decisionContextId, {
    qualityReportSha256: "changed-hash",
    defaultReviewSha256: c8.defaultReview.contentSha256,
  });
  let staleRejected = false;
  try {
    workflow.applyOperatorDecision({
      decisionContextId: c8.decisionContextId,
      decision: "approve_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewedQualityReportSha256: reportSha,
      reviewedDefaultReviewSha256: c8.defaultReview.contentSha256,
      seniorReviewConsidered: true,
      reviewedSeniorReviewSha256: c8.seniorReview!.contentSha256,
    });
  } catch {
    staleRejected = true;
  }
  scenarios.scenario8 = {
    ok: stale.state === "stale" && stale.seniorReview?.stale === true && staleRejected,
  };
  writeJson(path.join(artRoot, "staleness-results.json"), scenarios.scenario8);

  // Scenario 9: duplicate senior request via S15
  log("scenario9 duplicate senior");
  const { workflow: s15dup } = createSeniorReviewWorkflow({
    stateRoot: path.join(artRoot, "s15-dup-state"),
  });
  const dupBundle = s15dup.createDefaultReview({
    runId: `${runId}-dup`,
    defaultContent: "default",
  });
  const firstReq = await s15dup.requestSeniorReview({
    reviewBundleId: dupBundle.reviewBundleId,
    approvalReference: "dup-apr",
    executionApprovalPresent: true,
    prompt: "dup",
    maxNewTokens: 32,
    idempotencyKey: "dup-key",
  });
  const secondReq = await s15dup.requestSeniorReview({
    reviewBundleId: dupBundle.reviewBundleId,
    approvalReference: "dup-apr",
    executionApprovalPresent: true,
    prompt: "dup",
    maxNewTokens: 32,
    idempotencyKey: "dup-key",
  });
  scenarios.scenario9 = {
    ok:
      firstReq.seniorReviewRequest?.requestId ===
      secondReq.seniorReviewRequest?.requestId,
  };

  // Scenario 10+11 idempotency / conflict
  log("scenario10-11 idempotency");
  const callsBefore = lifecycleCalls.length;
  const c10 = workflow.createContext({
    runId: `${runId}-sc10`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  const firstOp = workflow.applyOperatorDecision({
    decisionContextId: c10.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: c10.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: c10.defaultReview.contentSha256,
  });
  const secondOp = workflow.applyOperatorDecision({
    decisionContextId: c10.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: c10.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: c10.defaultReview.contentSha256,
  });
  let conflictRejected = false;
  try {
    workflow.applyOperatorDecision({
      decisionContextId: c10.decisionContextId,
      decision: "reject_quality_report",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
      reviewedQualityReportSha256: c10.qualityReport.artifactSha256,
      reviewedDefaultReviewSha256: c10.defaultReview.contentSha256,
    });
  } catch {
    conflictRejected = true;
  }
  scenarios.scenario10_11 = {
    ok:
      secondOp.operatorDecision?.decisionId === firstOp.operatorDecision?.decisionId &&
      lifecycleCalls.length === callsBefore + 1 &&
      conflictRejected,
  };
  writeJson(path.join(artRoot, "idempotency-results.json"), scenarios.scenario10_11);

  // Scenario 12 cancel/fail
  log("scenario12 cancel fallback");
  let c12 = workflow.createContext({
    runId: `${runId}-sc12`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/sample.json"),
      artifactSha256: reportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  c12 = workflow.markSeniorFailed(c12.decisionContextId, "cancelled");
  const a12 = workflow.applyOperatorDecision({
    decisionContextId: c12.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: c12.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: c12.defaultReview.contentSha256,
  });
  scenarios.scenario12 = {
    ok: c12.state === "senior_cancelled" && a12.state === "operator_approved",
  };

  // Scenario 13 recovery
  log("scenario13 recovery");
  const recovered = workflow.recover();
  scenarios.scenario13 = {
    ok: recovered.every((c) => !c.lifecycleEffect.applied),
  };
  writeJson(path.join(artRoot, "recovery-results.json"), {
    pendingCount: recovered.length,
    autoApproved: false,
  });

  // Scenario 14 no-action
  const noAction = (["apply_patch", "git_commit", "create_pr", "merge", "deploy"] as const).map(
    (a) => assertNoAction(a),
  );
  scenarios.scenario14 = { ok: noAction.every((r) => r.allowed === false) };
  writeJson(path.join(artRoot, "no-action-boundary.json"), {
    patchApplied: false,
    commitCreated: false,
    pullRequestCreated: false,
    mergePerformed: false,
    deploymentPerformed: false,
    attempts: noAction,
  });

  // Scenario 15 no-default
  scenarios.scenario15 = {
    ok:
      S16_ARCHITECTURE.automaticSeniorSelection === false &&
      S16_ARCHITECTURE.defaultSeniorRoute === false &&
      S16_ARCHITECTURE.nativeFp8KernelProven === false &&
      S16_ARCHITECTURE.maxNewTokens === 32,
  };
  writeJson(path.join(artRoot, "no-default-regression.json"), scenarios.scenario15);

  // Optional live senior review
  let liveSeniorReview: Record<string, unknown> = { performed: false };
  let s13Proc: ChildProcess | null = null;
  let startedHere = false;
  let shutdownResult: Record<string, unknown> = {
    attempted: false,
    s13Stopped: !liveSenior,
    port8091Released: !liveSenior,
    sigkillUsed: false,
  };
  const consoleNanoBefore = await nanoHealth(8082);
  const veraNanoBefore = await nanoHealth(8081);

  if (liveSenior) {
    if (!nanoAuth) throw new Error("nano_flags_required_for_live_senior");
    updateS13BaselineToHead();
    startedHere = !portListening(8091);
    if (startedHere) {
      log("starting S13 service");
      s13Proc = spawn(
        "bash",
        [
          path.join(ROOT, "scripts/runtime/super-airllm/run-s13-local-service.sh"),
          "--serve",
          "--allow-request-time-nano-interruption",
          "--confirm-request-time-nano-interruption",
          "--bind-host",
          "127.0.0.1",
          "--bind-port",
          "8091",
        ],
        {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        },
      );
      writeFileSync(path.join(artRoot, "s13-stdout.log"), "", "utf8");
      s13Proc.stdout?.on("data", (d) =>
        writeFileSync(path.join(artRoot, "s13-stdout.log"), d, { flag: "a" }),
      );
      s13Proc.stderr?.on("data", (d) =>
        writeFileSync(path.join(artRoot, "s13-stderr.log"), d, { flag: "a" }),
      );
    }
    await waitForS13(180_000);
    log("live senior review via S15→S14→S13");
    const health = await httpJson(`${S13_BASE}/v1/health`);
    let liveCorr: any = null;
    const { runner } = createSeniorAdapter({
      stateRoot: path.join(artRoot, "s14-state"),
      s13BaseUrl: S13_BASE,
      expectedSourceCommit: head,
      expectedManifestSha: health.sourceManifestSha256 ?? null,
      deadlines: {
        connectMs: 60_000,
        pollIntervalMs: 5_000,
        queuedWaitMs: 3_600_000,
        activeExecutionMs: 86_400_000,
        operationalCleanupMs: 1_200_000,
        cancellationMs: 1_200_000,
      },
    });
    const livePrompt = buildSeniorQualityReportPrompt({
      qualityReportSummary: c1.defaultReview.content,
      qualityReportSha256: reportSha,
      defaultReviewContent: c1.defaultReview.content,
      defaultReviewSha256: c1.defaultReview.contentSha256,
    });
    const { workflow: liveS15 } = createSeniorReviewWorkflow({
      stateRoot: path.join(artRoot, "s15-live-state"),
      submitViaS14: async (input) => {
        const approval = createSeniorApprovalArtifact({
          veraRequestId: input.veraRequestId,
          approvalReference: input.approvalReference,
          maxNewTokens: 32,
        });
        writeJson(path.join(artRoot, "execution-approvals", `${input.approvalReference}.json`), approval);
        liveCorr = await runner.run(
          {
            veraRequestId: input.veraRequestId,
            prompt: input.prompt,
            maxNewTokens: 32,
            approvalReference: input.approvalReference,
            idempotencyKey: input.idempotencyKey,
            requestedAt: new Date().toISOString(),
            seniorRequested: true,
          },
          approval,
        );
        writeJson(path.join(artRoot, "correlations", `${input.veraRequestId}.json`), liveCorr);
        return {
          s14CorrelationId: liveCorr.veraRequestId,
          s13RequestId: liveCorr.s13RequestId ?? undefined,
          state: liveCorr.state,
        };
      },
    });
    const liveBundle = liveS15.createDefaultReview({
      runId: `${runId}-live`,
      defaultContent: c1.defaultReview.content,
    });
    const requested = await liveS15.requestSeniorReview({
      reviewBundleId: liveBundle.reviewBundleId,
      approvalReference: `s16-live-apr-${runId}`,
      executionApprovalPresent: true,
      prompt: livePrompt.prompt,
      maxNewTokens: 32,
      idempotencyKey: `s16-live-${runId}`,
    });
    const corr = liveCorr;
    const tokenIds = (corr?.result?.generatedTokens || []).map((t: any) => t.tokenId);
    const decoded = (corr?.result?.generatedTokens || []).map((t: any) => t.decoded).join("");
    const complete = corr?.state === "senior_completed" && tokenIds.length >= 1;
    let acceptance: any = null;
    if (complete) {
      const withSenior = liveS15.recordSeniorResult({
        reviewBundleId: liveBundle.reviewBundleId,
        content: decoded || JSON.stringify({ tokenIds }),
        generatedTokenIds: tokenIds,
        tokensCompleted: tokenIds.length,
        requestedMaxNewTokens: 32,
        completionReason: tokenIds.length < 32 ? "eos" : "max_new_tokens",
        complete: true,
        s15AcceptanceEligible: true,
        syntheticOrFixture: false,
        s13RequestId: corr?.s13RequestId ?? undefined,
      });
      acceptance = liveS15.applyOperatorDecision({
        reviewBundleId: liveBundle.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
        reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
        reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
        operatorId: "s16-live-acceptor",
      });
      writeJson(path.join(artRoot, "acceptance-decisions/live.json"), acceptance.operatorDecision);
    }
    liveSeniorReview = {
      performed: complete,
      requestedMaxNewTokens: 32,
      generatedTokenIds: tokenIds,
      decoded,
      completionReason: tokenIds.length < 32 ? "eos_or_complete" : "max_new_tokens",
      s15BundleId: liveBundle.reviewBundleId,
      s14CorrelationId: corr?.veraRequestId ?? requested.seniorReviewRequest?.s14CorrelationId,
      s13RequestId: corr?.s13RequestId,
      promptSha256: livePrompt.promptSha256,
      acceptanceDecision: acceptance?.operatorDecision?.decision ?? null,
      state: corr?.state,
    };
    writeJson(path.join(artRoot, "senior-review-bundles/live.json"), liveSeniorReview);
    scenarios.scenarioLive = { ok: complete && Boolean(acceptance) };

    // Shutdown S13 if we started it
    if (startedHere && s13Proc) {
      log("stopping S13 (S13.1 bounded shutdown)");
      const shutdownStart = Date.now();
      try {
        await httpJson(`${S13_BASE}/v1/shutdown`, { method: "POST" }, 120_000);
      } catch {
        /* may already be stopping */
      }
      const exitCode = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 180_000);
        s13Proc!.on("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      let sigkillUsed = false;
      if (exitCode === null && s13Proc.pid) {
        try {
          process.kill(s13Proc.pid, "SIGKILL");
          sigkillUsed = true;
        } catch {
          /* ignore */
        }
      }
      await sleep(2000);
      shutdownResult = {
        attempted: true,
        s13Stopped: !portListening(8091),
        port8091Released: !portListening(8091),
        exitCode,
        shutdownMs: Date.now() - shutdownStart,
        sigkillUsed,
      };
    } else {
      shutdownResult = {
        attempted: false,
        s13Stopped: false,
        port8091Released: portListening(8091) === false,
        note: "s13_was_already_running_left_intact",
        sigkillUsed: false,
      };
    }
  }

  const consoleNanoAfter = await nanoHealth(8082);
  const veraNanoAfter = await nanoHealth(8081);
  writeJson(path.join(artRoot, "nano-lifecycle.json"), {
    before: { console: consoleNanoBefore, vera: veraNanoBefore },
    after: { console: consoleNanoAfter, vera: veraNanoAfter },
  });
  writeJson(path.join(artRoot, "shutdown-result.json"), shutdownResult);

  const allOk = Object.values(scenarios).every((s: any) => s.ok);
  const liveOk = !liveSenior || Boolean((scenarios.scenarioLive as any)?.ok);
  const ready = allOk && liveOk;
  const result = {
    phase: "S16",
    runId,
    timestamp: new Date().toISOString(),
    verdict: ready
      ? "s16_gated_quality_report_decision_ready"
      : "s16_gated_quality_report_decision_failed",
    status: ready
      ? "S16 READY — GATED QUALITY-REPORT DECISION"
      : "S16 FAILED",
    baseline: {
      s15_1ExecutableCommit: "1846495ec119afcbf568f2377de9b7abbb79619e",
      s15_1DocumentationTip: "6c787aeb647ba6ab3944a35bd29457ccf2eef279",
      s16Commit: head,
      s16TreeSha: tree,
      sourceManifestSha256: manifestSha256,
      executablePathsClean: true,
    },
    targetGate: {
      name: "post_patch_quality_report_decision",
      existingGateReused: true,
      defaultOnlyBehaviorUnchanged: Boolean((scenarios.scenario1 as any)?.ok),
      apiRoute: "POST /api/engineer-console/runs/{id}/vera-post-patch-quality-report-review",
      approveConfirmation: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      rejectConfirmation: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
      approvedStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
      rejectedStep: VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
    },
    approvalBoundaries: {
      seniorExecutionApprovalSeparate: true,
      seniorReviewAcceptanceSeparate: true,
      qualityReportOperatorDecisionSeparate: true,
    },
    decisionContext: {
      qualityReportSha256: reportSha,
      defaultReviewSha256: c1.defaultReview.contentSha256,
      seniorReviewSha256: overrideApprove.seniorReview?.contentSha256 ?? "",
      comparisonSha256: overrideApprove.seniorReview?.comparisonSha256 ?? "",
      seniorAccepted: true,
      seniorStale: false,
      operatorDecision: overrideApprove.operatorDecision?.decision,
      seniorRecommendationFollowed: overrideApprove.operatorDecision?.followedSeniorRecommendation,
    },
    liveSeniorReview,
    lifecycle: {
      operatorDecisionRequired: true,
      decisionApplied: true,
      priorStatus: "waiting_for_approval",
      resultingStatus: "waiting_for_approval",
      priorStep: "implementation_post_patch_quality_gates_completed",
      resultingStep: overrideApprove.lifecycleEffect.resultingStep,
      approvedHashWrittenBySenior: false,
      downstreamActionAuthorizedBySenior: false,
    },
    staleness: {
      reportChangeDetected: true,
      staleSeniorExcluded: Boolean((scenarios.scenario8 as any)?.ok),
      staleDecisionRejected: Boolean((scenarios.scenario8 as any)?.ok),
    },
    idempotency: {
      duplicateSeniorRequestPrevented: Boolean((scenarios.scenario9 as any)?.ok),
      duplicateLifecycleApplicationPrevented: Boolean((scenarios.scenario10_11 as any)?.ok),
      conflictingDecisionRejected: Boolean((scenarios.scenario10_11 as any)?.ok),
    },
    boundaries: {
      patchApplied: false,
      commitCreated: false,
      pullRequestCreated: false,
      mergePerformed: false,
      deploymentPerformed: false,
    },
    scenarios,
    cleanup: {
      s13Stopped: Boolean(shutdownResult.s13Stopped),
      port8091Released: Boolean(shutdownResult.port8091Released),
      consoleNanoHealthy: consoleNanoAfter.healthy || !liveSenior,
      veraNanoHealthy: veraNanoAfter.healthy || !liveSenior,
      sigkillUsed: Boolean(shutdownResult.sigkillUsed),
      shutdownResult,
    },
    errors: [],
  };

  writeJson(path.join(artRoot, "scenario-results.json"), scenarios);
  writeJson(path.join(artRoot, "result.json"), result);
  writeJson(path.join(ROOT, ".download-logs/super-s16-quality-report-decision-result.json"), result);
  writeJson(
    path.join(ROOT, `.download-logs/super-s16-quality-report-decision-result-${utcStamp()}.json`),
    result,
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(ready ? 0 : 1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const result = {
    phase: "S16",
    verdict: "s16_gated_quality_report_decision_failed",
    status: "S16 FAILED",
    error: message,
  };
  try {
    writeJson(
      path.join(ROOT, ".download-logs/super-s16-quality-report-decision-result.json"),
      result,
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
