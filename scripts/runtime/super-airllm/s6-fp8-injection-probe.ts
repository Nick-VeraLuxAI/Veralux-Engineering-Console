import { spawn } from "child_process";
import path from "path";

export type S6Fp8InjectionProbeVerdict =
  | "fp8_injection_preflight_ready"
  | "fp8_injection_preflight_blocked"
  | "fp8_injection_probe_ready"
  | "fp8_injection_probe_unsupported"
  | "fp8_injection_probe_failed"
  | "fp8_injection_probe_timeout"
  | "fp8_injection_probe_blocked"
  | "dry_run";

export interface S6Fp8InjectionProbeChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S6Fp8InjectionProbeVerdict | null;
}

export interface S6Fp8InjectionProbeOptions {
  repoRoot?: string;
  timeoutSeconds?: number;
  preflightOnly?: boolean;
  allowFp8InjectionProbe?: boolean;
  confirmFp8InjectionProbe?: boolean;
  layerIndex?: number;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S6Fp8InjectionProbeChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S6Fp8InjectionProbeChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, FP8_INJECTION_PROBE_FOREGROUND: "1" },
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
      let verdict: S6Fp8InjectionProbeVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S6Fp8InjectionProbeVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = timedOut ? "fp8_injection_probe_timeout" : null;
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

export async function runS6Fp8InjectionProbe(
  options: S6Fp8InjectionProbeOptions = {},
): Promise<S6Fp8InjectionProbeChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/runtime/super-airllm/run-fp8-injection-probe.sh");
  const command = [scriptPath];
  if (options.preflightOnly || !(options.allowFp8InjectionProbe && options.confirmFp8InjectionProbe)) {
    command.push("--preflight-only");
  } else {
    command.push("--allow-fp8-injection-probe", "--confirm-fp8-injection-probe");
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
