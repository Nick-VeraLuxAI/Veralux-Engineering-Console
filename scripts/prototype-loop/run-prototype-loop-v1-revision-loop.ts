import { execFile } from "child_process";
import { promisify } from "util";
import {
  runPrototypeRevisionLoop,
  type PrototypeRevisionVeraReview,
} from "../../src/lib/engineer-console/prototype-loop/prototype-revision-loop";
import type { PrototypeLoopCommandResult } from "../../src/lib/engineer-console/prototype-loop/prototype-loop-v1";
import type { PrototypeLoopHandoff } from "../../src/lib/engineer-console/prototype-loop/prototype-loop-lifecycle";

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

function failingRunner(): (cwd: string, command: string) => Promise<PrototypeLoopCommandResult> {
  return async (_cwd, command) => ({
    command,
    status: "failed",
    exitCode: 1,
    stdout: "",
    stderr: "phase-5 proof intentionally failed first-round gate",
    durationMs: 1,
  });
}

async function main(): Promise<void> {
  const hermesPath = argValue("--hermes-agent-path") ?? process.env.HERMES_AGENT_PATH ?? "/home/ndesantis/.hermes/hermes-agent";
  const request = argValue("--request") ?? defaultRequest;
  const proofRunRoot = argValue("--proof-run-root") ?? ".prototype-loop/phase-5-proof-runs";
  const handoff = await callHermesJson<PrototypeLoopHandoff>(
    hermesPath,
    ["--mode", "handoff", "--request", request],
  );
  if (!handoff.console_assignment) {
    throw new Error("PROTOTYPE_REVISION_LOOP_MISSING_CONSOLE_ASSIGNMENT");
  }

  const reviewEvidence = async (evidencePath: string) => callHermesJson<PrototypeRevisionVeraReview>(
    hermesPath,
    ["--mode", "review", "--evidence-file", evidencePath],
  );

  const directReady = await runPrototypeRevisionLoop({
    assignment: handoff.console_assignment,
    request,
    repoRoot: process.cwd(),
    proofRunRoot: `${proofRunRoot}/direct-ready`,
    reviewEvidence,
  });

  const revisionThenReady = await runPrototypeRevisionLoop({
    assignment: handoff.console_assignment,
    request,
    repoRoot: process.cwd(),
    proofRunRoot: `${proofRunRoot}/revision-then-ready`,
    reviewEvidence,
    commandRunnerForRound: (round) => round === 1 ? failingRunner() : undefined,
  });

  const result = {
    status: directReady.ready_for_user_approval && revisionThenReady.ready_for_user_approval ? "PASS" : "BLOCKED",
    direct_ready: {
      status: directReady.status,
      round_count: directReady.round_count,
      final_readiness_verdict: directReady.final_readiness_verdict,
      result_path: directReady.result_path,
      final_evidence_path: directReady.final_evidence_path,
      final_approval_question: directReady.final_approval_question,
    },
    revision_then_ready: {
      status: revisionThenReady.status,
      round_count: revisionThenReady.round_count,
      final_readiness_verdict: revisionThenReady.final_readiness_verdict,
      result_path: revisionThenReady.result_path,
      final_evidence_path: revisionThenReady.final_evidence_path,
      first_round_revision_request: revisionThenReady.rounds[0]?.revision_request ?? null,
      final_approval_question: revisionThenReady.final_approval_question,
    },
    integration_performed: directReady.integration_performed || revisionThenReady.integration_performed,
    fallback_used: directReady.fallback_used || revisionThenReady.fallback_used,
    senior_super_used: directReady.senior_super_used || revisionThenReady.senior_super_used,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "PASS") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
