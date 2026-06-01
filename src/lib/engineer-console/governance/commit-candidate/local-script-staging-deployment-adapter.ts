import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  LOCAL_SCRIPT_STAGING_DEPLOY_RELATIVE_PATH,
  STAGING_DEPLOYMENT_TIMEOUT_MS,
} from "./staging-deployment-types";

const execFileAsync = promisify(execFile);

export const LOCAL_SCRIPT_STAGING_ADAPTER_USES_SHELL = false as const;

const FORBIDDEN_SCRIPT_SEGMENTS = [
  "deploy-local-production",
  "deploy-production",
  "production",
] as const;

export interface LocalScriptStagingDeploymentResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  scriptPath: string;
}

export interface ControlledLocalScriptStagingDeploymentAdapter {
  exec(repoPath: string, mergeCommitSha: string): Promise<LocalScriptStagingDeploymentResult>;
}

export function resolveLocalScriptStagingDeployPath(repoPath: string): string {
  return path.resolve(repoPath, LOCAL_SCRIPT_STAGING_DEPLOY_RELATIVE_PATH);
}

export function assertLocalScriptStagingDeployPathAllowed(scriptPath: string): void {
  const normalized = scriptPath.replace(/\\/g, "/").toLowerCase();
  if (!normalized.endsWith(`/${LOCAL_SCRIPT_STAGING_DEPLOY_RELATIVE_PATH}`)) {
    throw new Error("Staging deploy script path is not allowlisted");
  }
  for (const segment of FORBIDDEN_SCRIPT_SEGMENTS) {
    if (normalized.includes(segment)) {
      throw new Error("Forbidden staging deploy script path");
    }
  }
}

export function isLocalScriptStagingAdapterAvailable(repoPath: string): boolean {
  try {
    const scriptPath = resolveLocalScriptStagingDeployPath(repoPath);
    assertLocalScriptStagingDeployPathAllowed(scriptPath);
    return fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile();
  } catch {
    return false;
  }
}

async function runLocalScriptStagingDeploy(
  repoPath: string,
  mergeCommitSha: string,
): Promise<LocalScriptStagingDeploymentResult> {
  const cwd = path.resolve(repoPath);
  const scriptPath = resolveLocalScriptStagingDeployPath(cwd);
  assertLocalScriptStagingDeployPathAllowed(scriptPath);
  if (!fs.existsSync(scriptPath)) {
    throw new Error("Staging deploy script is not available");
  }

  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
      cwd,
      timeout: STAGING_DEPLOYMENT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      env: {
        ...process.env,
        ENGINEERING_CONSOLE_STAGING_MERGE_COMMIT_SHA: mergeCommitSha,
        ENGINEERING_CONSOLE_STAGING_TARGET_ENVIRONMENT: "staging",
      },
    });
    return {
      exitCode: 0,
      stdout: stdout?.toString() ?? "",
      stderr: stderr?.toString() ?? "",
      timedOut: false,
      scriptPath,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    const timedOut =
      err.killed === true && err.signal === "SIGTERM" && Date.now() - started >= STAGING_DEPLOYMENT_TIMEOUT_MS - 1000;
    return {
      exitCode: typeof err.code === "number" ? err.code : timedOut ? 124 : 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      timedOut,
      scriptPath,
    };
  }
}

let adapterOverride: ControlledLocalScriptStagingDeploymentAdapter | null = null;

export function setControlledLocalScriptStagingDeploymentAdapterForTests(
  adapter: ControlledLocalScriptStagingDeploymentAdapter | null,
): void {
  adapterOverride = adapter;
}

export function getControlledLocalScriptStagingDeploymentAdapter(): ControlledLocalScriptStagingDeploymentAdapter {
  if (adapterOverride) return adapterOverride;
  return { exec: runLocalScriptStagingDeploy };
}

export async function executeLocalScriptStagingDeployment(
  repoPath: string,
  mergeCommitSha: string,
): Promise<LocalScriptStagingDeploymentResult> {
  return getControlledLocalScriptStagingDeploymentAdapter().exec(repoPath, mergeCommitSha);
}
