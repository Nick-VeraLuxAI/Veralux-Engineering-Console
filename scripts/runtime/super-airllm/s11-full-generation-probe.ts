import { spawn } from "child_process";
import path from "path";

export type S11FullGenerationProbeVerdict =
  | "s11_full_generation_preflight_ready"
  | "s11_full_generation_preflight_blocked"
  | "s11_full_generation_preflight_failed"
  | "s11_full_generation_ready_native_fp8"
  | "s11_full_generation_ready_fake_quant"
  | "s11_full_model_forward_passed_generation_failed"
  | "s11_full_generation_blocked"
  | "s11_full_generation_failed"
  | "s11_full_generation_passed_nano_restore_failed"
  | "dry_run";

export interface S11FullGenerationProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S11FullGenerationProbeVerdict | null;
}

export interface S11FullGenerationProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowS11FullGeneration?: boolean;
  confirmS11FullGeneration?: boolean;
  allowStopNanoRuntime?: boolean;
  confirmStopNanoRuntime?: boolean;
  prompt?: string;
  nanoContainer?: string;
  gpuUuid?: string;
  resumeRunId?: string;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S11FullGenerationProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S11FullGenerationProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S11_FULL_GENERATION_PROBE_FOREGROUND: "1" },
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
      let verdict: S11FullGenerationProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S11FullGenerationProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "s11_full_generation_failed" : null;
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

export async function runS11FullGenerationProbe(
  options: S11FullGenerationProbeOptions = {},
): Promise<S11FullGenerationProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(
    repoRoot,
    "scripts/runtime/super-airllm/run-s11-full-generation-probe.sh",
  );
  const command = [scriptPath];
  const authorized = Boolean(options.allowS11FullGeneration && options.confirmS11FullGeneration);
  if (options.preflightOnly || !authorized) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-s11-full-generation", "--confirm-s11-full-generation");
    if (options.allowStopNanoRuntime) command.push("--allow-stop-nano-runtime");
    if (options.confirmStopNanoRuntime) command.push("--confirm-stop-nano-runtime");
    if (options.prompt) command.push("--prompt", options.prompt);
    if (options.nanoContainer) command.push("--nano-container", options.nanoContainer);
    if (options.gpuUuid) command.push("--gpu-uuid", options.gpuUuid);
    if (options.resumeRunId) command.push("--resume-run-id", options.resumeRunId);
  }
  const childRunner = options.childRunner ?? defaultChildRunner;
  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 7200) * 1000,
  });
}
