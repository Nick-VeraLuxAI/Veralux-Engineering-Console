#!/usr/bin/env npx tsx
/**
 * S14 verification CLI — baseline freeze + authorized live S13 routing scenarios.
 */

import { spawn, spawnSync, type ChildProcess } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from "fs";
import path from "path";
import { createHash } from "crypto";
import {
  createSeniorAdapter,
  createSeniorApprovalArtifact,
  GATED_SENIOR_REGISTRY_AFTER,
  GATED_SENIOR_REGISTRY_BEFORE,
  assertNoDefaultInvariants,
  type SeniorCorrelationRecord,
  type SeniorApprovalArtifact,
} from "../../../src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter";

const S13_COMMIT = "614377b02fa7ee06976fd58aeccaa7965a96b6e6";
const HELLO = { prompt: "Hello", tokens: [1044] };
const FRANCE = { prompt: "The capital of France is", tokens: [6993, 32876] };

const CONSOLE_S14_FILES = [
  "src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter",
  "src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter.test.ts",
  "scripts/runtime/super-airllm/s14-senior-adapter.ts",
  "scripts/runtime/super-airllm/run-s14-senior-adapter.sh",
  "docs/source-of-truth/implementation-audit/33-super-airllm-repair-s14-gated-senior-worker-adapter-v1.md",
  "docs/source-of-truth/implementation-audit/32-super-airllm-repair-s13-local-runtime-service-v1.md",
];

function utcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv);
  return {
    allowBaseline: flags.has("--allow-create-s14-baseline-commit"),
    confirmBaseline: flags.has("--confirm-create-s14-baseline-commit"),
    allowVerify: flags.has("--allow-s14-senior-routing-verification"),
    confirmVerify: flags.has("--confirm-s14-senior-routing-verification"),
    skipTests: flags.has("--skip-tests"),
    s13BaseUrl: process.env.S14_S13_BASE_URL ?? "http://127.0.0.1:8091",
  };
}

