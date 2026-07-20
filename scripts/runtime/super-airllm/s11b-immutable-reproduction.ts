import { spawn } from "child_process";
import path from "path";

export type S11BImmutableReproductionVerdict =
  | "s11b_immutable_reproduction_preflight_ready"
  | "s11b_immutable_reproduction_preflight_blocked"
  | "s11b_immutable_reproduction_ready"
  | "s11b_provenance_audit_ready_reproduction_not_authorized"
  | "s11b_baseline_commit_not_authorized"
  | "s11b_immutable_reproduction_blocked"
  | "s11b_immutable_reproduction_failed"
  | "s11b_generation_passed_nano_restore_failed"
  | "dry_run";

export interface S11BImmutableReproductionChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S11BImmutableReproductionVerdict | null;
}

export interface S11BImmutableReproductionOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowS11bImmutableReproduction?: boolean;
  confirmS11bImmutableReproduction?: boolean;
  allowCreateS11BaselineCommit?: boolean;
  confirmCreateS11BaselineCommit?: boolean;
  allowStopNanoRuntime?: boolean;
  confirmStopNanoRuntime?: boolean;
  prompt?: string;
  nanoContainer?: string;
  gpuUuid?: string;
  skipTests?: boolean;
  runTestsOnly?: boolean;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S11BImmutableReproductionChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S11BImmutableReproductionChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S11B_IMMUTABLE_REPRODUCTION_PROBE_FOREGROUND: "1" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      let verdict: S11BImmutableReproductionVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S11BImmutableReproductionVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "s11b_immutable_reproduction_failed" : null;
      }
      resolve({
        launched: true,
        exit_code: exitCode,
        timed_out: timedOut,
        stdout,
        stderr,
        verdict,
      });
    });
  });
}

export async function runS11BImmutableReproduction(
  options: S11BImmutableReproductionOptions = {},
): Promise<S11BImmutableReproductionChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(
    repoRoot,
    "scripts/runtime/super-airllm/run-s11b-immutable-reproduction.sh",
  );
  const command = [scriptPath];
  const reproductionAuthorized = Boolean(
    options.allowS11bImmutableReproduction && options.confirmS11bImmutableReproduction,
  );

  if (options.runTestsOnly) {
    command.push("--run-tests-only");
  } else if (options.allowCreateS11BaselineCommit || options.confirmCreateS11BaselineCommit) {
    if (options.allowCreateS11BaselineCommit) {
      command.push("--allow-create-s11-baseline-commit");
    }
    if (options.confirmCreateS11BaselineCommit) {
      command.push("--confirm-create-s11-baseline-commit");
    }
  } else if (options.preflightOnly || !reproductionAuthorized) {
    command.push("--preflight-only");
    if (options.skipTests) command.push("--skip-tests");
  } else {
    command.push(
      "--allow-s11b-immutable-reproduction",
      "--confirm-s11b-immutable-reproduction",
    );
    if (options.allowStopNanoRuntime) command.push("--allow-stop-nano-runtime");
    if (options.confirmStopNanoRuntime) command.push("--confirm-stop-nano-runtime");
    if (options.prompt) command.push("--prompt", options.prompt);
    if (options.nanoContainer) command.push("--nano-container", options.nanoContainer);
    if (options.gpuUuid) command.push("--gpu-uuid", options.gpuUuid);
    if (options.skipTests) command.push("--skip-tests");
  }

  const childRunner = options.childRunner ?? defaultChildRunner;
  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 7200) * 1000,
  });
}
