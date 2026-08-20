/**
 * Probe live planning against Console AE library (context-size regression).
 */
import fs from "fs";
import path from "path";
import { invokeAutonomousWorker } from "../../../src/lib/engineer-console/autonomous-engineer/worker-client";
import {
  listAuthorizedWorktreeFiles,
  readAuthorizedWorktreeSnippets,
} from "../../../src/lib/engineer-console/autonomous-engineer/plan-worktree-adapter";

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  delete process.env.VITEST;

  const prefixes = ["src/lib/engineer-console/autonomous-engineer/"];
  const files = listAuthorizedWorktreeFiles(process.cwd(), prefixes);
  const snippets = readAuthorizedWorktreeSnippets(process.cwd(), prefixes);
  const user = [
    "Run ID: probe-console-plan",
    "Objective: Add formatDirectorRiskLine(severity, summary) returning '[severity] summary' and throwing if severity is missing. Stay in autonomous-engineer library. Vitest tests required.",
    "Requirements: helper + tests",
    "Constraints: Prefer create_file for a new small helper + Vitest test. Do not rewrite large modules.",
    `Allowed path prefixes: ${prefixes.join(", ")}`,
    `Existing files (truncated): ${files.slice(0, 24).join(", ")}`,
    'package.json scripts: {"test":"vitest run"}',
    "Use Vitest because package.json runs vitest.",
    `Authorized source snippets:\n${snippets.map((s) => `--- ${s.path} ---\n${s.content}`).join("\n\n")}`,
    "Return worker plan JSON with runId probe-console-plan, allowedFiles, and operations.",
  ].join("\n");

  const result = await invokeAutonomousWorker({ role: "planning", system: "", user });
  const proof = {
    promptChars: user.length,
    fileCount: files.length,
    snippetCount: snippets.length,
    snippetBytes: snippets.reduce((sum, s) => sum + s.content.length, 0),
    schemaValid: result.schemaValid,
    parseErrors: result.parseErrors,
    schemaErrors: result.schemaErrors,
    repairAttempted: result.repairAttempted,
    accepted: result.schemaValid && result.parsed !== null,
    parsedKeys: result.parsed ? Object.keys(result.parsed) : [],
    ops: Array.isArray(result.parsed?.operations) ? result.parsed.operations.length : 0,
    responseSnippet: (result.rawResponse || "").replace(/\s+/g, " ").slice(0, 400),
  };
  const out = path.join(process.cwd(), "test-results", "ae-v1-robust-console-plan-probe.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.accepted) process.exitCode = 1;
}

void main();
