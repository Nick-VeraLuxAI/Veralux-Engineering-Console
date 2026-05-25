import { spawn } from "child_process";
import path from "path";
import type { DeploymentProfileConfig } from "./deployment-execution-types";
import type { ControlledDeploymentExecResult } from "./deployment-execution-types";
import { DeploymentExecutionError } from "./deployment-execution-types";

export interface ControlledDeploymentExecutor {
  exec(
    profile: DeploymentProfileConfig,
  ): Promise<ControlledDeploymentExecResult>;
}

function runSpawn(profile: DeploymentProfileConfig): Promise<ControlledDeploymentExecResult> {
  const cwd = path.resolve(profile.workingDirectory);
  const timeoutMs = profile.timeoutMs ?? 300_000;

  return new Promise((resolve) => {
    const child = spawn(profile.command, profile.args, {
      cwd,
      shell: false,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout,
        stderr: timedOut ? `${stderr}\nExecution timed out.`.trim() : stderr,
        timedOut,
      });
    });
  });
}

let executorOverride: ControlledDeploymentExecutor | null = null;

export function setControlledDeploymentExecutorForTests(
  executor: ControlledDeploymentExecutor | null,
): void {
  executorOverride = executor;
}

export function getControlledDeploymentExecutor(): ControlledDeploymentExecutor {
  if (executorOverride) return executorOverride;
  return { exec: runSpawn };
}

export async function executeDeploymentProfile(
  profile: DeploymentProfileConfig,
): Promise<ControlledDeploymentExecResult> {
  if (!profile.allowed) {
    throw new DeploymentExecutionError(`Deployment profile is disabled: ${profile.name}`);
  }
  if (profile.strategy !== "fixed_command") {
    throw new DeploymentExecutionError(
      `Deployment profile strategy not executable: ${profile.strategy}`,
    );
  }
  return getControlledDeploymentExecutor().exec(profile);
}
