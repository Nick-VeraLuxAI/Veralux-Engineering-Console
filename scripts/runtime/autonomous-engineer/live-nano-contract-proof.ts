/**
 * Live Nano structured-contract proof for Autonomous Engineer V1.
 * Does not mutate the repo. Does not print secrets.
 *
 *   ENGINEER_CONSOLE_AE_WORKER_ROUTE=live \
 *   ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true \
 *   npx tsx scripts/runtime/autonomous-engineer/live-nano-contract-proof.ts
 */
import fs from "fs";
import path from "path";
import { invokeAutonomousWorker } from "../../../src/lib/engineer-console/autonomous-engineer/worker-client";
import { validateAutonomousWorkerSchema } from "../../../src/lib/engineer-console/autonomous-engineer/worker-schemas";
import type { AutonomousWorkerRole } from "../../../src/lib/engineer-console/autonomous-engineer/worker-schemas";

const OUT_DIR = path.join(process.cwd(), "test-results");

function snippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

async function proveRole(
  role: AutonomousWorkerRole,
  user: string,
): Promise<Record<string, unknown>> {
  const result = await invokeAutonomousWorker({ role, system: "", user });
  const schema = validateAutonomousWorkerSchema(role, result.parsed);
  return {
    role,
    providerName: result.providerName,
    modelName: result.modelName,
    route: result.route,
    mockBypassed: result.mockBypassed,
    requestPath: result.requestPath,
    schemaValid: result.schemaValid && schema.valid,
    parseErrors: result.parseErrors,
    schemaErrors: [...result.schemaErrors, ...schema.errors],
    repairAttempted: result.repairAttempted,
    accepted: result.schemaValid && result.parsed !== null,
    parsedKeys: result.parsed ? Object.keys(result.parsed) : [],
    responseSnippet: snippet(result.rawResponse),
  };
}

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  const interpretation = await proveRole(
    "interpretation",
    "Objective: Directors need a one-line QC-versus-baseline sentence that distinguishes new regressions from pre-existing failures. Do not open a PR.",
  );
  const planning = await proveRole(
    "planning",
    [
      "Run ID: live-contract-run",
      "Objective: Add src/lib/engineer-console/autonomous-engineer/qc-delta-label.ts exporting formatQcDeltaLabel({ newCount, preExistingCount, resolvedCount }).",
      "Return worker plan JSON with runId live-contract-run, allowedFiles, and one create_file operation with full content.",
    ].join("\n"),
  );
  const completion = await proveRole(
    "completion",
    "Evidence: helper exists, unit tests pass, QC vs baseline has 0 new regressions. Is the objective complete?",
  );
  const diagnosis = await proveRole(
    "diagnosis",
    "Previous plan created qc-delta-label.ts but the exported function was named formatLabel instead of formatQcDeltaLabel. Tests failed. Suggest a revised strategy. Do not repeat the failed name.",
  );
  const replan = await proveRole(
    "replan",
    [
      "Run ID: live-contract-run",
      "Previous hypothesis failed because the export was named formatLabel.",
      "Suggested strategy: export formatQcDeltaLabel with the required argument shape.",
      "Return a revised worker plan JSON with a different summary and the correct export name.",
    ].join("\n"),
  );

  const proof = {
    at: new Date().toISOString(),
    runtime: "vllm",
    endpoint: "http://127.0.0.1:8081/v1/chat/completions",
    model: process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL,
    roles: { interpretation, planning, completion, diagnosis, replan },
    materiallyDifferentReplan:
      typeof planning.parsedKeys === "object" &&
      JSON.stringify(planning.responseSnippet) !== JSON.stringify(replan.responseSnippet),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, "ae-v1-live-nano-contract.json");
  fs.writeFileSync(outFile, JSON.stringify(proof, null, 2));
  const failed = Object.values(proof.roles).filter((role) => !role.accepted);
  console.log(JSON.stringify({ outFile, failed: failed.map((role) => role.role), materiallyDifferentReplan: proof.materiallyDifferentReplan }, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
