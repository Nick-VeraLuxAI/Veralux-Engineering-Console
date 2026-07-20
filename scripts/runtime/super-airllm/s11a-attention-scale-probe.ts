import { spawn } from "child_process";
import path from "path";

export type S11AAttentionScaleProbeVerdict =
  | "s11a_attention_scale_preflight_ready"
  | "s11a_attention_scale_forward_ready_native_fp8"
  | "s11a_attention_scale_forward_ready_fake_quant"
  | "s11a_attention_scale_semantics_ready_forward_unsupported"
  | "s11a_attention_scale_probe_blocked"
  | "s11a_attention_scale_probe_failed"
  | "s11a_attention_forward_passed_nano_restore_failed"
  | "dry_run";

export interface S11AAttentionScaleProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S11AAttentionScaleProbeVerdict | null;
}

export interface S11AAttentionScaleProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  semanticsOnly?: boolean;
  allowS11aAttentionForward?: boolean;
  confirmS11aAttentionForward?: boolean;
  allowStopNanoRuntime?: boolean;
  confirmStopNanoRuntime?: boolean;
  layerIndex?: number;
  nanoContainer?: string;
  gpuUuid?: string;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S11AAttentionScaleProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S11AAttentionScaleProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S11A_ATTENTION_SCALE_PROBE_FOREGROUND: "1" },
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
    child.on("close", (code) => {
      clearTimeout(timer);
      let verdict: S11AAttentionScaleProbeVerdict | null = null;
      try {
        const parsed = JSON.parse(stdout.trim().split("\n").slice(-1)[0] || stdout);
        if (parsed && typeof parsed.verdict === "string") {
          verdict = parsed.verdict as S11AAttentionScaleProbeVerdict;
        }
      } catch {
        const match = stdout.match(/"verdict"\s*:\s*"([^"]+)"/);
        if (match) {
          verdict = match[1] as S11AAttentionScaleProbeVerdict;
        }
      }
      resolve({
        launched: true,
        exit_code: timedOut ? null : code,
        timed_out: timedOut,
        stdout,
        stderr,
        verdict,
      });
    });
  });
}

export async function runS11AAttentionScaleProbe(
  options: S11AAttentionScaleProbeOptions = {},
): Promise<S11AAttentionScaleProbeChildResult> {
  const repoRoot = options.repoRoot ?? path.resolve(__dirname, "../../..");
  const script = path.join(repoRoot, "scripts/runtime/super-airllm/run-s11a-attention-scale-probe.sh");
  const args: string[] = [script];
  if (options.preflightOnly) args.push("--preflight-only");
  if (options.semanticsOnly) args.push("--semantics-only");
  if (options.allowS11aAttentionForward) args.push("--allow-s11a-attention-forward");
  if (options.confirmS11aAttentionForward) args.push("--confirm-s11a-attention-forward");
  if (options.allowStopNanoRuntime) args.push("--allow-stop-nano-runtime");
  if (options.confirmStopNanoRuntime) args.push("--confirm-stop-nano-runtime");
  if (options.layerIndex != null) args.push("--layer-index", String(options.layerIndex));
  if (options.nanoContainer) args.push("--nano-container", options.nanoContainer);
  if (options.gpuUuid) args.push("--gpu-uuid", options.gpuUuid);

  const runner = options.childRunner ?? defaultChildRunner;
  const timeoutMs = (options.timeoutSeconds ?? 3600) * 1000;
  return runner(args, { cwd: repoRoot, timeoutMs });
}