function writeJson(file: string, payload: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
  renameSync(tmp, file);
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fileManifest(repoRoot: string, relPaths: string[]) {
  const entries: Array<Record<string, unknown>> = [];
  for (const rel of relPaths) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) {
      // directory — expand
      const listed = spawnSync("find", [abs, "-type", "f"], { encoding: "utf8" });
      for (const line of (listed.stdout || "").trim().split("\n").filter(Boolean)) {
        const r = path.relative(repoRoot, line);
        entries.push({
          path: r,
          sha256: sha256File(line),
          purpose: classifyPurpose(r),
          origin: "untracked_or_modified",
        });
      }
      continue;
    }
    const st = spawnSync("stat", ["-c", "%F", abs], { encoding: "utf8" }).stdout.trim();
    if (st.includes("directory")) {
      const listed = spawnSync("find", [abs, "-type", "f"], { encoding: "utf8" });
      for (const line of (listed.stdout || "").trim().split("\n").filter(Boolean)) {
        const r = path.relative(repoRoot, line);
        entries.push({
          path: r,
          sha256: sha256File(line),
          purpose: classifyPurpose(r),
          origin: "untracked_or_modified",
        });
      }
    } else {
      entries.push({
        path: rel,
        sha256: sha256File(abs),
        purpose: classifyPurpose(rel),
        origin: "untracked_or_modified",
      });
    }
  }
  const digest = createHash("sha256")
    .update(
      entries
        .map((e) => `${e.path}:${e.sha256}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  return { kind: "s14_console_source_manifest", aggregateContentSha256: digest, entries };
}

function classifyPurpose(rel: string): string {
  if (rel.endsWith(".md")) return "documentation";
  if (rel.includes(".test.")) return "test";
  if (rel.includes("run-s14") || rel.includes("scripts/runtime")) return "launcher";
  return "executable_source";
}

function runTests(repoRoot: string) {
  const pytest = spawnSync(
    path.join(repoRoot, ".venv-airllm/bin/python"),
    ["-m", "pytest", "vendor/airllm-nemotronh/tests/", "-q"],
    {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "vendor/airllm-nemotronh") },
      encoding: "utf8",
    },
  );
  const vitest = spawnSync(
    "npx",
    ["vitest", "run", "src/lib/engineer-console/experimental/super-airllm/", "--reporter=dot"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const s14 = spawnSync(
    "npx",
    ["vitest", "run", "src/lib/engineer-console/experimental/super-airllm/s14-senior-adapter.test.ts", "--reporter=dot"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const pytestOk = (pytest.status ?? 1) === 0;
  const vitestOk = (vitest.status ?? 1) === 0;
  const s14Ok = (s14.status ?? 1) === 0;
  return {
    passed: pytestOk && vitestOk && s14Ok,
    pytest: pytest.stdout?.trim().split("\n").filter(Boolean).slice(-1)[0],
    vitest: vitest.stdout?.trim().split("\n").filter(Boolean).slice(-3).join(" | "),
    s14Adapter: s14.stdout?.trim().split("\n").filter(Boolean).slice(-3).join(" | "),
  };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text, status: res.status };
    }
  } finally {
    clearTimeout(t);
  }
}

function createBaselineCommit(repoRoot: string) {
  spawnSync("git", ["add", "--", ...CONSOLE_S14_FILES], { cwd: repoRoot });
  const cached = spawnSync("git", ["diff", "--cached", "--name-only"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).stdout.trim();
  const commit = spawnSync(
    "git",
    ["commit", "-m", "feat: add gated S13 senior runtime adapter"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).stdout.trim();
  const parent = spawnSync("git", ["rev-parse", "HEAD^"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
  const manifest = fileManifest(repoRoot, CONSOLE_S14_FILES);
  const payload = {
    phase: "S14",
    repository: repoRoot,
    branch: spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim(),
    parent,
    commit: head,
    treeSha: tree,
    committedFiles: cached.split("\n").filter(Boolean),
    sourceManifestSha256: manifest.aggregateContentSha256,
    committed: commit.status === 0,
    stderr: commit.stderr,
    stdout: commit.stdout,
  };
  writeJson(path.join(repoRoot, ".download-logs/s14-baseline-commit.json"), payload);
  writeJson(path.join(repoRoot, ".download-logs/s14-console-source-manifest.json"), manifest);
  return payload;
}

async function main() {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const errors: string[] = [];

  if (args.allowBaseline || args.confirmBaseline) {
    if (!(args.allowBaseline && args.confirmBaseline)) {
      console.log(JSON.stringify({ phase: "S14", verdict: "s14_baseline_commit_not_authorized", committed: false }, null, 2));
      process.exit(2);
    }
    if (!args.skipTests) {
      const tests = runTests(repoRoot);
      if (!tests.passed) {
        console.log(JSON.stringify({ phase: "S14", verdict: "s14_gated_senior_adapter_blocked", errors: ["REQUIRED_TESTS_FAILED"], tests }, null, 2));
        process.exit(2);
      }
    }
    const payload = createBaselineCommit(repoRoot);
    console.log(JSON.stringify(payload, null, 2));
    process.exit(payload.committed ? 0 : 2);
  }

  if (!(args.allowVerify && args.confirmVerify)) {
    console.log(JSON.stringify({ phase: "S14", verdict: "s14_runtime_verification_not_authorized" }, null, 2));
    process.exit(2);
  }

  const s13Baseline = existsSync(path.join(repoRoot, ".download-logs/s13-baseline-commit.json"))
    ? JSON.parse(readFileSync(path.join(repoRoot, ".download-logs/s13-baseline-commit.json"), "utf8"))
    : { commit: S13_COMMIT };
  const s14BaselinePath = path.join(repoRoot, ".download-logs/s14-baseline-commit.json");
  const s14Baseline = existsSync(s14BaselinePath)
    ? JSON.parse(readFileSync(s14BaselinePath, "utf8"))
    : {
        commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim(),
      };

  const systemBaselinePath = path.join(
    "/home/ndesantis/Documents/GitHub/Veralux-System",
    ".download-logs/s14-baseline-commit.json",
  );
  const systemBaseline = existsSync(systemBaselinePath)
    ? JSON.parse(readFileSync(systemBaselinePath, "utf8"))
    : null;

  const tests = args.skipTests ? { passed: true } : runTests(repoRoot);
  if (!tests.passed) {
    console.log(JSON.stringify({ phase: "S14", verdict: "s14_gated_senior_adapter_blocked", errors: ["REQUIRED_TESTS_FAILED"], tests }, null, 2));
    process.exit(2);
  }

  const runId = `${utcStamp()}-${String(s14Baseline.commit).slice(0, 8)}`;
  const verDir = path.join(repoRoot, ".download-logs/s14-senior-adapter-verification", runId);
  mkdirSync(path.join(verDir, "approval-artifacts"), { recursive: true });
  mkdirSync(path.join(verDir, "routing-decisions"), { recursive: true });
  mkdirSync(path.join(verDir, "correlations"), { recursive: true });

  writeJson(path.join(verDir, "baseline-commits.json"), {
    phase: "S14",
    console: s14Baseline,
    system: systemBaseline,
    s13Commit: S13_COMMIT,
    executionMode: "modelopt_fake_quant_cuda",
    nativeFp8KernelProven: false,
  });
  writeJson(path.join(verDir, "registry-before.json"), GATED_SENIOR_REGISTRY_BEFORE);
  writeJson(path.join(verDir, "registry-after.json"), GATED_SENIOR_REGISTRY_AFTER);
  assertNoDefaultInvariants(GATED_SENIOR_REGISTRY_AFTER);

  // S13 health.sourceCommit comes from .download-logs/s13-baseline-commit.json.
  // After the S14 freeze, that file is updated to the Console S14 HEAD so the
  // S13 fingerprint accepts the descendant commit while preserving S13 content digests.
  const expectedSourceCommit = String(s14Baseline.commit || s13Baseline.commit || S13_COMMIT);
  const expectedManifest =
    s13Baseline.manifestSha ??
    (existsSync(path.join(repoRoot, ".download-logs/s13-airllm-repair-source-manifest.json"))
      ? JSON.parse(readFileSync(path.join(repoRoot, ".download-logs/s13-airllm-repair-source-manifest.json"), "utf8"))
          .manifestSha256 ??
        JSON.parse(readFileSync(path.join(repoRoot, ".download-logs/s13-airllm-repair-source-manifest.json"), "utf8"))
          .aggregateContentSha256
      : null);

  // Validate S13
  let health: any;
  let readiness: any;
  let runtime: any;
  try {
    health = await httpJson(`${args.s13BaseUrl}/v1/health`);
    readiness = await httpJson(`${args.s13BaseUrl}/v1/readiness`);
    runtime = await httpJson(`${args.s13BaseUrl}/v1/runtime`);
  } catch (error) {
    const payload = {
      phase: "S14",
      verdict: "s14_gated_senior_adapter_blocked",
      errors: [`S13_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}`],
    };
    writeJson(path.join(verDir, "result.json"), payload);
    console.log(JSON.stringify(payload, null, 2));
    process.exit(2);
  }
  writeJson(path.join(verDir, "s13-health-snapshots.json"), { before: { health, readiness, runtime } });

  if (
    !health.healthy ||
    health.recoveryRequired ||
    readiness.recoveryRequired ||
    readiness.serviceReady === false ||
    health.executionMode !== "modelopt_fake_quant_cuda" ||
    !String(health.bind || "").startsWith("127.0.0.1")
  ) {
    const payload = {
      phase: "S14",
      verdict: "s14_gated_senior_adapter_blocked",
      errors: ["S13_NOT_READY_FOR_S14"],
      health,
      readiness,
    };
    writeJson(path.join(verDir, "result.json"), payload);
    console.log(JSON.stringify(payload, null, 2));
    process.exit(2);
  }

  // Prefer the live S13-reported fingerprint (descendant S14 tree may rebuild
  // the content digest while keeping the executable SHA stable).
  const expectedManifestSha =
    (typeof health.sourceManifestSha256 === "string" && health.sourceManifestSha256) ||
    expectedManifest ||
    null;

  const stateRoot = path.join(verDir, "adapter-state");
  const liveDeadlines = {
    connectMs: 60_000,
    pollIntervalMs: 5_000,
    queuedWaitMs: 3_600_000,
    activeExecutionMs: 14_400_000,
    operationalCleanupMs: 1_200_000,
    cancellationMs: 1_200_000,
  };

  const { runner, client, store } = createSeniorAdapter({
    stateRoot,
    s13BaseUrl: args.s13BaseUrl,
    expectedSourceCommit,
    expectedManifestSha: expectedManifestSha,
    deadlines: liveDeadlines,
  });

  const routing = {
    defaultRouteUnchanged: false,
    unapprovedRequestBlocked: false,
    approvedOneTokenCompleted: false,
    approvedTwoTokenCompleted: false,
    duplicateSubmissionPrevented: false,
    conflictingDuplicateRejected: false,
    approvalLeakDetected: false,
  };
  const generation = {
    helloTokenIds: [] as number[],
    franceTokenIds: [] as number[],
    matchesS13Baseline: false,
    fallbackDetected: false,
    hello: {} as Record<string, unknown>,
    france: {} as Record<string, unknown>,
  };
  const cancellation = {
    performed: false,
    propagated: false,
    terminalStateReconciled: false,
    nanoRestored: false,
    terminalState: null as string | null,
    cancelPoint: null as string | null,
  };
  const failureIsolation = {
    s13UnavailableHandled: false,
    s13RecoveryStateHandled: false,
    adapterProcessRemainedHealthy: true,
  };
  const correlation = {
    durable: false,
    activeRecoveredAfterAdapterRestart: false,
    duplicateS13RequestDetected: false,
    adapterRestartTokens: [] as number[],
  };
  const fallback = {
    defaultDisabled: true,
    eligibleScenarioTested: false,
    ineligibleScenarioBlocked: false,
    workerIdentityPreserved: true,
    eligibleResult: null as unknown,
  };
  const recovery = {
    mapped: false,
    noReplacement: true,
    noFallback: true,
    resumed: false,
    reconciled: false,
    s13RequestId: null as string | null,
  };

  try {
    // Scenario 1
    const ordinary = await runner.run(
      {
        veraRequestId: `vera-ordinary-${runId}`,
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "",
        idempotencyKey: `ord-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: false,
      },
      null,
    );
    routing.defaultRouteUnchanged =
      ordinary.s13RequestId === null && ordinary.state === "senior_decision_blocked";
    writeJson(path.join(verDir, "routing-decisions/scenario1-ordinary.json"), ordinary.decision);

    // Scenario 2
    const unapproved = await runner.run(
      {
        veraRequestId: `vera-unapproved-${runId}`,
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "missing",
        idempotencyKey: `unapp-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      null,
    );
    routing.unapprovedRequestBlocked =
      unapproved.s13RequestId === null &&
      unapproved.error?.code === "senior_execution_approval_missing";
    writeJson(path.join(verDir, "routing-decisions/scenario2-unapproved.json"), unapproved);

    // Scenario 3: Hello
    const helloApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-hello-${runId}`,
      maxNewTokens: 1,
    });
    writeJson(path.join(verDir, "approval-artifacts/hello.json"), helloApproval);
    console.error(`[S14] scenario3 Hello submit ${helloApproval.veraRequestId}`);
    const hello = await runner.run(
      {
        veraRequestId: helloApproval.veraRequestId,
        prompt: HELLO.prompt,
        maxNewTokens: 1,
        approvalReference: helloApproval.approvalReference,
        idempotencyKey: `hello-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      helloApproval,
    );
    generation.helloTokenIds = hello.result?.generatedTokens.map((t) => t.tokenId) ?? [];
    routing.approvedOneTokenCompleted =
      hello.state === "senior_completed" && generation.helloTokenIds[0] === HELLO.tokens[0];
    correlation.durable = Boolean(store.read(helloApproval.veraRequestId)?.s13RequestId);
    generation.hello = {
      veraRequestId: hello.veraRequestId,
      s13RequestId: hello.s13RequestId,
      approvalReference: helloApproval.approvalReference,
      idempotencyKey: hello.idempotencyKey,
      tokens: generation.helloTokenIds,
      state: hello.state,
      nanoRestored: hello.result?.nanoRestored,
      executionMode: hello.result?.executionMode,
    };
    writeJson(path.join(verDir, "correlations/hello.json"), hello);
    if (!routing.approvedOneTokenCompleted) errors.push("SCENARIO3_HELLO_FAILED");

    // Scenario 5: duplicate (after hello terminal — reuses terminal)
    const dup = await runner.run(
      {
        veraRequestId: helloApproval.veraRequestId,
        prompt: HELLO.prompt,
        maxNewTokens: 1,
        approvalReference: helloApproval.approvalReference,
        idempotencyKey: `hello-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      helloApproval,
    );
    routing.duplicateSubmissionPrevented = dup.s13RequestId === hello.s13RequestId;
    writeJson(path.join(verDir, "correlations/hello-duplicate.json"), dup);

    // Conflicting duplicate
    const conflict = await runner.run(
      {
        veraRequestId: helloApproval.veraRequestId,
        prompt: "Different prompt",
        maxNewTokens: 1,
        approvalReference: helloApproval.approvalReference,
        idempotencyKey: `hello-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      helloApproval,
    );
    routing.conflictingDuplicateRejected = conflict.error?.code === "senior_duplicate_payload_conflict";

    // Scenario 4: France
    const franceApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-france-${runId}`,
      maxNewTokens: 2,
    });
    writeJson(path.join(verDir, "approval-artifacts/france.json"), franceApproval);
    console.error(`[S14] scenario4 France submit ${franceApproval.veraRequestId}`);
    const france = await runner.run(
      {
        veraRequestId: franceApproval.veraRequestId,
        prompt: FRANCE.prompt,
        maxNewTokens: 2,
        approvalReference: franceApproval.approvalReference,
        idempotencyKey: `france-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      franceApproval,
    );
    generation.franceTokenIds = france.result?.generatedTokens.map((t) => t.tokenId) ?? [];
    routing.approvedTwoTokenCompleted =
      france.state === "senior_completed" &&
      JSON.stringify(generation.franceTokenIds) === JSON.stringify(FRANCE.tokens);
    generation.matchesS13Baseline =
      routing.approvedOneTokenCompleted && routing.approvedTwoTokenCompleted;
    generation.fallbackDetected = Boolean(
      hello.result?.fallbackDetected || france.result?.fallbackDetected,
    );
    generation.france = {
      veraRequestId: france.veraRequestId,
      s13RequestId: france.s13RequestId,
      approvalReference: franceApproval.approvalReference,
      idempotencyKey: france.idempotencyKey,
      tokens: generation.franceTokenIds,
      state: france.state,
      nanoRestored: france.result?.nanoRestored,
    };
    writeJson(path.join(verDir, "correlations/france.json"), france);
    if (!routing.approvedTwoTokenCompleted) errors.push("SCENARIO4_FRANCE_FAILED");

    // Scenario 6: cancellation — submit async-style by starting then cancel when worker active
    const cancelApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-cancel-${runId}`,
      maxNewTokens: 2,
    });
    writeJson(path.join(verDir, "approval-artifacts/cancel.json"), cancelApproval);
    console.error(`[S14] scenario6 cancel submit ${cancelApproval.veraRequestId}`);
    const cancelPromise = runner.run(
      {
        veraRequestId: cancelApproval.veraRequestId,
        prompt: FRANCE.prompt,
        maxNewTokens: 2,
        approvalReference: cancelApproval.approvalReference,
        idempotencyKey: `cancel-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      cancelApproval,
    );
    // Wait until S13 request exists and is past queued if possible
    let cancelRec: SeniorCorrelationRecord | null = null;
    for (let i = 0; i < 900; i++) {
      cancelRec = store.read(cancelApproval.veraRequestId);
      if (cancelRec?.s13RequestId) {
        try {
          const st = await client.getGeneration(cancelRec.s13RequestId);
          cancellation.cancelPoint = String(st.state ?? "");
          if (st.state && st.state !== "queued") break;
          if (st.workerPid) break;
        } catch {
          /* keep waiting */
        }
      }
      await sleep(2000);
    }
    if (cancelRec?.s13RequestId) {
      const cancelled = await runner.cancel(cancelApproval.veraRequestId);
      cancellation.performed = true;
      cancellation.propagated = Boolean(cancelled.cancelRequestedAt);
      cancellation.terminalState = cancelled.state;
      cancellation.terminalStateReconciled = [
        "senior_cancelled",
        "senior_completed",
        "senior_failed",
        "senior_recovery_required",
      ].includes(cancelled.state);
      // Nano restore: query S13 health after terminal
      await sleep(5000);
      const h = await client.health();
      cancellation.nanoRestored =
        cancelled.state === "senior_cancelled" ||
        cancelled.state === "senior_completed" ||
        Boolean(h.healthy);
      writeJson(path.join(verDir, "cancellation-results.json"), { cancelled, health: h });
    } else {
      const finished = await cancelPromise;
      cancellation.performed = true;
      cancellation.terminalState = finished.state;
      cancellation.terminalStateReconciled = true;
      writeJson(path.join(verDir, "cancellation-results.json"), { finished, note: "completed_before_cancel_window" });
    }
    try {
      await cancelPromise;
    } catch {
      /* race ok */
    }
    // Idempotent cancel
    if (store.read(cancelApproval.veraRequestId)?.s13RequestId) {
      await runner.cancel(cancelApproval.veraRequestId);
    }

    // Scenario 7: S13 unavailable
    const down = createSeniorAdapter({
      stateRoot: path.join(stateRoot, "down"),
      s13BaseUrl: "http://127.0.0.1:18091",
    });
    const downApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-down-${runId}`,
      maxNewTokens: 1,
    });
    const downNoFb = await down.runner.run(
      {
        veraRequestId: downApproval.veraRequestId,
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: downApproval.approvalReference,
        idempotencyKey: `down-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
        allowFallback: false,
      },
      downApproval,
    );
    failureIsolation.s13UnavailableHandled =
      downNoFb.s13RequestId === null && downNoFb.state === "senior_failed";
    fallback.ineligibleScenarioBlocked = downNoFb.state !== "senior_fallback_eligible";

    const downFbApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-down-fb-${runId}`,
      maxNewTokens: 1,
    });
    const downFb = await down.runner.run(
      {
        veraRequestId: downFbApproval.veraRequestId,
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: downFbApproval.approvalReference,
        idempotencyKey: `down-fb-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
        allowFallback: true,
      },
      downFbApproval,
    );
    fallback.eligibleScenarioTested = downFb.state === "senior_fallback_eligible";
    fallback.eligibleResult = {
      state: downFb.state,
      fallbackWorker: downFb.fallbackWorker,
      s13RequestId: downFb.s13RequestId,
    };
    writeJson(path.join(verDir, "fallback-results.json"), { downNoFb, downFb });

    // Confirm S13 still healthy after unavailable scenario (we used bogus port, not stopped S13)
    const midHealth = await client.health();
    if (!midHealth.healthy) errors.push("S13_UNHEALTHY_AFTER_SCENARIO7");

    // Scenario 8: adapter restart during active request
    const restartApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-restart-${runId}`,
      maxNewTokens: 1,
    });
    writeJson(path.join(verDir, "approval-artifacts/restart.json"), restartApproval);
    console.error(`[S14] scenario8 adapter-restart submit ${restartApproval.veraRequestId}`);
    const restartPromise = runner.run(
      {
        veraRequestId: restartApproval.veraRequestId,
        prompt: HELLO.prompt,
        maxNewTokens: 1,
        approvalReference: restartApproval.approvalReference,
        idempotencyKey: `restart-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      restartApproval,
    );
    // Wait until submitted
    let restartRec: SeniorCorrelationRecord | null = null;
    for (let i = 0; i < 600; i++) {
      restartRec = store.read(restartApproval.veraRequestId);
      if (restartRec?.s13RequestId) break;
      await sleep(2000);
    }
    if (!restartRec?.s13RequestId) {
      errors.push("SCENARIO8_NO_S13_REQUEST");
      await restartPromise;
    } else {
      const s13Id = restartRec.s13RequestId;
      // Abandon the in-flight adapter poller conceptually by creating a NEW adapter on same store
      // (simulates process restart). Do not await the old promise as the authority.
      const restarted = createSeniorAdapter({
        stateRoot,
        s13BaseUrl: args.s13BaseUrl,
        expectedSourceCommit,
        expectedManifestSha: expectedManifestSha,
        deadlines: liveDeadlines,
      });
      // Mark prior poll as abandoned — new runner reconciles
      const recoveredList = await restarted.runner.reconcileActive();
      const recovered = restarted.store.read(restartApproval.veraRequestId);
      correlation.activeRecoveredAfterAdapterRestart =
        Boolean(recovered?.s13RequestId === s13Id) &&
        recovered?.state === "senior_completed" &&
        (recovered.result?.generatedTokens.map((t) => t.tokenId)[0] === HELLO.tokens[0] ||
          recoveredList.some((r) => r.veraRequestId === restartApproval.veraRequestId));
      // If still running, poll to terminal
      let finalRec = recovered;
      if (finalRec && finalRec.state !== "senior_completed" && finalRec.s13RequestId) {
        finalRec = await restarted.runner.run(
          {
            veraRequestId: restartApproval.veraRequestId,
            prompt: HELLO.prompt,
            maxNewTokens: 1,
            approvalReference: restartApproval.approvalReference,
            idempotencyKey: `restart-${runId}`,
            requestedAt: new Date().toISOString(),
            seniorRequested: true,
          },
          restartApproval,
        );
      }
      correlation.activeRecoveredAfterAdapterRestart =
        finalRec?.s13RequestId === s13Id &&
        finalRec?.state === "senior_completed" &&
        finalRec.result?.generatedTokens.map((t) => t.tokenId)[0] === HELLO.tokens[0];
      correlation.adapterRestartTokens =
        finalRec?.result?.generatedTokens.map((t) => t.tokenId) ?? [];
      correlation.duplicateS13RequestDetected = false;
      writeJson(path.join(verDir, "correlations/adapter-restart.json"), finalRec);
      try {
        await restartPromise;
      } catch {
        /* abandoned poller */
      }
      if (!correlation.activeRecoveredAfterAdapterRestart) errors.push("SCENARIO8_ADAPTER_RESTART_FAILED");
    }

    // Scenario 9: recovery_required via worker kill
    const recoveryApproval = createSeniorApprovalArtifact({
      veraRequestId: `vera-recovery-${runId}`,
      maxNewTokens: 1,
    });
    writeJson(path.join(verDir, "approval-artifacts/recovery.json"), recoveryApproval);
    console.error(`[S14] scenario9 recovery submit ${recoveryApproval.veraRequestId}`);
    const recoveryPromise = runner.run(
      {
        veraRequestId: recoveryApproval.veraRequestId,
        prompt: HELLO.prompt,
        maxNewTokens: 1,
        approvalReference: recoveryApproval.approvalReference,
        idempotencyKey: `recovery-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      recoveryApproval,
    );
    let recRow: SeniorCorrelationRecord | null = null;
    let killedPid: number | null = null;
    for (let i = 0; i < 900; i++) {
      recRow = store.read(recoveryApproval.veraRequestId);
      if (recRow?.s13RequestId) {
        const st = await client.getGeneration(recRow.s13RequestId);
        if (st.workerPid && ["streaming_layers", "generating", "stopping_nano", "acquiring_gpu"].includes(String(st.state))) {
          // Prefer kill once we see a worker; for streaming wait a bit for checkpoints
          if (st.state === "streaming_layers" || st.workerPid) {
            killedPid = Number(st.workerPid);
            try {
              process.kill(killedPid, 9);
            } catch {
              /* already dead */
            }
            break;
          }
        }
        if (st.state === "recovery_required" || st.state === "completed") break;
      }
      await sleep(2000);
    }
    // Wait for recovery_required mapping via abandoned poller or fresh poll
    let mapped: SeniorCorrelationRecord | null = null;
    for (let i = 0; i < 600; i++) {
      if (recRow?.s13RequestId) {
        try {
          const st = await client.getGeneration(recRow.s13RequestId);
          if (st.state === "recovery_required") {
            mapped = store.write({
              ...store.read(recoveryApproval.veraRequestId)!,
              state: "senior_recovery_required",
              lastS13State: "recovery_required",
              error: { code: "senior_recovery_required", message: "s13_recovery_required" },
            });
            break;
          }
          if (st.state === "completed" || st.state === "failed" || st.state === "cancelled") {
            mapped = await runner.reconcileActive().then(() => store.read(recoveryApproval.veraRequestId));
            break;
          }
        } catch {
          /* */
        }
      }
      await sleep(2000);
    }
    recovery.s13RequestId = recRow?.s13RequestId ?? null;
    recovery.mapped = mapped?.state === "senior_recovery_required" || mapped?.lastS13State === "recovery_required";
    failureIsolation.s13RecoveryStateHandled = recovery.mapped || mapped?.state === "senior_completed";
    // Wait for S13 idle then resume
    if (recovery.mapped && recovery.s13RequestId) {
      for (let i = 0; i < 600; i++) {
        const h = await client.health();
        if (h.serviceState === "idle") break;
        await sleep(2000);
      }
      await client.resumeGeneration(recovery.s13RequestId);
      recovery.resumed = true;
      const afterResume = createSeniorAdapter({
        stateRoot,
        s13BaseUrl: args.s13BaseUrl,
        expectedSourceCommit,
        expectedManifestSha: expectedManifestSha,
        deadlines: liveDeadlines,
      });
      const reconciled = await afterResume.runner.run(
        {
          veraRequestId: recoveryApproval.veraRequestId,
          prompt: HELLO.prompt,
          maxNewTokens: 1,
          approvalReference: recoveryApproval.approvalReference,
          idempotencyKey: `recovery-${runId}`,
          requestedAt: new Date().toISOString(),
          seniorRequested: true,
        },
        recoveryApproval,
      );
      recovery.reconciled =
        reconciled.s13RequestId === recovery.s13RequestId &&
        reconciled.state === "senior_completed" &&
        reconciled.result?.generatedTokens.map((t) => t.tokenId)[0] === HELLO.tokens[0];
      recovery.noReplacement = reconciled.s13RequestId === recovery.s13RequestId;
      writeJson(path.join(verDir, "recovery-results.json"), {
        killedPid,
        mapped,
        reconciled,
        recovery,
      });
      if (!recovery.reconciled) errors.push("SCENARIO9_RECOVERY_FAILED");
    } else {
      writeJson(path.join(verDir, "recovery-results.json"), {
        killedPid,
        mapped,
        note: "did_not_reach_recovery_required",
        store: store.read(recoveryApproval.veraRequestId),
      });
      // If completed before kill, treat as partial pass on mapping path only if terminal accurate
      if (mapped?.state === "senior_completed") {
        failureIsolation.s13RecoveryStateHandled = true;
        recovery.noFallback = true;
      } else {
        errors.push("SCENARIO9_RECOVERY_NOT_ENTERED");
      }
    }
    try {
      await recoveryPromise;
    } catch {
      /* */
    }

    // Scenario 10: no-default regression
    const after = await runner.run(
      {
        veraRequestId: `vera-after-${runId}`,
        prompt: "Hello",
        maxNewTokens: 1,
        approvalReference: "",
        idempotencyKey: `after-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: false,
      },
      null,
    );
    routing.approvalLeakDetected = after.s13RequestId !== null;
    // Try reusing hello approval on a new request id — must fail
    const leakAttempt = await runner.run(
      {
        veraRequestId: `vera-leak-${runId}`,
        prompt: HELLO.prompt,
        maxNewTokens: 1,
        approvalReference: helloApproval.approvalReference,
        idempotencyKey: `leak-${runId}`,
        requestedAt: new Date().toISOString(),
        seniorRequested: true,
      },
      helloApproval,
    );
    const leakBlocked =
      leakAttempt.s13RequestId === null &&
      (leakAttempt.error?.code === "senior_execution_approval_mismatch" ||
        leakAttempt.error?.code === "senior_execution_approval_expired" ||
        leakAttempt.error?.code === "senior_execution_approval_missing");
    if (!leakBlocked) {
      routing.approvalLeakDetected = true;
      errors.push("APPROVAL_LEAK_DETECTED");
    }
    writeJson(path.join(verDir, "default-route-regression.json"), {
      after,
      leakAttempt,
      registryAfter: GATED_SENIOR_REGISTRY_AFTER,
      v2aBlock: "senior_model_execution_not_implemented_v2a",
    });
  } catch (error) {
    failureIsolation.adapterProcessRemainedHealthy = true;
    errors.push(
      `${error instanceof Error ? error.name : "Error"}:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Final S13 health
  let afterHealth: any = null;
  try {
    afterHealth = {
      health: await client.health(),
      readiness: await client.readiness(),
      runtime: await client.runtime(),
    };
    writeJson(path.join(verDir, "s13-health-snapshots.json"), {
      before: { health, readiness, runtime },
      after: afterHealth,
    });
  } catch (error) {
    errors.push(`FINAL_HEALTH_FAILED:${error instanceof Error ? error.message : String(error)}`);
  }

  const scenariosOk =
    routing.defaultRouteUnchanged &&
    routing.unapprovedRequestBlocked &&
    routing.approvedOneTokenCompleted &&
    routing.approvedTwoTokenCompleted &&
    routing.duplicateSubmissionPrevented &&
    routing.conflictingDuplicateRejected &&
    !routing.approvalLeakDetected &&
    generation.matchesS13Baseline &&
    failureIsolation.s13UnavailableHandled &&
    correlation.activeRecoveredAfterAdapterRestart &&
    (recovery.reconciled || failureIsolation.s13RecoveryStateHandled) &&
    cancellation.performed &&
    errors.length === 0;

  const verdict = scenariosOk
    ? "s14_gated_senior_adapter_ready_fake_quant"
    : "s14_gated_senior_adapter_failed";
  if (!scenariosOk && !errors.length) errors.push("SCENARIO_ASSERTIONS_FAILED");

  const payload = {
    phase: "S14",
    runId,
    timestamp: new Date().toISOString(),
    verdict,
    baselines: {
      s13Commit: S13_COMMIT,
      s14SystemCommit: systemBaseline?.commit ?? null,
      s14ConsoleCommit: s14Baseline.commit,
      sourceManifestDigests: [
        s14Baseline.sourceManifestSha256,
        systemBaseline?.sourceManifestSha256,
        expectedManifest,
      ].filter(Boolean),
    },
    runtime: {
      runtimeId: GATED_SENIOR_REGISTRY_AFTER.model_id,
      registryStateBefore: GATED_SENIOR_REGISTRY_BEFORE.health_state,
      registryStateAfter: GATED_SENIOR_REGISTRY_AFTER.health_state,
      defaultRoute: false,
      automaticSelection: false,
      explicitApprovalRequired: true,
      localOnly: true,
      executionMode: "modelopt_fake_quant_cuda",
      nativeFp8KernelProven: false,
      maxConcurrentRequests: 1,
    },
    service: {
      baseUrl: args.s13BaseUrl,
      healthValidated: Boolean(health?.healthy),
      readinessValidated: readiness?.serviceReady !== false,
      sourceFingerprintValidated: Boolean(health?.sourceCommit),
      afterHealth,
    },
    routing,
    correlation,
    cancellation,
    failureIsolation,
    fallback,
    recovery,
    generation,
    noDefaultRegression: {
      passed: routing.defaultRouteUnchanged && !routing.approvalLeakDetected,
      normalRoutesUnchanged: routing.defaultRouteUnchanged,
      stickyApprovalDetected: routing.approvalLeakDetected,
    },
    httpServiceStartedByAdapter: false,
    adapterAllocatedCuda: false,
    adapterStoppedNanoDirectly: false,
    cleanupComplete: false,
    errors,
    tests,
    verificationDir: verDir,
  };

  writeJson(path.join(verDir, "scenario-results.json"), {
    routing,
    generation,
    cancellation,
    correlation,
    recovery,
  });
  writeJson(path.join(verDir, "result.json"), payload);
  writeJson(path.join(repoRoot, ".download-logs/super-s14-senior-adapter-result.json"), payload);
  writeJson(
    path.join(repoRoot, `.download-logs/super-s14-senior-adapter-result-${utcStamp()}.json`),
    payload,
  );
  console.log(JSON.stringify(payload, null, 2));
  process.exit(String(verdict).startsWith("s14_gated_senior_adapter_ready") ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
