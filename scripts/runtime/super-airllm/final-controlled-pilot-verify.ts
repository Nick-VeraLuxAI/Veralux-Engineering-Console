#!/usr/bin/env npx tsx
/**
 * Final controlled-pilot verification: S17 PR-readiness gated senior review
 * plus fresh end-to-end (default + senior-advisory) proof.
 *
 * Fixture / contract verification:
 *   --allow-s17-pr-readiness-verification --confirm-s17-pr-readiness-verification
 *
 * Optional live senior (S17→S15→S14→S13, <=32 tokens):
 *   --allow-s17-live-senior-review --confirm-s17-live-senior-review
 *   --allow-request-time-nano-interruption --confirm-request-time-nano-interruption
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createPrReadinessDecisionWorkflow,
  S17_ARCHITECTURE,
  sha256Text,
  buildSeniorPrReadinessPrompt,
  assertNoAction as s17AssertNoAction,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s17-pr-readiness-decision";
import {
  createQualityReportDecisionWorkflow,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s16-quality-report-decision";
import { createSeniorReviewWorkflow } from "../../../src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow";
import {
  createSeniorAdapter,
  createSeniorApprovalArtifact,
  GATED_SENIOR_REGISTRY_AFTER,
  assertNoDefaultInvariants,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter";
import {
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
  VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
  VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
} from "../../../src/lib/engineer-console/worker/vera-pull-request-preparation-types";
import {
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
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
  const h = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const t = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const py = spawnSync(
    path.join(ROOT, ".venv-airllm/bin/python"),
    [
      "-c",
      "from pathlib import Path; from airllm.s13_service import build_s13_source_manifest, executable_fingerprint; "
        + "m=build_s13_source_manifest(Path('.')); e=executable_fingerprint(Path('.'), m); "
        + "import json; print(json.dumps({'manifestSha':m['manifestSha256'],'executableSourceSha256':e['executableSourceSha256']}))",
    ],
    { cwd: ROOT, env: { ...process.env, PYTHONPATH: path.join(ROOT, "vendor/airllm-nemotronh") }, encoding: "utf8" },
  );
  if (py.status !== 0) throw new Error(`baseline_fingerprint_failed:${py.stderr || py.stdout}`);
  const digests = JSON.parse(py.stdout.trim());
  writeJson(p, {
    ...baseline,
    branch: "feature/super-airllm-final-controlled-pilot",
    commit: h,
    treeSha: t,
    manifestSha: digests.manifestSha,
    sourceManifestSha256: digests.manifestSha,
    executableSourceSha256: digests.executableSourceSha256,
    updatedFor: "final_controlled_pilot_live_verification_descendant_fingerprint",
  });
}

function startS13Robust(stateRoot: string, logPath: string): ChildProcess {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(logPath, "");
  const out = require("fs").openSync(logPath, "a");
  return spawn(
    path.join(ROOT, "scripts/runtime/super-airllm/run-s13-local-service.sh"),
    [
      "--serve",
      "--bind-host",
      "127.0.0.1",
      "--bind-port",
      "8091",
      "--state-root",
      stateRoot,
      "--shutdown-deadline-seconds",
      "60",
      "--shutdown-mode",
      "cancel_active",
      "--allow-request-time-nano-interruption",
      "--confirm-request-time-nano-interruption",
      "--gpu-uuid",
      "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, S13_LOCAL_SERVICE_FOREGROUND: "1" },
      stdio: ["ignore", out, out],
      detached: true,
    },
  );
}

async function waitForS13(timeoutMs = 600_000): Promise<{ health: any; readiness: any }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    if (!portListening(8091)) {
      await sleep(1000);
      continue;
    }
    try {
      const health = await httpJson(`${S13_BASE}/v1/health`, undefined, 8000);
      const readiness = await httpJson(`${S13_BASE}/v1/readiness`, undefined, 8000);
      if (
        health.healthy &&
        !health.recoveryRequired &&
        !readiness.recoveryRequired &&
        readiness.acceptingRequests === true &&
        readiness.serviceReady !== false &&
        health.largeModelRunning !== true
      ) {
        return { health, readiness };
      }
      lastErr = `healthy=${health.healthy} accepting=${readiness.acceptingRequests} serviceReady=${readiness.serviceReady} recovery=${health.recoveryRequired || readiness.recoveryRequired} largeRunning=${health.largeModelRunning}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(2000);
  }
  throw new Error(`s13_not_ready_timeout:${lastErr}`);
}

async function stopS13Robust(proc: ChildProcess): Promise<{ exitCode: number | null; sigkillUsed: boolean }> {
  let sigkillUsed = false;
  try {
    await httpJson(`${S13_BASE}/v1/shutdown`, { method: "POST" }, 120_000);
  } catch {
    /* may already be stopping */
  }
  const exitCode: number | null = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (proc.pid) {
        try {
          process.kill(-proc.pid, "SIGKILL");
          sigkillUsed = true;
        } catch {
          try {
            process.kill(proc.pid, "SIGKILL");
            sigkillUsed = true;
          } catch {
            /* gone */
          }
        }
      }
      resolve(proc.exitCode);
    }, 180_000);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  return { exitCode, sigkillUsed };
}

