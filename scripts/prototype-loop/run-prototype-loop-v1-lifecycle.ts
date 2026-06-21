import { execFile } from "child_process";
import { promisify } from "util";
import {
  runPrototypeLoopLifecycleV1,
  type PrototypeLoopHandoff,
  type PrototypeLoopVeraReview,
} from "../../src/lib/engineer-console/prototype-loop/prototype-loop-lifecycle";

const execFileAsync = promisify(execFile);
const defaultRequest = "Vera, build a tiny CLI tool that reads a text file and returns word count, character count, and the top 5 repeated words. Keep it as a prototype only and ask me before implementing it anywhere.";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function callHermesJson<T>(hermesPath: string, args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("uv", ["--directory", hermesPath, "run", "python", "-m", "gateway.prototype_loop", ...args], {
    cwd: hermesPath,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONPATH: hermesPath,
    },
  });
  return JSON.parse(stdout) as T;
}

async function main(): Promise<void> {
  const hermesPath = argValue("--hermes-agent-path") ?? process.env.HERMES_AGENT_PATH ?? "/home/ndesantis/.hermes/hermes-agent";
  const request = argValue("--request") ?? defaultRequest;
  const proofRunRoot = argValue("--proof-run-root") ?? undefined;

  const result = await runPrototypeLoopLifecycleV1({
    request,
    repoRoot: process.cwd(),
    proofRunRoot,
    createHandoff: async (naturalLanguageRequest) => callHermesJson<PrototypeLoopHandoff>(
      hermesPath,
      ["--mode", "handoff", "--request", naturalLanguageRequest],
    ),
    reviewEvidence: async (evidencePath) => callHermesJson<PrototypeLoopVeraReview>(
      hermesPath,
      ["--mode", "review", "--evidence-file", evidencePath],
    ),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.lifecycle_status !== "PASS") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
