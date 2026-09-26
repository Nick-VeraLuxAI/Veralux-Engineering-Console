import { spawn } from "child_process";
import path from "path";

export type S13LocalServiceVerdict =
  | "s13_local_service_ready_fake_quant"
  | "s13_local_service_ready_native_fp8"
  | "s13_baseline_commit_not_authorized"
  | "s13_runtime_verification_not_authorized"
  | "s13_local_service_blocked"
  | "s13_local_service_failed"
  | "s13_requests_passed_nano_restore_failed"
  | "s13_required_tests";

export interface S13ChildResult {
  launched: boolean;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  verdict: S13LocalServiceVerdict | null;
}

export interface S13Options {
  repoRoot?: string;
  timeoutSeconds?: number;
  runTestsOnly?: boolean;
  verify?: boolean;
  allowCreateS13BaselineCommit?: boolean;
  confirmCreateS13BaselineCommit?: boolean;
  allowS13RuntimeVerification?: boolean;
  confirmS13RuntimeVerification?: boolean;
  allowRequestTimeNanoInterruption?: boolean;
  confirmRequestTimeNanoInterruption?: boolean;
  allowDeliberateWorkerTermination?: boolean;
  confirmDeliberateWorkerTermination?: boolean;
  allowDeliberateServiceRestart?: boolean;
  confirmDeliberateServiceRestart?: boolean;
  nanoContainer?: string;
  gpuUuid?: string;
  skipTests?: boolean;
  childRunner?: (
    command: string[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<S13ChildResult>;
}

function defaultChildRunner(
  command: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<S13ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      env: { ...process.env, S13_LOCAL_SERVICE_FOREGROUND: "1" },
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
      let verdict: S13LocalServiceVerdict | null = null;
      try {
        const payload = JSON.parse(stdout) as { verdict?: S13LocalServiceVerdict };
        verdict = payload.verdict ?? null;
      } catch {
        verdict = null;
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

export async function runS13LocalService(options: S13Options = {}): Promise<S13ChildResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const scriptPath = path.join(repoRoot, "scripts/runtime/super-airllm/run-s13-local-service.sh");
  const command = [scriptPath];
  const childRunner = options.childRunner ?? defaultChildRunner;

  if (options.runTestsOnly) {
    command.push("--run-tests-only");
  } else if (options.allowCreateS13BaselineCommit || options.confirmCreateS13BaselineCommit) {
    if (options.allowCreateS13BaselineCommit) command.push("--allow-create-s13-baseline-commit");
    if (options.confirmCreateS13BaselineCommit) command.push("--confirm-create-s13-baseline-commit");
  } else if (options.verify) {
    command.push("--verify");
    if (options.allowS13RuntimeVerification) command.push("--allow-s13-runtime-verification");
    if (options.confirmS13RuntimeVerification) command.push("--confirm-s13-runtime-verification");
    if (options.allowRequestTimeNanoInterruption) command.push("--allow-request-time-nano-interruption");
    if (options.confirmRequestTimeNanoInterruption) command.push("--confirm-request-time-nano-interruption");
    if (options.allowDeliberateWorkerTermination) command.push("--allow-deliberate-worker-termination");
    if (options.confirmDeliberateWorkerTermination) command.push("--confirm-deliberate-worker-termination");
    if (options.allowDeliberateServiceRestart) command.push("--allow-deliberate-service-restart");
    if (options.confirmDeliberateServiceRestart) command.push("--confirm-deliberate-service-restart");
    if (options.skipTests) command.push("--skip-tests");
    if (options.nanoContainer) command.push("--nano-container", options.nanoContainer);
    if (options.gpuUuid) command.push("--gpu-uuid", options.gpuUuid);
  } else {
    command.push("--run-tests-only");
  }

  return childRunner(command, {
    cwd: repoRoot,
    timeoutMs: (options.timeoutSeconds ?? 28800) * 1000,
  });
}