/** Emulates the Phase 2X prepare on mark_pr_ready, no-op otherwise. */
function makeS17Applicator(calls: Array<Record<string, unknown>>) {
  return (input: {
    runId: string;
    decision: "mark_pr_ready" | "mark_pr_not_ready" | "request_pr_readiness_revision";
    confirmationText: string;
    requestedBy: string;
    note?: string | null;
  }) => {
    calls.push(input);
    if (input.decision === "mark_pr_ready") {
      if (input.confirmationText !== VERA_PULL_REQUEST_PREPARATION_CONFIRMATION) {
        throw new Error("confirmation_invalid");
      }
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
function makeS16Applicator(calls: Array<Record<string, unknown>>) {
  return (input: { runId: string; decision: "approved" | "rejected"; confirmationText: string; reviewer: string }) => {
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

function samplePrep(sha: string) {
  return {
    artifactPath: "/tmp/final/implementation-pull-request-preparation.json",
    artifactSha256: sha,
    schemaVersion: VERA_PULL_REQUEST_PREPARATION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    branchName: "feature/final-controlled-pilot",
    commitSha: "commit-final-abc",
    qualityReportSha256: "qr-final-hash",
  };
}

async function main(): Promise<void> {
  const authorized = argsHave(
    "--allow-s17-pr-readiness-verification",
    "--confirm-s17-pr-readiness-verification",
  );
  const liveSenior = argsHave(
    "--allow-s17-live-senior-review",
    "--confirm-s17-live-senior-review",
  );
  const nanoAuth = argsHave(
    "--allow-request-time-nano-interruption",
    "--confirm-request-time-nano-interruption",
  );

  const runId = `final-cp-${utcStamp()}`;
  const artRoot = path.join(ROOT, ".download-logs/super-airllm-final-closure", runId);
  mkdirSync(artRoot, { recursive: true });
  const log = (msg: string) => {
    console.error(`[FINAL] ${msg}`);
    writeFileSync(path.join(artRoot, "stdout.log"), `[FINAL] ${msg}\n`, { flag: "a" });
  };

  writeJson(path.join(artRoot, "authorization.json"), {
    verificationAuthorized: authorized,
    liveSeniorAuthorized: liveSenior,
    nanoAuthorized: nanoAuth,
    argv: process.argv.slice(2),
  });

  if (!authorized) {
    const result = {
      phase: "FINAL",
      verdict: "super_airllm_final_closure_blocked",
      status: "FINAL CLOSURE BLOCKED",
      reason: "verification_not_authorized",
    };
    writeJson(path.join(artRoot, "result.json"), result);
    writeJson(path.join(ROOT, ".download-logs/super-airllm-final-closure-result.json"), result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }

  assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);

  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  writeJson(path.join(artRoot, "architecture.json"), S17_ARCHITECTURE);
  writeJson(path.join(artRoot, "baseline-commits.json"), {
    s13_1: "79bc766dc49be756fa4154097348a8f56183a751",
    s15: "e0b6173e292c02b8925ee08994d60163237e1419",
    s15_1ExecutableTip: "1846495ec119afcbf568f2377de9b7abbb79619e",
    s16Commit: "1a57426c508a703a57878bcf428431addc5c5817",
    s16ExecutableTip: "c6fcc7e21a344fec6a15c02ad604bebf4e2f5e6f",
    s16DocumentationTip: "becc7b2731162a90bc1ec925016762f6c2a12ce9",
    s17Commit: "1333b7e19565b02e09f496375e2d2fb6f140e9cc",
    finalClosureBranch: "feature/super-airllm-final-controlled-pilot",
    verificationHead: head,
    verificationTree: tree,
  });

  const scenarios: Record<string, unknown> = {};
  const s17Calls: Array<Record<string, unknown>> = [];
  const { workflow: s17 } = createPrReadinessDecisionWorkflow({
    stateRoot: path.join(artRoot, "s17-state"),
    applyLifecycleDefault: makeS17Applicator(s17Calls),
  });
  const prepSha = sha256Text("pr-preparation-final-v1");

  // Scenario 1: default-only PR readiness
  log("s17 scenario1 default-only");
  const c1 = s17.createContext({ runId: `${runId}-s1`, prPreparation: samplePrep(prepSha) });
  writeJson(path.join(artRoot, "default-reviews/s17-sc1.json"), c1.defaultReview);
  const a1 = s17.applyOperatorDecision({
    decisionContextId: c1.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: c1.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: c1.defaultReview.contentSha256,
    operatorId: "final-operator",
  });
  scenarios.scenario1 = {
    ok:
      a1.state === "operator_ready" &&
      a1.lifecycleEffect.resultingStep === VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP &&
      a1.lifecycleEffect.prCreationAuthorized === false &&
      s17Calls.length === 1,
  };

  // Scenario 2: senior without execution approval blocked
  log("s17 scenario2 blocked senior");
  const c2 = s17.createContext({ runId: `${runId}-s2`, prPreparation: samplePrep(prepSha) });
  const blocked = s17.markSeniorExecutionBlocked(c2.decisionContextId);
  scenarios.scenario2 = {
    ok:
      blocked.state === "senior_execution_blocked" &&
      blocked.lifecycleEffect.prReadinessDecision === "pending",
  };

  // Scenario 3 fixture part is covered by live (below); fixture unaccepted senior:
  log("s17 scenario3 unaccepted senior fixture");
  let c3 = s17.createContext({ runId: `${runId}-s3`, prPreparation: samplePrep(prepSha) });
  c3 = s17.recordUnacceptedSenior(c3.decisionContextId, {
    reviewBundleId: "s3-bundle",
    reviewId: "s3-senior",
    content: "recommendation: ready",
    contentSha256: sha256Text("recommendation: ready"),
    executionApprovalReference: "s3-exec",
  });
  scenarios.scenario3Fixture = {
    ok:
      c3.seniorReview?.accepted === false &&
      c3.recommendationSummary.seniorRecommendation === null,
  };

  // Scenario 4: accepted senior recommend ready; operator follows (fixture S15)
  log("s17 scenario4-5 accepted senior follow/override");
  const { workflow: s15fix } = createSeniorReviewWorkflow({
    stateRoot: path.join(artRoot, "s15-fixture-state"),
  });
  function acceptFixtureSenior(bundleRun: string, content: string) {
    const bundle = s15fix.createDefaultReview({ runId: bundleRun, defaultContent: "default pr readiness" });
    const pend = s15fix.recordSeniorResult({
      reviewBundleId: bundle.reviewBundleId,
      content,
      generatedTokenIds: [1, 2, 3],
      tokensCompleted: 3,
      requestedMaxNewTokens: 32,
      completionReason: "fixture",
      complete: true,
      s15AcceptanceEligible: true,
      syntheticOrFixture: true,
    });
    const acc = s15fix.applyOperatorDecision({
      reviewBundleId: bundle.reviewBundleId,
      decision: "accept_senior",
      reviewedDefaultSha256: pend.defaultReview.contentSha256,
      reviewedSeniorSha256: pend.seniorReview!.contentSha256,
      reviewedComparisonSha256: pend.comparison!.comparisonSha256,
      operatorId: "final-s15-acceptor",
    });
    return acc;
  }
  const accReady = acceptFixtureSenior(`${runId}-s4`, "recommendation: ready");
  let c4 = s17.createContext({ runId: `${runId}-s4`, prPreparation: samplePrep(prepSha) });
  c4 = s17.attachAcceptedSenior({
    decisionContextId: c4.decisionContextId,
    reviewBundleId: accReady.reviewBundleId,
    reviewId: accReady.seniorReview!.reviewId,
    content: "recommendation: ready",
    contentSha256: accReady.seniorReview!.contentSha256,
    comparisonSha256: accReady.comparison!.comparisonSha256,
    executionApprovalReference: "final-exec-4",
    acceptanceDecisionReference: accReady.operatorDecision!.decisionId,
  });
  const followReady = s17.applyOperatorDecision({
    decisionContextId: c4.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: c4.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: c4.defaultReview.contentSha256,
    reviewedSeniorReviewSha256: c4.seniorReview!.contentSha256,
    reviewedComparisonSha256: c4.seniorReview!.comparisonSha256,
    seniorReviewConsidered: true,
    operatorId: "final-operator",
  });
  scenarios.scenario4 = {
    ok: followReady.operatorDecision?.followedSeniorRecommendation === true && followReady.state === "operator_ready",
  };

  // Scenario 5: operator overrides senior not_ready → mark ready
  const accNotReady = acceptFixtureSenior(`${runId}-s5`, "recommendation: not_ready");
  let c5 = s17.createContext({
    runId: `${runId}-s5`,
    prPreparation: samplePrep(prepSha),
    defaultRecommendation: "ready",
  });
  c5 = s17.attachAcceptedSenior({
    decisionContextId: c5.decisionContextId,
    reviewBundleId: accNotReady.reviewBundleId,
    reviewId: accNotReady.seniorReview!.reviewId,
    content: "recommendation: not_ready",
    contentSha256: accNotReady.seniorReview!.contentSha256,
    comparisonSha256: accNotReady.comparison!.comparisonSha256,
    executionApprovalReference: "final-exec-5",
    acceptanceDecisionReference: accNotReady.operatorDecision!.decisionId,
  });
  const overrideNotReady = s17.applyOperatorDecision({
    decisionContextId: c5.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: c5.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: c5.defaultReview.contentSha256,
    reviewedSeniorReviewSha256: c5.seniorReview!.contentSha256,
    reviewedComparisonSha256: c5.seniorReview!.comparisonSha256,
    seniorReviewConsidered: true,
  });
  scenarios.scenario5 = {
    ok:
      overrideNotReady.operatorDecision?.followedSeniorRecommendation === false &&
      overrideNotReady.recommendationSummary.disagreements.length > 0,
  };

  // Scenario 6: stale prep
  log("s17 scenario6 stale");
  let c6 = s17.createContext({ runId: `${runId}-s6`, prPreparation: samplePrep(prepSha) });
  c6 = s17.attachAcceptedSenior({
    decisionContextId: c6.decisionContextId,
    reviewBundleId: "s6-b",
    reviewId: "s6-s",
    content: "recommendation: ready",
    contentSha256: sha256Text("recommendation: ready"),
    comparisonSha256: "cmp6",
    executionApprovalReference: "e6",
    acceptanceDecisionReference: "a6",
  });
  const stale = s17.invalidateForChangedArtifacts(c6.decisionContextId, {
    prPreparationSha256: sha256Text("changed-prep"),
    defaultReviewSha256: c6.defaultReview.contentSha256,
  });
  let staleRejected = false;
  try {
    s17.applyOperatorDecision({
      decisionContextId: c6.decisionContextId,
      decision: "mark_pr_ready",
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      reviewedPrPreparationSha256: prepSha,
      reviewedDefaultReviewSha256: c6.defaultReview.contentSha256,
      reviewedSeniorReviewSha256: c6.seniorReview!.contentSha256,
      seniorReviewConsidered: true,
    });
  } catch {
    staleRejected = true;
  }
  scenarios.scenario6 = { ok: stale.state === "stale" && stale.seniorReview?.stale === true && staleRejected };

  // Scenario 7: duplicate + conflict
  log("s17 scenario7 idempotency + conflict");
  const callsBefore = s17Calls.length;
  const c7 = s17.createContext({ runId: `${runId}-s7`, prPreparation: samplePrep(prepSha) });
  const op1 = s17.applyOperatorDecision({
    decisionContextId: c7.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: c7.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: c7.defaultReview.contentSha256,
  });
  const op2 = s17.applyOperatorDecision({
    decisionContextId: c7.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: c7.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: c7.defaultReview.contentSha256,
  });
  let conflictRejected = false;
  try {
    s17.applyOperatorDecision({
      decisionContextId: c7.decisionContextId,
      decision: "mark_pr_not_ready",
      reviewedPrPreparationSha256: c7.prPreparation.artifactSha256,
      reviewedDefaultReviewSha256: c7.defaultReview.contentSha256,
    });
  } catch {
    conflictRejected = true;
  }
  scenarios.scenario7 = {
    ok:
      op2.operatorDecision?.decisionId === op1.operatorDecision?.decisionId &&
      s17Calls.length === callsBefore + 1 &&
      conflictRejected,
  };

  // Scenario 8: cancellation / recovery
  log("s17 scenario8 cancellation");
  let c8 = s17.createContext({ runId: `${runId}-s8`, prPreparation: samplePrep(prepSha) });
  c8 = s17.markSeniorFailed(c8.decisionContextId, "cancelled");
  const a8 = s17.applyOperatorDecision({
    decisionContextId: c8.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: c8.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: c8.defaultReview.contentSha256,
  });
  scenarios.scenario8 = { ok: c8.state === "senior_cancelled" && a8.state === "operator_ready" };

  // Scenario 9: no-action boundary (attempt PR creation etc.)
  log("s17 scenario9 no-action");
  const noAction = (["apply_patch", "git_commit", "push_branch", "create_pr", "approve_pr", "merge", "deploy"] as const).map(
    (a) => s17AssertNoAction(a),
  );
  scenarios.scenario9 = { ok: noAction.every((r) => r.allowed === false) };

  // Scenario 10: no-default regression
  scenarios.scenario10 = {
    ok:
      S17_ARCHITECTURE.automaticSeniorSelection === false &&
      S17_ARCHITECTURE.defaultSeniorRoute === false &&
      S17_ARCHITECTURE.prCreationRemainsSeparatelyGated === true &&
      S17_ARCHITECTURE.maxNewTokens === 32,
  };

  writeJson(path.join(artRoot, "s17-scenarios.json"), scenarios);

  // ---------- End-to-end default path (Variant A) ----------
  log("end-to-end Variant A default-only");
  const s16CallsA: Array<Record<string, unknown>> = [];
  const s17CallsA: Array<Record<string, unknown>> = [];
  const { workflow: s16A } = createQualityReportDecisionWorkflow({
    stateRoot: path.join(artRoot, "e2e-a-s16"),
    applyLifecycleDefault: makeS16Applicator(s16CallsA),
  });
  const { workflow: s17A } = createPrReadinessDecisionWorkflow({
    stateRoot: path.join(artRoot, "e2e-a-s17"),
    applyLifecycleDefault: makeS17Applicator(s17CallsA),
  });
  const e2eReportContent = JSON.stringify({
    schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
    runId: `${runId}-e2eA`,
    overallStatus: "passed",
    gateResults: [{ gateId: "deterministic", status: "passed", message: "ok" }],
  });
  const e2eReportSha = sha256Text(e2eReportContent);
  const qcA = s16A.createContext({
    runId: `${runId}-e2eA`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/e2eA.json"),
      artifactSha256: e2eReportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  const qcADecision = s16A.applyOperatorDecision({
    decisionContextId: qcA.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: qcA.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: qcA.defaultReview.contentSha256,
    operatorId: "final-operator",
  });
  const prA = s17A.createContext({
    runId: `${runId}-e2eA`,
    prPreparation: samplePrep(sha256Text("e2eA-prep")),
    qualityReportSha256: e2eReportSha,
  });
  const prADecision = s17A.applyOperatorDecision({
    decisionContextId: prA.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: prA.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: prA.defaultReview.contentSha256,
    operatorId: "final-operator",
  });
  const variantA = {
    ok:
      qcADecision.state === "operator_approved" &&
      prADecision.state === "operator_ready" &&
      s16CallsA.length === 1 &&
      s17CallsA.length === 1 &&
      prADecision.lifecycleEffect.prCreationAuthorized === false,
    qualityReportDecision: qcADecision.operatorDecision?.decision,
    prReadinessDecision: prADecision.operatorDecision?.decision,
    prCreationPending: true,
    seniorUsed: false,
  };
  writeJson(path.join(artRoot, "end-to-end-default-path.json"), variantA);

  // ---------- End-to-end senior-advisory path (Variant B) ----------
  log("end-to-end Variant B senior-advisory (follow one, override other)");
  const s16CallsB: Array<Record<string, unknown>> = [];
  const s17CallsB: Array<Record<string, unknown>> = [];
  const { workflow: s16B } = createQualityReportDecisionWorkflow({
    stateRoot: path.join(artRoot, "e2e-b-s16"),
    applyLifecycleDefault: makeS16Applicator(s16CallsB),
  });
  const { workflow: s17B } = createPrReadinessDecisionWorkflow({
    stateRoot: path.join(artRoot, "e2e-b-s17"),
    applyLifecycleDefault: makeS17Applicator(s17CallsB),
  });
  // Quality-report: senior recommends reject; operator OVERRIDES -> approve.
  const qcB = s16B.createContext({
    runId: `${runId}-e2eB`,
    qualityReport: {
      artifactPath: path.join(artRoot, "quality-reports/e2eB.json"),
      artifactSha256: e2eReportSha,
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      overallStatus: "passed",
    },
  });
  const qcBWithSenior = s16B.attachAcceptedSenior({
    decisionContextId: qcB.decisionContextId,
    reviewBundleId: "e2eB-qr-bundle",
    reviewId: "e2eB-qr-senior",
    content: "recommendation: reject\nfinding: coverage gap",
    contentSha256: sha256Text("recommendation: reject\nfinding: coverage gap"),
    comparisonSha256: "e2eB-qr-cmp",
    executionApprovalReference: "e2eB-qr-exec",
    acceptanceDecisionReference: "e2eB-qr-acc",
  });
  const qcBDecision = s16B.applyOperatorDecision({
    decisionContextId: qcB.decisionContextId,
    decision: "approve_quality_report",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewedQualityReportSha256: qcB.qualityReport.artifactSha256,
    reviewedDefaultReviewSha256: qcB.defaultReview.contentSha256,
    reviewedSeniorReviewSha256: qcBWithSenior.seniorReview!.contentSha256,
    reviewedComparisonSha256: "e2eB-qr-cmp",
    seniorReviewConsidered: true,
    operatorId: "final-operator",
  });
  // PR-readiness: senior recommends ready; operator FOLLOWS -> mark ready.
  const prB = s17B.createContext({
    runId: `${runId}-e2eB`,
    prPreparation: samplePrep(sha256Text("e2eB-prep")),
    qualityReportSha256: e2eReportSha,
  });
  const prBWithSenior = s17B.attachAcceptedSenior({
    decisionContextId: prB.decisionContextId,
    reviewBundleId: "e2eB-pr-bundle",
    reviewId: "e2eB-pr-senior",
    content: "recommendation: ready",
    contentSha256: sha256Text("recommendation: ready"),
    comparisonSha256: "e2eB-pr-cmp",
    executionApprovalReference: "e2eB-pr-exec",
    acceptanceDecisionReference: "e2eB-pr-acc",
  });
  const prBDecision = s17B.applyOperatorDecision({
    decisionContextId: prB.decisionContextId,
    decision: "mark_pr_ready",
    confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
    reviewedPrPreparationSha256: prB.prPreparation.artifactSha256,
    reviewedDefaultReviewSha256: prB.defaultReview.contentSha256,
    reviewedSeniorReviewSha256: prBWithSenior.seniorReview!.contentSha256,
    reviewedComparisonSha256: "e2eB-pr-cmp",
    seniorReviewConsidered: true,
    operatorId: "final-operator",
  });
  const variantB = {
    ok:
      qcBDecision.operatorDecision?.followedSeniorRecommendation === false &&
      prBDecision.operatorDecision?.followedSeniorRecommendation === true &&
      qcBDecision.state === "operator_approved" &&
      prBDecision.state === "operator_ready" &&
      prBDecision.lifecycleEffect.prCreationAuthorized === false,
    qualityReportSeniorRecommendation: "reject",
    qualityReportOperatorDecision: qcBDecision.operatorDecision?.decision,
    qualityReportOverrodeSenior: qcBDecision.operatorDecision?.followedSeniorRecommendation === false,
    prReadinessSeniorRecommendation: "ready",
    prReadinessOperatorDecision: prBDecision.operatorDecision?.decision,
    prReadinessFollowedSenior: prBDecision.operatorDecision?.followedSeniorRecommendation === true,
    prCreationPending: true,
  };
  writeJson(path.join(artRoot, "end-to-end-senior-path.json"), variantB);

  writeJson(path.join(artRoot, "approval-boundaries.json"), {
    seniorExecutionApproval: "separate (S14 one-use approval authorizes S13 request only)",
    seniorReviewAcceptance: "separate (S15 accept_senior binds exact artifact)",
    qualityReportOperatorDecision: "separate (S16 approve/reject)",
    prReadinessOperatorDecision: "separate (S17 mark_pr_ready/not_ready/revision)",
    prCreationApproval: "separate (Phase 2Y CREATE VERA PULL REQUEST; not authorized by S16/S17)",
    noEarlierGateSubstitutesForLater: true,
  });
  writeJson(path.join(artRoot, "no-action-proof.json"), {
    patchAppliedBySenior: false,
    commitCreatedBySenior: false,
    branchPushedBySenior: false,
    pullRequestCreatedBySenior: false,
    mergePerformedBySenior: false,
    deploymentPerformedBySenior: false,
    prCreationGateRemainsPending: true,
  });

  // ---------- Live S17 PR-readiness senior review ----------
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
      log("starting S13 service (robust launcher)");
      s13Proc = startS13Robust(
        path.join(artRoot, "s13-state"),
        path.join(artRoot, "s13-stdout.log"),
      );
    }
    log("waiting for S13 to accept requests (may take minutes)");
    await waitForS13(600_000);
    log("live PR-readiness senior review via S17→S15→S14→S13");
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
    const liveCtx = s17.createContext({
      runId: `${runId}-live`,
      prPreparation: samplePrep(sha256Text("live-pr-prep")),
      qualityReportSha256: e2eReportSha,
    });
    const livePrompt = buildSeniorPrReadinessPrompt({
      prPreparationSummary: liveCtx.defaultReview.content,
      prPreparationSha256: liveCtx.prPreparation.artifactSha256,
      qualityReportSha256: liveCtx.qualityReportSha256,
      defaultReviewContent: liveCtx.defaultReview.content,
      defaultReviewSha256: liveCtx.defaultReview.contentSha256,
      branchName: liveCtx.branchName,
      commitSha: liveCtx.targetCommit,
    });
    writeJson(path.join(artRoot, "senior-review-bundles/live-prompt.json"), livePrompt);
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
      defaultContent: liveCtx.defaultReview.content,
    });
    const requested = await liveS15.requestSeniorReview({
      reviewBundleId: liveBundle.reviewBundleId,
      approvalReference: `s17-live-apr-${runId}`,
      executionApprovalPresent: true,
      prompt: livePrompt.prompt,
      maxNewTokens: 32,
      idempotencyKey: `s17-live-${runId}`,
    });
    const corr = liveCorr;
    const tokenIds = (corr?.result?.generatedTokens || []).map((t: any) => t.tokenId);
    const decoded = (corr?.result?.generatedTokens || []).map((t: any) => t.decoded).join("");
    const complete = corr?.state === "senior_completed" && tokenIds.length >= 1;
    let acceptance: any = null;
    let liveOperatorDecision: any = null;
    let liveCtxFinal: any = liveCtx;
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
        operatorId: "s17-live-acceptor",
      });
      writeJson(path.join(artRoot, "acceptance-decisions/live.json"), acceptance.operatorDecision);
      liveCtxFinal = s17.attachAcceptedSenior({
        decisionContextId: liveCtx.decisionContextId,
        reviewBundleId: acceptance.reviewBundleId,
        reviewId: acceptance.seniorReview!.reviewId,
        content: decoded || JSON.stringify({ tokenIds }),
        contentSha256: acceptance.seniorReview!.contentSha256,
        comparisonSha256: acceptance.comparison!.comparisonSha256,
        executionApprovalReference: `s17-live-apr-${runId}`,
        acceptanceDecisionReference: acceptance.operatorDecision!.decisionId,
        promptSha256: livePrompt.promptSha256,
        generatedTokenIds: tokenIds,
        completionReason: tokenIds.length < 32 ? "eos" : "max_new_tokens",
        s14CorrelationId: corr?.veraRequestId,
        s13RequestId: corr?.s13RequestId ?? undefined,
      });
      // Operator applies an explicit decision after considering the live senior.
      liveOperatorDecision = s17.applyOperatorDecision({
        decisionContextId: liveCtx.decisionContextId,
        decision: "mark_pr_ready",
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        reviewedPrPreparationSha256: liveCtxFinal.prPreparation.artifactSha256,
        reviewedDefaultReviewSha256: liveCtxFinal.defaultReview.contentSha256,
        reviewedSeniorReviewSha256: liveCtxFinal.seniorReview!.contentSha256,
        reviewedComparisonSha256: liveCtxFinal.seniorReview!.comparisonSha256,
        seniorReviewConsidered: true,
        operatorId: "final-operator",
      });
      writeJson(path.join(artRoot, "decision-contexts/live-applied.json"), liveOperatorDecision);
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
      seniorRecommendation: liveCtxFinal?.seniorReview?.recommendation ?? null,
      operatorDecision: liveOperatorDecision?.operatorDecision?.decision ?? null,
      followedSeniorRecommendation:
        liveOperatorDecision?.operatorDecision?.followedSeniorRecommendation ?? null,
      resultingStep: liveOperatorDecision?.lifecycleEffect?.resultingStep ?? null,
      prCreationAuthorized: liveOperatorDecision?.lifecycleEffect?.prCreationAuthorized ?? false,
      state: corr?.state,
    };
    writeJson(path.join(artRoot, "senior-review-bundles/live.json"), liveSeniorReview);
    scenarios.scenarioLive = {
      ok: complete && Boolean(acceptance) && Boolean(liveOperatorDecision),
    };

    if (startedHere && s13Proc) {
      log("stopping S13 (S13.1 bounded shutdown)");
      const shutdownStart = Date.now();
      const { exitCode, sigkillUsed } = await stopS13Robust(s13Proc);
      await sleep(2000);
      shutdownResult = {
        attempted: true,
        s13Stopped: !portListening(8091),
        port8091Released: !portListening(8091),
        exitCode,
        shutdownMs: Date.now() - shutdownStart,
        sigkillUsed,
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

  const fixtureOk = Object.entries(scenarios)
    .filter(([k]) => k !== "scenarioLive")
    .every(([, s]: [string, any]) => s.ok);
  const liveOk = !liveSenior || Boolean((scenarios.scenarioLive as any)?.ok);
  const e2eOk = variantA.ok && variantB.ok;
  const ready = fixtureOk && liveOk && e2eOk;

  const result = {
    phase: "FINAL",
    runId,
    timestamp: new Date().toISOString(),
    verdict: ready
      ? liveSenior
        ? "super_airllm_controlled_pilot_ready"
        : "super_airllm_runtime_ready_lifecycle_incomplete"
      : "super_airllm_final_closure_failed",
    status: ready
      ? liveSenior
        ? "VERALUX SUPER CONTROLLED PILOT READY"
        : "RUNTIME READY / LIFECYCLE INCOMPLETE"
      : "FINAL CLOSURE FAILED",
    liveSeniorPerformed: liveSenior,
    baseline: {
      s16DocumentationTip: "becc7b2731162a90bc1ec925016762f6c2a12ce9",
      s17Commit: "1333b7e19565b02e09f496375e2d2fb6f140e9cc",
      verificationHead: head,
      verificationTree: tree,
    },
    s17Scenarios: scenarios,
    endToEndDefault: variantA,
    endToEndSenior: variantB,
    liveSeniorReview,
    boundaries: {
      patchApplied: false,
      commitCreated: false,
      pullRequestCreated: false,
      mergePerformed: false,
      deploymentPerformed: false,
    },
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

  writeJson(path.join(artRoot, "result.json"), result);
  writeJson(path.join(ROOT, ".download-logs/super-airllm-final-closure-result.json"), result);
  writeJson(
    path.join(ROOT, `.download-logs/super-airllm-final-closure-result-${utcStamp()}.json`),
    result,
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(ready ? 0 : 1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const result = {
    phase: "FINAL",
    verdict: "super_airllm_final_closure_failed",
    status: "FINAL CLOSURE FAILED",
    error: message,
  };
  try {
    writeJson(path.join(ROOT, ".download-logs/super-airllm-final-closure-result.json"), result);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
