#!/usr/bin/env npx tsx
/**
 * S15.1 bounded long-form live verification (S15 → S14 → S13).
 * Requires:
 *   --allow-s15-1-runtime-verification --confirm-s15-1-runtime-verification
 * Nano interruption (S13):
 *   --allow-request-time-nano-interruption --confirm-request-time-nano-interruption
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import {
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
} from "../../../src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter";
import {
  createSeniorReviewWorkflow,
  sha256Text,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s15-senior-review-workflow";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const S13_BASE = "http://127.0.0.1:8091";
const HELLO = { prompt: "Hello", tokens: [1044] };
const FRANCE = { prompt: "The capital of France is", tokens: [6993, 32876] };
const EIGHT_PROMPT = "Continue this sentence with clear words:";
const DEFAULT_REVIEW = [
  "finding: missing null check in parser",
  "recommend: add unit test",
  "severity: medium",
].join("\n");

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

async function httpJson(url: string, init?: RequestInit, timeoutMs = 60_000): Promise<any> {
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
  baseline.note = "s15_1_live_verification_head";
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

async function pollGeneration(requestId: string, timeoutMs: number): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await httpJson(`${S13_BASE}/v1/generations/${encodeURIComponent(requestId)}`, undefined, 30_000);
    const state = st.state || st.result?.state;
    if (["completed", "cancelled", "failed", "recovery_required"].includes(String(state))) {
      return st;
    }
    await sleep(5000);
  }
  throw new Error(`poll_timeout:${requestId}`);
}

async function runDirectGeneration(prompt: string, maxNewTokens: number, requestKey: string): Promise<any> {
  const submitted = await httpJson(
    `${S13_BASE}/v1/generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        maxNewTokens,
        generationPolicy: "greedy",
        requestKey,
        stopOnEos: true,
      }),
    },
    60_000,
  );
  const final = await pollGeneration(submitted.requestId, maxNewTokens * 45 * 60_000);
  return { submitted, final };
}

async function main(): Promise<void> {
  const authorized = argsHave(
    "--allow-s15-1-runtime-verification",
    "--confirm-s15-1-runtime-verification",
  );
  const nanoAuth = argsHave(
    "--allow-request-time-nano-interruption",
    "--confirm-request-time-nano-interruption",
  );
  const runId = `s15-1-live-${utcStamp()}`;
  const artRoot = path.join(ROOT, ".download-logs/s15-1-long-form-generation", runId);
  mkdirSync(artRoot, { recursive: true });
  const log = (msg: string) => {
    const line = `[S15.1-live] ${msg}`;
    console.error(line);
    writeFileSync(path.join(artRoot, "stdout.log"), line + "\n", { flag: "a" });
  };

  writeJson(path.join(artRoot, "authorization.json"), {
    runtimeAuthorized: authorized,
    nanoAuthorized: nanoAuth,
    argv: process.argv.slice(2),
  });

  if (!authorized) {
    const result = {
      verdict: "s15_1_runtime_verification_not_authorized",
      status: "S15.1 BLOCKED — RUNTIME VERIFICATION NOT AUTHORIZED",
    };
    writeJson(path.join(artRoot, "result.json"), result);
    writeJson(path.join(ROOT, ".download-logs/super-s15-1-long-form-generation-result.json"), result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(2);
  }
  if (!nanoAuth) {
    throw new Error("nano_interruption_flags_required");
  }

  assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);
  updateS13BaselineToHead();
  writeJson(path.join(artRoot, "baseline.json"), JSON.parse(readFileSync(path.join(ROOT, ".download-logs/s13-baseline-commit.json"), "utf8")));

  let s13Proc: ChildProcess | null = null;
  const startedHere = !portListening(8091);
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
        env: { ...process.env, S13_LOCAL_SERVICE_FOREGROUND: "1", S13_TEE_LOG: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    s13Proc.stdout?.on("data", (d) => writeFileSync(path.join(artRoot, "s13-stdout.log"), d, { flag: "a" }));
    s13Proc.stderr?.on("data", (d) => writeFileSync(path.join(artRoot, "s13-stderr.log"), d, { flag: "a" }));
  }

  try {
    await waitForS13();
    writeJson(path.join(artRoot, "s13-health.json"), await httpJson(`${S13_BASE}/v1/health`));
    writeJson(path.join(artRoot, "s13-runtime.json"), await httpJson(`${S13_BASE}/v1/runtime`));

    const scenarios: Record<string, unknown> = {};

    // Scenario 1: one-token regression
    log("scenario1 one-token");
    const s1 = await runDirectGeneration(HELLO.prompt, 1, `${runId}-hello`);
    const s1Tokens = (s1.final.result?.generatedTokens || s1.final.generatedTokens || []).map((t: any) => t.tokenId);
    scenarios.scenario1 = {
      ok: JSON.stringify(s1Tokens) === JSON.stringify(HELLO.tokens),
      tokens: s1Tokens,
      expected: HELLO.tokens,
      requestId: s1.submitted.requestId,
      completionReason: s1.final.result?.completionReason,
    };
    writeJson(path.join(artRoot, "requests/scenario1.json"), s1);
    if (!(scenarios.scenario1 as any).ok) throw new Error("scenario1_regression_failed");

    // Scenario 2: two-token regression
    log("scenario2 two-token");
    const s2 = await runDirectGeneration(FRANCE.prompt, 2, `${runId}-france`);
    const s2Tokens = (s2.final.result?.generatedTokens || []).map((t: any) => t.tokenId);
    scenarios.scenario2 = {
      ok: JSON.stringify(s2Tokens) === JSON.stringify(FRANCE.tokens),
      tokens: s2Tokens,
      expected: FRANCE.tokens,
      requestId: s2.submitted.requestId,
    };
    writeJson(path.join(artRoot, "requests/scenario2.json"), s2);
    if (!(scenarios.scenario2 as any).ok) throw new Error("scenario2_regression_failed");

    // Scenario 3: eight-token bounded
    log("scenario3 eight-token");
    const s3 = await runDirectGeneration(EIGHT_PROMPT, 8, `${runId}-eight`);
    const s3Tokens = (s3.final.result?.generatedTokens || []).map((t: any) => t.tokenId);
    scenarios.scenario3 = {
      ok: s3.final.result?.state === "completed" && s3Tokens.length >= 1 && s3Tokens.length <= 8,
      tokens: s3Tokens,
      tokensCompleted: s3.final.result?.tokensCompleted,
      completionReason: s3.final.result?.completionReason,
      requestId: s3.submitted.requestId,
      nanoRestored: s3.final.result?.nanoRestored,
    };
    writeJson(path.join(artRoot, "requests/scenario3.json"), s3);
    if (!(scenarios.scenario3 as any).ok) throw new Error("scenario3_eight_token_failed");

    // Scenario 4: 32-token senior review via S15→S14→S13
    log("scenario4 32-token senior via S15");
    const health = await httpJson(`${S13_BASE}/v1/health`);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    const adapterRoot = path.join(artRoot, "s14-adapter");
    const { runner, store: s14Store } = createSeniorAdapter({
      stateRoot: adapterRoot,
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
    let liveCorr: any = null;
    const { workflow } = createSeniorReviewWorkflow({
      stateRoot: path.join(artRoot, "s15-bundles"),
      submitViaS14: async (input) => {
        const approval = createSeniorApprovalArtifact({
          veraRequestId: input.veraRequestId,
          approvalReference: input.approvalReference,
          maxNewTokens: input.maxNewTokens ?? 32,
        });
        writeJson(path.join(artRoot, "execution-approvals", `${input.approvalReference}.json`), approval);
        liveCorr = await runner.run(
          {
            veraRequestId: input.veraRequestId,
            prompt: input.prompt,
            maxNewTokens: input.maxNewTokens ?? 32,
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

    const seniorPrompt = [
      "Exact review scope: parser null-check and shutdown race.",
      "Default review:",
      DEFAULT_REVIEW,
      "Requested output structure: findings then recommendations.",
      "Maximum output length: 32 tokens.",
      "Do not execute actions. Distinguish findings from recommendations.",
    ].join("\n");
    const promptHash = sha256Text(seniorPrompt);
    const bundle = workflow.createDefaultReview({ runId, defaultContent: DEFAULT_REVIEW });
    const requested = await workflow.requestSeniorReview({
      reviewBundleId: bundle.reviewBundleId,
      approvalReference: `s15-1-apr-${runId}`,
      executionApprovalPresent: true,
      prompt: seniorPrompt,
      maxNewTokens: 32,
      idempotencyKey: `s15-1-senior-${runId}`,
    });
    const corr = liveCorr ?? s14Store.read(requested.seniorReviewRequest!.requestId);
    const tokenIds = (corr?.result?.generatedTokens || []).map((t: any) => t.tokenId);
    const decoded = (corr?.result?.generatedTokens || []).map((t: any) => t.decoded).join("");
    const complete = corr?.state === "senior_completed" && tokenIds.length >= 1;
    let acceptedBundle = null as any;
    if (complete) {
      const withSenior = workflow.recordSeniorResult({
        reviewBundleId: bundle.reviewBundleId,
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
      acceptedBundle = workflow.applyOperatorDecision({
        reviewBundleId: bundle.reviewBundleId,
        decision: "accept_senior",
        reviewedDefaultSha256: withSenior.defaultReview.contentSha256,
        reviewedSeniorSha256: withSenior.seniorReview!.contentSha256,
        reviewedComparisonSha256: withSenior.comparison!.comparisonSha256,
        operatorId: "s15-1-operator",
      });
    }
    scenarios.scenario4 = {
      ok: complete && acceptedBundle?.effectiveReview?.source === "senior",
      promptHash,
      s13RequestId: corr?.s13RequestId,
      tokenIds,
      decoded,
      tokensCompleted: tokenIds.length,
      state: corr?.state,
      operatorDecision: acceptedBundle?.operatorDecision?.decision,
      downstreamAuthorized: acceptedBundle?.effectiveReview?.downstreamActionAuthorized === false,
    };
    writeJson(path.join(artRoot, "review-bundles/scenario4.json"), { corr, acceptedBundle, promptHash });
    if (!(scenarios.scenario4 as any).ok) throw new Error("scenario4_32_token_failed");

    // Scenario 5: cancel after several tokens
    log("scenario5 cancellation");
    const cancelSubmit = await httpJson(
      `${S13_BASE}/v1/generations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: EIGHT_PROMPT,
          maxNewTokens: 32,
          generationPolicy: "greedy",
          requestKey: `${runId}-cancel`,
        }),
      },
      60_000,
    );
    // Wait until at least 2 tokens if possible, else cancel early
    let tokensSeen = 0;
    for (let i = 0; i < 120; i++) {
      const st = await httpJson(`${S13_BASE}/v1/generations/${cancelSubmit.requestId}`);
      tokensSeen = Number(st.tokensCompleted || st.result?.tokensCompleted || 0);
      if (tokensSeen >= 2) break;
      await sleep(15_000);
    }
    await httpJson(`${S13_BASE}/v1/generations/${cancelSubmit.requestId}/cancel`, { method: "POST", body: "{}" });
    const cancelFinal = await pollGeneration(cancelSubmit.requestId, 60 * 60_000);
    scenarios.scenario5 = {
      ok:
        cancelFinal.result?.state === "cancelled" &&
        cancelFinal.result?.s15AcceptanceEligible === false &&
        cancelFinal.result?.nanoRestored === true,
      tokensCompleted: cancelFinal.result?.tokensCompleted,
      partialOutput: cancelFinal.result?.partialOutput,
      acceptanceEligible: cancelFinal.result?.s15AcceptanceEligible,
    };
    writeJson(path.join(artRoot, "cancellation-result.json"), cancelFinal);
    if (!(scenarios.scenario5 as any).ok) throw new Error("scenario5_cancel_failed");

    // Scenario 7: repeated bounded requests (two sequential 1-token)
    log("scenario7 repeated");
    const r1 = await runDirectGeneration(HELLO.prompt, 1, `${runId}-rep1`);
    const r2 = await runDirectGeneration(HELLO.prompt, 1, `${runId}-rep2`);
    scenarios.scenario7 = {
      ok:
        r1.final.result?.state === "completed" &&
        r2.final.result?.state === "completed" &&
        r1.submitted.requestId !== r2.submitted.requestId,
      requestIds: [r1.submitted.requestId, r2.submitted.requestId],
    };

    const consoleNano = await nanoHealth(8082);
    const veraNano = await nanoHealth(8081);
    writeJson(path.join(artRoot, "nano-lifecycle.json"), { consoleNano, veraNano });

    // Bounded shutdown
    log("shutdown");
    const shutdownStart = Date.now();
    const shutdown = await httpJson(`${S13_BASE}/v1/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "cancel_active", reason: "s15_1_live_verify_complete" }),
    });
    let shutdownResult = shutdown;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      try {
        shutdownResult = await httpJson(`${S13_BASE}/v1/shutdown`);
        if (shutdownResult.result?.completed || !portListening(8091)) break;
      } catch {
        break;
      }
    }
    const shutdownElapsedMs = Date.now() - shutdownStart;
    writeJson(path.join(artRoot, "shutdown-result.json"), { shutdownResult, shutdownElapsedMs });

    const allOk = Object.values(scenarios).every((s: any) => s.ok);
    const result = {
      verdict: allOk ? "s15_1_bounded_long_form_ready" : "s15_1_bounded_long_form_failed",
      status: allOk
        ? "S15.1 READY — BOUNDED LONG-FORM GENERATION"
        : "S15.1 FAILED",
      runId,
      scenarios,
      nano: { consoleNano, veraNano },
      shutdownElapsedMs,
      executionClassification: {
        executionMode: "modelopt_fake_quant_cuda",
        nativeFp8KernelProven: false,
        generationStrategy: "full_prefix_recomputation",
        verifiedMaxNewTokens: allOk ? 32 : null,
        kvCacheClaimed: false,
      },
      artifactDir: artRoot,
    };
    writeJson(path.join(artRoot, "scenario-results.json"), scenarios);
    writeJson(path.join(artRoot, "result.json"), result);
    writeJson(path.join(ROOT, ".download-logs/super-s15-1-long-form-generation-result.json"), result);
    writeJson(
      path.join(ROOT, `.download-logs/super-s15-1-long-form-generation-result-${utcStamp()}.json`),
      result,
    );
    console.log(JSON.stringify(result, null, 2));
    process.exit(allOk ? 0 : 1);
  } finally {
    if (s13Proc && !s13Proc.killed) {
      try {
        s13Proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const result = {
    verdict: "s15_1_bounded_long_form_failed",
    status: "S15.1 FAILED",
    error: message,
  };
  try {
    writeJson(path.join(ROOT, ".download-logs/super-s15-1-long-form-generation-result.json"), result);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
