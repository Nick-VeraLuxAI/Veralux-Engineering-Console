import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Hermes post-apply gates never invoke a shell. */
export const HERMES_BOUNDED_COMMAND_USES_SHELL = false as const;

export interface BoundedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export async function runBoundedCommand(input: {
  cwd: string;
  executable: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<BoundedCommandResult> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(input.executable, input.args, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      env: { ...process.env, CI: "true", FORCE_COLOR: "0", ...input.env },
    });
    return {
      stdout: stdout?.toString() ?? "",
      stderr: stderr?.toString() ?? "",
      exitCode: 0,
      timedOut: false,
      durationMs: Date.now() - started,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    const timedOut = err.killed === true && err.signal === "SIGTERM";
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(error),
      exitCode: typeof err.code === "number" ? err.code : 1,
      timedOut,
      durationMs: Date.now() - started,
    };
  }
}
