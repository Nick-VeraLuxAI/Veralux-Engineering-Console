import { spawn } from "child_process";
import path from "path";

export type S10MultilayerStreamingProbeVerdict =
  | "s10_multilayer_preflight_ready"
  | "s10_multilayer_preflight_blocked"
  | "s10_multilayer_preflight_failed"
  | "s10_multilayer_streaming_ready_native_fp8"
  | "s10_multilayer_streaming_ready_fake_quant"
  | "s10_multilayer_streaming_blocked"
  | "s10_multilayer_streaming_failed"
  | "s10_multilayer_streaming_passed_nano_restore_failed"
  | "dry_run";

export interface S10MultilayerStreamingProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S10MultilayerStreamingProbeVerdict | null;
}

export interface S10MultilayerStreamingProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowS10MultilayerCuda?: boolean;
  confirmS10MultilayerCuda?: boolean;
  allowStopNanoRuntime?: boolean;
  confirmStopNanoRuntime?: boolean;
  layers?: number[];
  nanoContainer?: string;
  gpuUuid?: string;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S10MultilayerStreamingProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S10MultilayerStreamingProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S10_MULTILAYER_PROBE_FOREGROUND: "1" },
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
      let verdict: S10MultilayerStreamingProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S10MultilayerStreamingProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "s10_multilayer_streaming_failed" : null;
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

export async function runS10MultilayerStreamingProbe(
  options: S10MultilayerStreamingProbeOptions = {},
): Promise<S10MultilayerStreamingProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(
    repoRoot,
    "scripts/runtime/super-airllm/run-s10-multilayer-streaming-probe.sh",
  );
  const command = [scriptPath];
  const authorized = Boolean(options.allowS10MultilayerCuda && options.confirmS10MultilayerCuda);
  if (options.preflightOnly || !authorized) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-s10-multilayer-cuda", "--confirm-s10-multilayer-cuda");
    if (options.allowStopNanoRuntime) {
      command.push("--allow-stop-nano-runtime");
    }
    if (options.confirmStopNanoRuntime) {
      command.push("--confirm-stop-nano-runtime");
    }
    if (options.layers?.length) {
      command.push("--layers", options.layers.join(","));
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
    timeoutMs: (options.timeoutSeconds ?? 2400) * 1000,
  });
}
