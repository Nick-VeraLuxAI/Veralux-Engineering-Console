/**
 * Direct A/B/C planning probes for conditional budget rescue.
 * A = single-shot 10k; B = fixed 4k two-phase; C = conditional rescue.
 */
import fs from "fs";
import path from "path";
import { invokeAutonomousWorker } from "../../../src/lib/engineer-console/autonomous-engineer/worker-client";

const outDir = path.resolve("evidence/ae-q1-conditional-reasoning");
fs.mkdirSync(outDir, { recursive: true });

const prompt = [
  "Run ID: probe-lease-abc",
  "Objective: Directors need a small lease helper under src/lease that tracks whether a subject key may hold a lease inside a TTL window, validates inputs, covers grant and deny paths with tests.",
  "Constraints: Stay inside src/lease/",
  "Existing files: src/lease/README.md",
  "package.json scripts: {\"test\":\"node --test src/lease/lease.test.js\"}",
  "Return worker plan JSON with runId matching the run, allowedFiles, and file operations with full content.",
].join("\n");

process.env.VITEST = "false";
if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");
process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
process.env.ENGINEER_CONSOLE_MODEL_PROVIDER = "mock";
process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED = "true";
process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL =
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ?? "http://127.0.0.1:8082/v1";
process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL =
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ?? "Nemotron-Nano-30B-A3B-NVFP4";
process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS = "600000";
process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN = "262144";
delete process.env.ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION;

type Mode = "A" | "B" | "C";

async function runMode(mode: Mode, label: string) {
  delete process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET;
  if (mode === "A") {
    process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE = "false";
  } else if (mode === "B") {
    process.env.ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET = "4000";
    process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE = "false";
  } else {
    process.env.ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE = "true";
  }
  const t0 = Date.now();
  const result = await invokeAutonomousWorker({
    role: "planning",
    system: "",
    user: prompt,
  });
  const row = {
    mode,
    label,
    elapsedMs: Date.now() - t0,
    schemaValid: result.schemaValid,
    generationBudgetExhausted: result.generationBudgetExhausted,
    parseErrors: result.parseErrors,
    schemaErrors: result.schemaErrors,
    ops: Array.isArray((result.parsed as { operations?: unknown[] } | null)?.operations)
      ? (result.parsed as { operations: unknown[] }).operations.length
      : 0,
    telemetry: result.telemetry,
    rawTail: result.rawResponse.slice(-200),
  };
  fs.writeFileSync(path.join(outDir, `abc_${label}.json`), JSON.stringify(row, null, 2));
  console.log(
    JSON.stringify({
      mode,
      label,
      schemaValid: row.schemaValid,
      gbe: row.generationBudgetExhausted,
      fr: row.telemetry?.finishReason,
      rescue: row.telemetry?.rescueTriggered,
      policy: row.telemetry?.policy,
      twoPhase: row.telemetry?.twoPhaseReasoning,
      p1: row.telemetry?.phase1FinishReason,
      p2: row.telemetry?.phase2FinishReason,
      rb: row.telemetry?.reasoningBudget ?? row.telemetry?.rescueReasoningBudget,
      completion: row.telemetry?.completionTokens,
      reasoning: row.telemetry?.reasoningTokens,
      elapsedMs: row.elapsedMs,
      ops: row.ops,
    }),
  );
  return row;
}

async function main() {
  const rows = [];
  rows.push(await runMode("A", "A1"));
  rows.push(await runMode("A", "A2"));
  rows.push(await runMode("B", "B1"));
  rows.push(await runMode("B", "B2"));
  rows.push(await runMode("C", "C1"));
  rows.push(await runMode("C", "C2"));

  const summary = {
    at: new Date().toISOString(),
    FINAL_PLAN_RESERVE: 1700,
    RESCUE_REASONING_BUDGET: 8300,
    rows,
    comparison: {
      A_ok: rows.filter((r) => r.mode === "A" && r.schemaValid && !r.generationBudgetExhausted).length,
      B_ok: rows.filter((r) => r.mode === "B" && r.schemaValid && !r.generationBudgetExhausted).length,
      C_ok: rows.filter((r) => r.mode === "C" && r.schemaValid && !r.generationBudgetExhausted).length,
      C_rescue_count: rows.filter((r) => r.mode === "C" && r.telemetry?.rescueTriggered).length,
    },
  };
  fs.writeFileSync(path.join(outDir, "abc_comparison.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.comparison, null, 2));
}

void main();
