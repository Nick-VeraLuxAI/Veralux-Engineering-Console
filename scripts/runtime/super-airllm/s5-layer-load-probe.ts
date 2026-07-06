import { spawn } from "child_process";
import path from "path";

export type S5LayerLoadProbeVerdict =
  | "layer_load_preflight_ready"
  | "layer_load_preflight_blocked"
  | "layer_load_probe_ready"
  | "layer_load_probe_failed"
  | "layer_forward_probe_ready"
  | "layer_forward_probe_unsupported"
  | "layer_forward_probe_failed"
  | "layer_forward_probe_timeout"
  | "layer_load_probe_blocked"
  | "dry_run";

export interface S5LayerLoadProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S5LayerLoadProbeVerdict | null;
}

export interface S5LayerLoadProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowLayerLoadProbe?: boolean;
  confirmLayerLoadProbe?: boolean;
  allowLayerForwardProbe?: boolean;
  confirmLayerForwardProbe?: boolean;
  includeNormLayer?: boolean;
  childRunner?: (command: string[], options: { cwd: string; timeoutMs: number }) => Promise<S5LayerLoadProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S5LayerLoadProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, LAYER_LOAD_PROBE_FOREGROUND: "1" },
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
      let verdict: S5LayerLoadProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S5LayerLoadProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "layer_forward_probe_timeout" : null;
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

export async function runS5LayerLoadProbe(options: S5LayerLoadProbeOptions = {}): Promise<S5LayerLoadProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/runtime/super-airllm/run-layer-load-probe.sh");
  const command = [scriptPath];
  if (options.preflightOnly || !(options.allowLayerLoadProbe && options.confirmLayerLoadProbe)) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-layer-load-probe", "--confirm-layer-load-probe");
    if (options.allowLayerForwardProbe && options.confirmLayerForwardProbe) {
      command.push("--allow-layer-forward-probe", "--confirm-layer-forward-probe");
    }
    if (options.includeNormLayer) {
      command.push("--include-norm-layer");
    }
  }
  const childRunner = options.childRunner ?? defaultChildRunner;
  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 600) * 1000,
  });
}
