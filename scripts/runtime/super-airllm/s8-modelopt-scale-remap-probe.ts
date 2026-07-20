import { spawn } from "child_process";
import path from "path";

export type S8ModeloptScaleRemapProbeVerdict =
  | "modelopt_scale_remap_preflight_ready"
  | "modelopt_scale_remap_preflight_blocked"
  | "modelopt_scale_remap_probe_ready"
  | "modelopt_scale_remap_injection_ready_forward_unsupported"
  | "modelopt_scale_remap_probe_unsupported"
  | "modelopt_scale_remap_probe_failed"
  | "modelopt_scale_remap_probe_timeout"
  | "modelopt_scale_remap_probe_blocked"
  | "dry_run";

export interface S8ModeloptScaleRemapProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S8ModeloptScaleRemapProbeVerdict | null;
}

export interface S8ModeloptScaleRemapProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowModeloptScaleRemapProbe?: boolean;
  confirmModeloptScaleRemapProbe?: boolean;
  layerIndex?: number;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S8ModeloptScaleRemapProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S8ModeloptScaleRemapProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, MODELOPT_SCALE_REMAP_PROBE_FOREGROUND: "1" },
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
      let verdict: S8ModeloptScaleRemapProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S8ModeloptScaleRemapProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "modelopt_scale_remap_probe_timeout" : null;
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

export async function runS8ModeloptScaleRemapProbe(
  options: S8ModeloptScaleRemapProbeOptions = {},
): Promise<S8ModeloptScaleRemapProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/runtime/super-airllm/run-modelopt-scale-remap-probe.sh");
  const command = [scriptPath];
  if (
    options.preflightOnly ||
    !(options.allowModeloptScaleRemapProbe && options.confirmModeloptScaleRemapProbe)
  ) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-modelopt-scale-remap-probe", "--confirm-modelopt-scale-remap-probe");
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
