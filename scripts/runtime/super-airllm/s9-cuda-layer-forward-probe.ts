import { spawn } from "child_process";
import path from "path";

export type S9CudaLayerForwardProbeVerdict =
  | "s9_cuda_forward_preflight_ready"
  | "s9_cuda_forward_preflight_blocked"
  | "s9_cuda_forward_preflight_failed"
  | "s9_cuda_layer_forward_ready"
  | "s9_cuda_layer_forward_blocked"
  | "s9_cuda_layer_forward_failed"
  | "s9_cuda_layer_forward_passed_nano_restore_failed"
  | "dry_run";

export interface S9CudaLayerForwardProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S9CudaLayerForwardProbeVerdict | null;
}

export interface S9CudaLayerForwardProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowS9CudaForward?: boolean;
  confirmS9CudaForward?: boolean;
  allowStopNanoRuntime?: boolean;
  confirmStopNanoRuntime?: boolean;
  layerIndex?: number;
  nanoContainer?: string;
  gpuUuid?: string;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S9CudaLayerForwardProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S9CudaLayerForwardProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S9_CUDA_FORWARD_PROBE_FOREGROUND: "1" },
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
      let verdict: S9CudaLayerForwardProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S9CudaLayerForwardProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "s9_cuda_layer_forward_failed" : null;
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

export async function runS9CudaLayerForwardProbe(
  options: S9CudaLayerForwardProbeOptions = {},
): Promise<S9CudaLayerForwardProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/runtime/super-airllm/run-s9-cuda-layer-forward-probe.sh");
  const command = [scriptPath];
  const probeAuthorized = Boolean(options.allowS9CudaForward && options.confirmS9CudaForward);
  if (options.preflightOnly || !probeAuthorized) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-s9-cuda-forward", "--confirm-s9-cuda-forward");
    if (options.allowStopNanoRuntime) {
      command.push("--allow-stop-nano-runtime");
    }
    if (options.confirmStopNanoRuntime) {
      command.push("--confirm-stop-nano-runtime");
    }
    if (typeof options.layerIndex === "number") {
      command.push("--layer-index", String(options.layerIndex));
    }
    if (options.nanoContainer) {
      command.push("--nano-container", options.nanoContainer);
    }
    if (options.gpuUuid) {
      command.push("--gpu-uuid", options.gpuUuid);
    }
  }
  const childRunner = options.childRunner ?? defaultChildRunner;
  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 1200) * 1000,
  });
}
