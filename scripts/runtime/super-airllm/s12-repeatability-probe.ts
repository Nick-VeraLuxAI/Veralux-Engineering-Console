import { spawn } from "child_process";
import path from "path";

export type S12RepeatabilityVerdict =
  | "s12_repeatability_preflight_ready"
  | "s12_repeatability_preflight_blocked"
  | "s12_repeatable_cold_start_ready_fake_quant"
  | "s12_baseline_commit_not_authorized"
  | "s12_repeatability_run_not_authorized"
  | "s12_repeatable_cold_start_blocked"
  | "s12_repeatable_cold_start_failed"
  | "s12_generation_passed_nano_restore_failed"
  | "dry_run";

export interface S12RepeatabilityChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S12RepeatabilityVerdict | null;
}

export interface S12RepeatabilityOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowS12RepeatabilityRun?: boolean;
  confirmS12RepeatabilityRun?: boolean;
  allowTwoNanoInterruptions?: boolean;
  confirmTwoNanoInterruptions?: boolean;
  allowCreateS12BaselineCommit?: boolean;
  confirmCreateS12BaselineCommit?: boolean;
  nanoContainer?: string;
  gpuUuid?: string;
  skipTests?: boolean;
  runTestsOnly?: boolean;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S12RepeatabilityChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S12RepeatabilityChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S12_REPEATABILITY_PROBE_FOREGROUND: "1" },
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
      let verdict: S12RepeatabilityVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S12RepeatabilityVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "s12_repeatable_cold_start_failed" : null;
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

export async function runS12RepeatabilityProbe(
  options: S12RepeatabilityOptions = {},
): Promise<S12RepeatabilityChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(
    repoRoot,
    "scripts/runtime/super-airllm/run-s12-repeatability-probe.sh",
  );
  const command = [scriptPath];
  const runAuthorized = Boolean(
    options.allowS12RepeatabilityRun && options.confirmS12RepeatabilityRun,
  );

  if (options.runTestsOnly) {
    command.push("--run-tests-only");
  } else if (options.allowCreateS12BaselineCommit || options.confirmCreateS12BaselineCommit) {
    if (options.allowCreateS12BaselineCommit) {
      command.push("--allow-create-s12-baseline-commit");
    }
    if (options.confirmCreateS12BaselineCommit) {
      command.push("--confirm-create-s12-baseline-commit");
    }
  } else if (options.preflightOnly || !runAuthorized) {
    command.push("--preflight-only");
    if (options.skipTests) command.push("--skip-tests");
  } else {
    command.push("--allow-s12-repeatability-run", "--confirm-s12-repeatability-run");
    if (options.allowTwoNanoInterruptions) command.push("--allow-two-nano-interruptions");
    if (options.confirmTwoNanoInterruptions) command.push("--confirm-two-nano-interruptions");
    if (options.nanoContainer) command.push("--nano-container", options.nanoContainer);
    if (options.gpuUuid) command.push("--gpu-uuid", options.gpuUuid);
    if (options.skipTests) command.push("--skip-tests");
  }

  const childRunner = options.childRunner ?? defaultChildRunner;
  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 14400) * 1000,
  });
}
