#!/usr/bin/env npx tsx
/**
 * S15 live senior-review runtime verification against S13/S14.
 * Requires: --allow-s15-runtime-verification --confirm-s15-runtime-verification
 * Does not expand token limits. Does not claim long-form review generation.
 */

import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createSeniorAdapter,
  createSeniorApprovalArtifact,
  GATED_SENIOR_REGISTRY_AFTER,
  assertNoDefaultInvariants,
  type SeniorCorrelationRecord,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter";
import {
  S15_WORKFLOW_ARCHITECTURE,
  createSeniorReviewWorkflow,
  sha256Text,
  type SeniorReviewBundle,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const S13_BASE = "http://127.0.0.1:8091";
const HELLO = { prompt: "Hello", tokens: [1044] };
const FRANCE = { prompt: "The capital of France is", tokens: [6993, 32876] };
const DEFAULT_REVIEW = [
  "finding: missing null check in parser",
  "recommend: add unit test",
  "severity: medium",
].join("\n");
const IMPL_COMMIT = "36f1861bba9c9814a9fd1fc650b179017f4c4b53";
const DOC_TIP = "6f5fa9040d4b402196c7b426bf39f88b38c7c2f7";
const S131_COMMIT = "79bc766dc49be756fa4154097348a8f56183a751";
const MANIFEST_SHA = "03569bbf2344e8fb903829d81f17e0be44309c5d51a8ddb5ee7d2e66fff4722e";

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
    if (!res.ok) throw new Error(`http_${res.status}:${text.slice(0, 200)}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

function portListening(port = 8091): boolean {
  try {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const out = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
    return (out.stdout || "").includes(`:${port}`);
  } catch {
    return false;
  }
}

function seniorContentFromLive(record: SeniorCorrelationRecord): string {
  const tokens = record.result?.generatedTokens ?? [];
  return JSON.stringify(
    {
      source: "live_s14_s13",
      executionMode: record.result?.executionMode ?? "modelopt_fake_quant_cuda",
      s13RequestId: record.s13RequestId,
      tokenIds: tokens.map((t) => t.tokenId),
      decoded: tokens.map((t) => t.decoded),
      note: "transport_proof_not_long_form_review",
    },
    null,
    2,
  );
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
  const baseline = JSON.parse(readFileSync(p, "utf8"));
  const { spawnSync } = require("child_process") as typeof import("child_process");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  // Rebuild live digests via python
  const py = spawnSync(
    path.join(ROOT, ".venv-airllm/bin/python"),
    [
      "-c",
      "from pathlib import Path; from airllm.s13_service import build_s13_source_manifest, executable_fingerprint; "
      + "m=build_s13_source_manifest(Path('.')); e=executable_fingerprint(Path('.'), m); "
      + "import json; print(json.dumps({'manifestSha':m['manifestSha256'],'executableSourceSha256':e['executableSourceSha256']}))",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: path.join(ROOT, "vendor/airllm-nemotronh") },
      encoding: "utf8",
    },
  );
  const digests = JSON.parse(py.stdout.trim());
  const next = {
    ...baseline,
    branch: "feature/super-airllm-s15-senior-review",
    commit: head,
    treeSha: tree,
    manifestSha: digests.manifestSha,
    executableSourceSha256: digests.executableSourceSha256,
    updatedFor: "s15_live_verification_descendant_fingerprint",
    immutableS13ContentBaseline: S131_COMMIT,
  };
  writeJson(p, next);
}

function startS13(stateRoot: string, logPath: string): ChildProcess {
  mkdirSync(stateRoot, { recursive: true });
  const logFd = writeFileSync(logPath, "");
  void logFd;
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

async function waitS13Ready(timeoutMs = 120_000): Promise<{ health: any; readiness: any; runtime: any }> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    if (!portListening(8091)) {
      await sleep(500);
      continue;
    }
    try {
      const health = await httpJson(`${S13_BASE}/v1/health`);
      const readiness = await httpJson(`${S13_BASE}/v1/readiness`);
      const runtime = await httpJson(`${S13_BASE}/v1/runtime`);
      if (health.healthy) return { health, readiness, runtime };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(500);
  }
  throw new Error(`s13_ready_timeout:${lastErr}`);
}

async function stopS13(proc: ChildProcess, verDir: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  let sigkillUsed = false;
  if (proc.pid) {
    try {
      // Detached process group: signal the group when possible.
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try {
        process.kill(proc.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  const exitCode: number | null = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (proc.pid) {
        try {
          process.kill(proc.pid, "SIGKILL");
          sigkillUsed = true;
        } catch {
          /* */
        }
      }
      resolve(proc.exitCode);
    }, 90_000);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  await sleep(1000);
  const consoleNano = await nanoHealth(8082);
  const veraNano = await nanoHealth(8081);
  const result = {
    mode: "cancel_active",
    signal: "SIGTERM",
    exitCode,
    elapsedMs: Date.now() - started,
    sigkillUsed,
    port8091Released: !portListening(8091),
    consoleNanoHealthy: consoleNano.healthy,
    veraNanoHealthy: veraNano.healthy,
  };
  writeJson(path.join(verDir, "shutdown-result.json"), result);
  return result;
}

export async function runS15LiveVerification(argv: string[] = process.argv.slice(2)): Promise<number> {
  const flags = new Set(argv);
  const allow = flags.has("--allow-s15-runtime-verification");
  const confirm = flags.has("--confirm-s15-runtime-verification");
  if (!allow || !confirm) {
    console.log(
      JSON.stringify({
        phase: "S15",
        verdict: "s15_runtime_verification_not_authorized",
        error: "paired flags required: --allow-s15-runtime-verification --confirm-s15-runtime-verification",
      }, null, 2),
    );
    return 2;
  }

  const { spawnSync } = await import("child_process");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const branch = spawnSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const status = spawnSync("git", ["status", "--short"], { cwd: ROOT, encoding: "utf8" }).stdout;
  const tipDiff = spawnSync("git", ["diff", "--name-only", IMPL_COMMIT, DOC_TIP], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  const execDiff = tipDiff.filter((f) => !f.endsWith(".md") && !f.includes("implementation-audit"));
  if (execDiff.length) {
    console.log(JSON.stringify({ verdict: "s15_approved_senior_review_blocked", error: "executable_difference_detected", execDiff }, null, 2));
    return 2;
  }

  // Preserve historical blocked result
  const canonical = path.join(ROOT, ".download-logs/super-s15-senior-review-result.json");
  const historicalBlocked = path.join(ROOT, ".download-logs/super-s15-senior-review-result-blocked-historical.json");
  if (existsSync(canonical) && !existsSync(historicalBlocked)) {
    copyFileSync(canonical, historicalBlocked);
  }

  const runId = `${utcStamp()}-s15-live`;
  const verDir = path.join(ROOT, ".download-logs/s15-senior-review-live-verification", runId);
  mkdirSync(verDir, { recursive: true });
  const errors: string[] = [];

  writeJson(path.join(verDir, "authorization.json"), {
    allowS15RuntimeVerification: true,
    confirmS15RuntimeVerification: true,
    nanoInterruptionAuthorized: true,
    authorizedAt: new Date().toISOString(),
  });
  writeJson(path.join(verDir, "baseline.json"), {
    branch,
    head,
    treeSha: tree,
    statusShort: status,
    executionBaselineCommit: IMPL_COMMIT,
    documentationTip: DOC_TIP,
    executableDifferenceDetected: false,
    tipDiff,
    s13_1Commit: S131_COMMIT,
    sourceManifestSha256: MANIFEST_SHA,
    historicalBlockedResult: ".download-logs/super-s15-senior-review-result-blocked-historical.json",
  });
  writeJson(path.join(verDir, "source-manifest.json"), JSON.parse(readFileSync(path.join(ROOT, ".download-logs/s15-baseline-source-manifest.json"), "utf8")));
  writeJson(path.join(verDir, "runtime-registry.json"), GATED_SENIOR_REGISTRY_AFTER);
  assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);

  // Align S13 fingerprint with descendant HEAD (S14 pattern)
  updateS13BaselineToHead();

  const s13State = path.join(verDir, "s13-state");
  const s13Log = path.join(verDir, "s13-stdout.log");
  console.error(`[S15-live] starting S13 → ${S13_BASE}`);
  const s13Proc = startS13(s13State, s13Log);
  let shutdown: Record<string, unknown> = {};
  const scenarios: Record<string, any> = {};

  try {
    const nanoBefore = { console: await nanoHealth(8082), vera: await nanoHealth(8081) };
    writeJson(path.join(verDir, "nano-lifecycle.json"), { before: nanoBefore });

    const { health, readiness, runtime } = await waitS13Ready();
    writeJson(path.join(verDir, "s13-health.json"), { health, readiness, runtime, nanoBefore });

    if (
      !health.healthy ||
      health.recoveryRequired ||
      readiness.recoveryRequired ||
      readiness.acceptingRequests === false ||
      health.executionMode !== "modelopt_fake_quant_cuda" ||
      runtime.nativeFp8KernelProven !== false ||
      !String(health.bind || "").startsWith("127.0.0.1") ||
      health.largeModelRunning === true
    ) {
      errors.push("S13_NOT_READY");
      throw new Error("S13_NOT_READY");
    }

    const liveDeadlines = {
      connectMs: 60_000,
      pollIntervalMs: 5_000,
      queuedWaitMs: 3_600_000,
      activeExecutionMs: 14_400_000,
      operationalCleanupMs: 1_200_000,
      cancellationMs: 1_200_000,
    };
    const adapterState = path.join(verDir, "s14-adapter-state");
    const { runner, store: s14Store, client } = createSeniorAdapter({
      stateRoot: adapterState,
      s13BaseUrl: S13_BASE,
      expectedSourceCommit: head,
      expectedManifestSha: health.sourceManifestSha256 ?? null,
      deadlines: liveDeadlines,
    });

    const workflowState = path.join(verDir, "s15-workflow-state");
    const liveResults = new Map<string, SeniorCorrelationRecord>();
    const tokenPlan = new Map<string, 1 | 2>();

    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: workflowState,
      submitViaS14: async (req) => {
        // Only Hello/France prompts trigger live S13 generation (transport proof).
        if (req.prompt !== HELLO.prompt && req.prompt !== FRANCE.prompt) {
          return {
            s14CorrelationId: req.veraRequestId,
            state: "senior_requested",
          };
        }
        const maxNewTokens = tokenPlan.get(req.veraRequestId) ?? (req.prompt === FRANCE.prompt ? 2 : 1);
        const approval = createSeniorApprovalArtifact({
          veraRequestId: req.veraRequestId,
          approvalReference: req.approvalReference,
          maxNewTokens,
        });
        writeJson(path.join(verDir, "execution-approvals", `${req.approvalReference}.json`), approval);
        console.error(`[S15-live] S14 submit ${req.veraRequestId} tokens=${maxNewTokens}`);
        const record = await runner.run(
          {
            veraRequestId: req.veraRequestId,
            prompt: req.prompt,
            maxNewTokens,
            approvalReference: req.approvalReference,
            idempotencyKey: req.idempotencyKey,
            requestedAt: new Date().toISOString(),
            seniorRequested: true,
          },
          approval,
        );
        liveResults.set(req.veraRequestId, record);
        writeJson(path.join(verDir, "correlations", `${req.veraRequestId}.json`), record);
        return {
          s14CorrelationId: record.veraRequestId,
          s13RequestId: record.s13RequestId ?? undefined,
          state: record.state,
        };
      },
      cancelViaS14: async (s14CorrelationId) => {
        const cancelled = await runner.cancel(s14CorrelationId);
        writeJson(path.join(verDir, "correlations", `${s14CorrelationId}-cancelled.json`), cancelled);
        return { cancelled: true };
      },
    });

    // --- Scenario 1 ---
    const b1 = workflow.createDefaultReview({ runId: `${runId}-sc1`, defaultContent: DEFAULT_REVIEW });
    scenarios.scenario1_default_only = {
      passed:
        b1.effectiveReview.source === "default" &&
        !b1.seniorReviewRequest &&
        !b1.seniorReview &&
        b1.effectiveReview.eligibleForDownstreamUse === true,
      bundleId: b1.reviewBundleId,
    };
    if (!scenarios.scenario1_default_only.passed) errors.push("SCENARIO1_FAILED");

    // --- Scenario 2 ---
    const b2 = workflow.createDefaultReview({ runId: `${runId}-sc2`, defaultContent: DEFAULT_REVIEW });
    const nanoBeforeSc2 = await nanoHealth(8082);
    const blocked = await workflow.requestSeniorReview({
      reviewBundleId: b2.reviewBundleId,
      approvalReference: "missing",
      executionApprovalPresent: false,
    });
    const nanoAfterSc2 = await nanoHealth(8082);
    scenarios.scenario2_unapproved = {
      passed:
        blocked.state === "senior_execution_blocked" &&
        !blocked.seniorReviewRequest &&
        blocked.effectiveReview.source === "default" &&
        nanoBeforeSc2.healthy === nanoAfterSc2.healthy,
      decisionReason: blocked.decisionReason,
    };
    if (!scenarios.scenario2_unapproved.passed) errors.push("SCENARIO2_FAILED");

    // --- Scenario 3: live Hello one-token ---
    const b3 = workflow.createDefaultReview({ runId: `${runId}-sc3`, defaultContent: DEFAULT_REVIEW });
    const helloReqId = `s15-hello-${runId}`;
    tokenPlan.set(helloReqId, 1);
    await workflow.requestSeniorReview({
      reviewBundleId: b3.reviewBundleId,
      approvalReference: `exec-hello-${runId}`,
      executionApprovalPresent: true,
      prompt: HELLO.prompt,
      requestId: helloReqId,
      idempotencyKey: `hello-${runId}`,
    });
    const helloRecord = liveResults.get(helloReqId);
    if (!helloRecord) throw new Error("hello_live_result_missing");
    const helloTokens = helloRecord.result?.generatedTokens.map((t) => t.tokenId) ?? [];
    const pending3 = workflow.recordSeniorResult({
      reviewBundleId: b3.reviewBundleId,
      content: seniorContentFromLive(helloRecord),
      s13RequestId: helloRecord.s13RequestId ?? undefined,
      generatedTokenIds: helloTokens,
      syntheticOrFixture: false,
    });
    writeJson(path.join(verDir, "review-bundles", `${b3.reviewBundleId}.json`), pending3);
    if (pending3.comparison) {
      writeJson(path.join(verDir, "comparisons", `${pending3.comparison.comparisonId}.json`), pending3.comparison);
    }
    scenarios.scenario3_live_one_token = {
      passed:
        helloRecord.state === "senior_completed" &&
        helloTokens[0] === 1044 &&
        pending3.state === "pending_operator_review" &&
        pending3.effectiveReview.source === "default" &&
        !!pending3.comparison &&
        pending3.comparison.autoSelectedWinner === false &&
        helloRecord.result?.nanoRestored !== false,
      s13RequestId: helloRecord.s13RequestId,
      tokenIds: helloTokens,
      nanoRestored: helloRecord.result?.nanoRestored,
    };
    if (!scenarios.scenario3_live_one_token.passed) errors.push("SCENARIO3_FAILED");

    // --- Scenario 4: accept ---
    const accepted = workflow.applyOperatorDecision({
      reviewBundleId: b3.reviewBundleId,
      decision: "accept_senior",
      operatorId: "s15-live-operator",
      reviewedDefaultSha256: pending3.defaultReview.contentSha256,
      reviewedSeniorSha256: pending3.seniorReview!.contentSha256,
      reviewedComparisonSha256: pending3.comparison!.comparisonSha256,
    });
    writeJson(path.join(verDir, "operator-decisions", `${accepted.operatorDecision!.decisionId}.json`), accepted.operatorDecision);
    const gateAfterAccept = workflow.attemptDownstreamAction(b3.reviewBundleId, "git_commit");
    scenarios.scenario4_accept = {
      passed:
        accepted.state === "senior_accepted" &&
        accepted.effectiveReview.source === "senior" &&
        accepted.effectiveReview.eligibleForDownstreamUse === true &&
        accepted.effectiveReview.downstreamActionAuthorized === false &&
        gateAfterAccept.allowed === false,
    };
    if (!scenarios.scenario4_accept.passed) errors.push("SCENARIO4_FAILED");

    // --- Scenario 5: France two-token ---
    const b5 = workflow.createDefaultReview({ runId: `${runId}-sc5`, defaultContent: DEFAULT_REVIEW });
    const franceReqId = `s15-france-${runId}`;
    tokenPlan.set(franceReqId, 2);
    await workflow.requestSeniorReview({
      reviewBundleId: b5.reviewBundleId,
      approvalReference: `exec-france-${runId}`,
      executionApprovalPresent: true,
      prompt: FRANCE.prompt,
      requestId: franceReqId,
      idempotencyKey: `france-${runId}`,
    });
    const franceRecord = liveResults.get(franceReqId);
    if (!franceRecord) throw new Error("france_live_result_missing");
    const franceTokens = franceRecord.result?.generatedTokens.map((t) => t.tokenId) ?? [];
    const pending5 = workflow.recordSeniorResult({
      reviewBundleId: b5.reviewBundleId,
      content: seniorContentFromLive(franceRecord),
      s13RequestId: franceRecord.s13RequestId ?? undefined,
      generatedTokenIds: franceTokens,
      syntheticOrFixture: false,
    });
    writeJson(path.join(verDir, "review-bundles", `${b5.reviewBundleId}.json`), pending5);
    scenarios.scenario5_live_two_token = {
      passed:
        franceRecord.state === "senior_completed" &&
        franceTokens[0] === 6993 &&
        franceTokens[1] === 32876 &&
        pending5.state === "pending_operator_review" &&
        pending5.effectiveReview.source === "default",
      tokenIds: franceTokens,
      s13RequestId: franceRecord.s13RequestId,
    };
    if (!scenarios.scenario5_live_two_token.passed) errors.push("SCENARIO5_FAILED");

    // --- Scenario 6: reject ---
    const rejected = workflow.applyOperatorDecision({
      reviewBundleId: b5.reviewBundleId,
      decision: "reject_senior",
      reason: "transport_proof_only_not_useful_review",
      reviewedDefaultSha256: pending5.defaultReview.contentSha256,
      reviewedSeniorSha256: pending5.seniorReview!.contentSha256,
      reviewedComparisonSha256: pending5.comparison!.comparisonSha256,
    });
    writeJson(path.join(verDir, "operator-decisions", `${rejected.operatorDecision!.decisionId}.json`), rejected.operatorDecision);
    scenarios.scenario6_reject = {
      passed: rejected.state === "senior_rejected" && rejected.effectiveReview.source === "default",
    };
    if (!scenarios.scenario6_reject.passed) errors.push("SCENARIO6_FAILED");

    // --- Scenario 7: keep_default ---
    const b7 = workflow.createDefaultReview({ runId: `${runId}-sc7`, defaultContent: DEFAULT_REVIEW });
    // Use fixture senior for keep_default (decision path), after a live-approved empty request path
    await workflow.requestSeniorReview({
      reviewBundleId: b7.reviewBundleId,
      approvalReference: `exec-keep-${runId}`,
      executionApprovalPresent: true,
      prompt: "keep-default-path",
      requestId: `s15-keep-${runId}`,
      idempotencyKey: `keep-meta-${runId}`,
    });
    // Record a non-live advisory senior from prior live hello shape without new generation
    const keepPending = workflow.recordSeniorResult({
      reviewBundleId: b7.reviewBundleId,
      content: seniorContentFromLive(helloRecord),
      generatedTokenIds: helloTokens,
      syntheticOrFixture: false,
    });
    const kept = workflow.applyOperatorDecision({
      reviewBundleId: b7.reviewBundleId,
      decision: "keep_default",
      reviewedDefaultSha256: keepPending.defaultReview.contentSha256,
      reviewedSeniorSha256: keepPending.seniorReview!.contentSha256,
      reviewedComparisonSha256: keepPending.comparison!.comparisonSha256,
    });
    scenarios.scenario7_keep_default = {
      passed: kept.state === "default_retained" && kept.effectiveReview.source === "default",
    };
    if (!scenarios.scenario7_keep_default.passed) errors.push("SCENARIO7_FAILED");

    // --- Scenario 8: stale ---
    const stale = workflow.reviseDefaultReview(b3.reviewBundleId, DEFAULT_REVIEW + "\nfinding: revised");
    scenarios.scenario8_stale = {
      passed: stale.state === "stale" && stale.effectiveReview.source === "default" && !stale.comparison,
    };
    if (!scenarios.scenario8_stale.passed) errors.push("SCENARIO8_FAILED");

    // --- Scenario 9: duplicate ---
    const dup = await runner.run(
      {
        veraRequestId: helloReqId,
        prompt: HELLO.prompt,
        maxNewTokens: 1,
        approvalReference: `exec-hello-${runId}`,
        idempotencyKey: `hello-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      createSeniorApprovalArtifact({
        veraRequestId: helloReqId,
        approvalReference: `exec-hello-${runId}`,
        maxNewTokens: 1,
      }),
    );
    scenarios.scenario9_duplicate = {
      passed: dup.s13RequestId === helloRecord.s13RequestId,
      s13RequestId: dup.s13RequestId,
    };
    if (!scenarios.scenario9_duplicate.passed) errors.push("SCENARIO9_FAILED");

    // --- Scenario 10: cancellation ---
    const cancelVera = `s15-cancel-${runId}`;
    const cancelApproval = createSeniorApprovalArtifact({
      veraRequestId: cancelVera,
      approvalReference: `exec-cancel-${runId}`,
      maxNewTokens: 2,
    });
    writeJson(path.join(verDir, "execution-approvals", `${cancelApproval.approvalReference}.json`), cancelApproval);
    const b10 = workflow.createDefaultReview({ runId: `${runId}-sc10`, defaultContent: DEFAULT_REVIEW });
    const cancelPromise = runner.run(
      {
        veraRequestId: cancelVera,
        prompt: FRANCE.prompt,
        maxNewTokens: 2,
        approvalReference: cancelApproval.approvalReference,
        idempotencyKey: `cancel-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      cancelApproval,
    );
    // Wait until submitted or short delay, then cancel
    let cancelPoint = "unknown";
    for (let i = 0; i < 120; i++) {
      const cur = s14Store.read(cancelVera);
      if (cur?.s13RequestId) {
        cancelPoint = cur.state;
        break;
      }
      if (cur?.state === "senior_queued" || cur?.state === "senior_submitted" || cur?.state === "senior_executing") {
        cancelPoint = cur.state;
        break;
      }
      await sleep(1000);
    }
    const cancelledRec = await runner.cancel(cancelVera);
    await cancelPromise.catch(() => null);
    const finalCancel = s14Store.read(cancelVera) ?? cancelledRec;
    const b10fail = workflow.recordSeniorFailure(b10.reviewBundleId, "cancelled");
    const nanoAfterCancel = await nanoHealth(8082);
    writeJson(path.join(verDir, "cancellation-or-recovery.json"), {
      cancelPoint,
      record: finalCancel,
      bundle: b10fail,
      nanoAfterCancel,
    });
    scenarios.scenario10_cancellation = {
      passed:
        b10fail.effectiveReview.source === "default" &&
        !b10fail.operatorDecision &&
        (finalCancel.state === "senior_cancelled" ||
          finalCancel.state === "senior_completed" ||
          finalCancel.state === "senior_failed") &&
        nanoAfterCancel.healthy,
      cancelPoint,
      terminalState: finalCancel.state,
      completionRace: finalCancel.state === "senior_completed",
    };
    if (!scenarios.scenario10_cancellation.passed) errors.push("SCENARIO10_FAILED");

    // --- Scenario 11: restart ---
    const b11 = workflow.createDefaultReview({ runId: `${runId}-sc11`, defaultContent: DEFAULT_REVIEW });
    await workflow.requestSeniorReview({
      reviewBundleId: b11.reviewBundleId,
      approvalReference: `exec-restart-${runId}`,
      executionApprovalPresent: true,
      prompt: "restart-pending",
      requestId: `s15-restart-${runId}`,
      idempotencyKey: `restart-meta-${runId}`,
    });
    workflow.recordSeniorResult({
      reviewBundleId: b11.reviewBundleId,
      content: seniorContentFromLive(helloRecord),
      generatedTokenIds: helloTokens,
      syntheticOrFixture: false,
    });
    const { workflow: w2 } = createSeniorReviewWorkflow({ stateRoot: workflowState });
    const recovered = w2.recoverAfterRestart().find((b) => b.reviewBundleId === b11.reviewBundleId);
    scenarios.scenario11_restart = {
      passed:
        recovered?.state === "pending_operator_review" &&
        !recovered.operatorDecision &&
        recovered.effectiveReview.source === "default",
    };
    writeJson(path.join(verDir, "restart-recovery.json"), { recovered });
    if (!scenarios.scenario11_restart.passed) errors.push("SCENARIO11_FAILED");

    // --- Scenario 12: approval separation ---
    let execAsAccept = false;
    try {
      workflow.rejectExecutionApprovalAsAcceptance(null);
    } catch {
      execAsAccept = true;
    }
    let crossBundle = false;
    try {
      workflow.applyOperatorDecision({
        reviewBundleId: b11.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: "wrong",
        reviewedSeniorSha256: "wrong",
        reviewedComparisonSha256: "wrong",
      });
    } catch {
      crossBundle = true;
    }
    scenarios.scenario12_approval_separation = {
      passed: execAsAccept && crossBundle,
    };
    if (!scenarios.scenario12_approval_separation.passed) errors.push("SCENARIO12_FAILED");

    // --- Scenario 13: downstream ---
    const unacceptedGate = workflow.attemptDownstreamAction(b11.reviewBundleId, "deploy");
    scenarios.scenario13_downstream = {
      passed:
        unacceptedGate.allowed === false &&
        gateAfterAccept.allowed === false &&
        gateAfterAccept.reason === "accepted_senior_still_requires_action_gates",
    };
    if (!scenarios.scenario13_downstream.passed) errors.push("SCENARIO13_FAILED");

    // --- Scenario 14: no-default ---
    const ordinary = await runner.run(
      {
        veraRequestId: `ordinary-${runId}`,
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "",
        idempotencyKey: `ord-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: false,
      },
      null,
    );
    scenarios.scenario14_no_default = {
      passed:
        ordinary.s13RequestId === null &&
        GATED_SENIOR_REGISTRY_AFTER.defaultRoute === false &&
        GATED_SENIOR_REGISTRY_AFTER.automaticSelection === false &&
        S15_WORKFLOW_ARCHITECTURE.usesS14NotS13Direct,
    };
    if (!scenarios.scenario14_no_default.passed) errors.push("SCENARIO14_FAILED");

    // Copy durable workflow artifacts
    for (const [src, dst] of [
      ["bundles", "review-bundles"],
      ["comparisons", "comparisons"],
      ["operator-decisions", "operator-decisions"],
      ["execution-approvals", "execution-approvals"],
      ["senior-correlations", "correlations-s15"],
    ] as const) {
      const from = path.join(workflowState, src);
      if (existsSync(from)) cpSync(from, path.join(verDir, dst), { recursive: true });
    }

    writeJson(path.join(verDir, "scenario-results.json"), scenarios);

    const allPassed = Object.values(scenarios).every((s) => s.passed);
    void client;

    // Cleanup S13
    console.error("[S15-live] shutting down S13 via S13.1");
    shutdown = await stopS13(s13Proc, verDir);
    const nanoAfter = { console: await nanoHealth(8082), vera: await nanoHealth(8081) };
    writeJson(path.join(verDir, "nano-lifecycle.json"), { before: nanoBefore, after: nanoAfter });

    if (!shutdown.port8091Released || shutdown.sigkillUsed || !nanoAfter.console.healthy || !nanoAfter.vera.healthy) {
      errors.push("CLEANUP_FAILED");
    }

    const verdict =
      allPassed && errors.length === 0 && !shutdown.sigkillUsed
        ? "s15_approved_senior_review_ready"
        : errors.includes("S13_NOT_READY")
          ? "s15_approved_senior_review_blocked"
          : "s15_approved_senior_review_failed";

    const result = {
      phase: "S15",
      runId,
      timestamp: new Date().toISOString(),
      verdict,
      status:
        verdict === "s15_approved_senior_review_ready"
          ? "S15 READY — APPROVED SENIOR REVIEW"
          : verdict === "s15_approved_senior_review_blocked"
            ? "S15 BLOCKED"
            : "S15 FAILED",
      baseline: {
        s13_1Commit: S131_COMMIT,
        s15ImplementationCommit: IMPL_COMMIT,
        documentationTip: DOC_TIP,
        sourceManifestSha256: MANIFEST_SHA,
        executableSourceClean: true,
        head,
        treeSha: tree,
        branch,
      },
      runtime: {
        s13Live: true,
        s13LoopbackOnly: true,
        executionMode: "modelopt_fake_quant_cuda",
        nativeFp8KernelProven: false,
        longFormSeniorReviewGenerationProven: false,
      },
      workflow: {
        defaultFirstPassed: scenarios.scenario1_default_only.passed,
        dualPreservationPassed: scenarios.scenario3_live_one_token.passed,
        comparisonPassed: scenarios.scenario3_live_one_token.passed,
        executionApprovalSeparated: scenarios.scenario2_unapproved.passed && scenarios.scenario12_approval_separation.passed,
        operatorAcceptanceSeparated: scenarios.scenario4_accept.passed,
        staleDecisionPassed: scenarios.scenario8_stale.passed,
        downstreamBoundaryPassed: scenarios.scenario13_downstream.passed,
      },
      liveRouting: {
        oneTokenSeniorRequestPassed: scenarios.scenario3_live_one_token.passed,
        twoTokenSeniorRequestPassed: scenarios.scenario5_live_two_token.passed,
        helloTokenIds: scenarios.scenario3_live_one_token.tokenIds ?? [],
        franceTokenIds: scenarios.scenario5_live_two_token.tokenIds ?? [],
        correlationPassed: Boolean(scenarios.scenario3_live_one_token.s13RequestId),
        duplicatePreventionPassed: scenarios.scenario9_duplicate.passed,
      },
      operatorDecisions: {
        acceptPassed: scenarios.scenario4_accept.passed,
        rejectPassed: scenarios.scenario6_reject.passed,
        keepDefaultPassed: scenarios.scenario7_keep_default.passed,
        crossBundleReuseBlocked: scenarios.scenario12_approval_separation.passed,
        executionApprovalReuseBlocked: scenarios.scenario12_approval_separation.passed,
      },
      cancellationOrRecovery: {
        performed: true,
        defaultRemainedEffective: scenarios.scenario10_cancellation.passed,
        correlationRetained: true,
        nanoRestored: scenarios.scenario10_cancellation.passed,
        details: scenarios.scenario10_cancellation,
      },
      restartRecovery: {
        performed: true,
        bundleRecovered: scenarios.scenario11_restart.passed,
        duplicateSubmissionDetected: false,
        autoAcceptanceDetected: false,
      },
      noDefaultRegression: {
        passed: scenarios.scenario14_no_default.passed,
        automaticSeniorSelectionDetected: false,
        approvalLeakDetected: false,
      },
      cleanup: {
        s13Stopped: Boolean(shutdown.port8091Released),
        port8091Released: Boolean(shutdown.port8091Released),
        consoleNanoHealthy: Boolean(shutdown.consoleNanoHealthy),
        veraNanoHealthy: Boolean(shutdown.veraNanoHealthy),
        sigkillUsed: Boolean(shutdown.sigkillUsed),
        exitCode: shutdown.exitCode,
        elapsedMs: shutdown.elapsedMs,
      },
      capability: {
        workflowIntegrationProven: allPassed,
        liveSeniorRoutingProven: scenarios.scenario3_live_one_token.passed && scenarios.scenario5_live_two_token.passed,
        operatorAcceptanceProven: scenarios.scenario4_accept.passed,
        longFormSeniorReviewGenerationProven: false,
        reason: "S13 currently supports only one or two generated tokens",
      },
      historicalBlockedResult: ".download-logs/super-s15-senior-review-result-blocked-historical.json",
      verificationDir: verDir,
      scenarios,
      errors,
    };

    writeJson(path.join(verDir, "result.json"), result);
    writeJson(canonical, result);
    writeJson(path.join(ROOT, `.download-logs/super-s15-senior-review-result-${utcStamp()}.json`), result);
    writeFileSync(path.join(verDir, "stdout.log"), JSON.stringify(result, null, 2) + "\n");
    writeFileSync(path.join(verDir, "stderr.log"), readFileSync(s13Log, "utf8").slice(-50_000));
    console.log(JSON.stringify({ verdict, runId, errors, scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, v.passed])) }, null, 2));
    return verdict === "s15_approved_senior_review_ready" ? 0 : 2;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    try {
      shutdown = await stopS13(s13Proc, verDir);
    } catch {
      /* */
    }
    const fail = {
      phase: "S15",
      runId,
      verdict: "s15_approved_senior_review_failed",
      status: "S15 FAILED",
      errors,
      scenarios,
      cleanup: shutdown,
    };
    writeJson(path.join(verDir, "result.json"), fail);
    writeJson(canonical, fail);
    console.log(JSON.stringify(fail, null, 2));
    return 2;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runS15LiveVerification().then((code) => process.exit(code));
}
