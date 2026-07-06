import { spawn } from "child_process";
import path from "path";

export type S7ModeloptQuantizerProbeVerdict =
  | "modelopt_quantizer_preflight_ready"
  | "modelopt_quantizer_preflight_blocked"
  | "modelopt_quantizer_probe_ready"
  | "modelopt_quantizer_probe_unsupported"
  | "modelopt_quantizer_probe_failed"
  | "modelopt_quantizer_probe_timeout"
  | "modelopt_quantizer_probe_blocked"
  | "dry_run";

export interface S7ModeloptQuantizerProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S7ModeloptQuantizerProbeVerdict | null;
}

export interface S7ModeloptQuantizerProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowModeloptQuantizerProbe?: boolean;
  confirmModeloptQuantizerProbe?: boolean;
  layerIndex?: number;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S7ModeloptQuantizerProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S7ModeloptQuantizerProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, MODELOPT_QUANTIZER_PROBE_FOREGROUND: "1" },
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
      let verdict: S7ModeloptQuantizerProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S7ModeloptQuantizerProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "modelopt_quantizer_probe_timeout" : null;
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

export async function runS7ModeloptQuantizerProbe(
  options: S7ModeloptQuantizerProbeOptions = {},
): Promise<S7ModeloptQuantizerProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/runtime/super-airllm/run-modelopt-quantizer-probe.sh");
  const command = [scriptPath];
  if (
    options.preflightOnly ||
    !(options.allowModeloptQuantizerProbe && options.confirmModeloptQuantizerProbe)
  ) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-modelopt-quantizer-probe", "--confirm-modelopt-quantizer-probe");
    if (typeof options.layerIndex === "number") {
      command.push("--layer-index", String(options.layerIndex));
    }
  }
  const childRunner = options.childRunner ?? defaultChildRunner;
  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 600) * 1000,
  });
}
