import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  LOCAL_SCRIPT_PRODUCTION_DEPLOY_RELATIVE_PATH,
  PRODUCTION_DEPLOYMENT_TIMEOUT_MS,
} from "./production-deployment-types";

const execFileAsync = promisify(execFile);

export const LOCAL_SCRIPT_PRODUCTION_ADAPTER_USES_SHELL = false as const;

const FORBIDDEN_SCRIPT_SEGMENTS = [
  "deploy-staging",
  "deploy-local-production",
  "staging",
] as const;

export interface LocalScriptProductionDeploymentResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  scriptPath: string;
}

export interface ControlledLocalScriptProductionDeploymentAdapter {
  exec(repoPath: string, mergeCommitSha: string): Promise<LocalScriptProductionDeploymentResult>;
}

export function resolveLocalScriptProductionDeployPath(repoPath: string): string {
  return path.resolve(repoPath, LOCAL_SCRIPT_PRODUCTION_DEPLOY_RELATIVE_PATH);
}

export function assertLocalScriptProductionDeployPathAllowed(scriptPath: string): void {
  const normalized = scriptPath.replace(/\\/g, "/").toLowerCase();
  if (!normalized.endsWith(`/${LOCAL_SCRIPT_PRODUCTION_DEPLOY_RELATIVE_PATH}`)) {
    throw new Error("Production deploy script path is not allowlisted");
  }
  for (const segment of FORBIDDEN_SCRIPT_SEGMENTS) {
    if (normalized.includes(segment)) {
      throw new Error("Forbidden production deploy script path");
    }
  }
}

export function isLocalScriptProductionAdapterAvailable(repoPath: string): boolean {
  try {
    const scriptPath = resolveLocalScriptProductionDeployPath(repoPath);
    assertLocalScriptProductionDeployPathAllowed(scriptPath);
    return fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile();
  } catch {
    return false;
  }
}

async function runLocalScriptProductionDeploy(
  repoPath: string,
  mergeCommitSha: string,
): Promise<LocalScriptProductionDeploymentResult> {
  const cwd = path.resolve(repoPath);
  const scriptPath = resolveLocalScriptProductionDeployPath(cwd);
  assertLocalScriptProductionDeployPathAllowed(scriptPath);
  if (!fs.existsSync(scriptPath)) {
    throw new Error("Production deploy script is not available");
  }

  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath], {
      cwd,
      timeout: PRODUCTION_DEPLOYMENT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      env: {
        ...process.env,
        ENGINEERING_CONSOLE_PRODUCTION_MERGE_COMMIT_SHA: mergeCommitSha,
        ENGINEERING_CONSOLE_PRODUCTION_TARGET_ENVIRONMENT: "production",
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
      err.killed === true &&
      err.signal === "SIGTERM" &&
      Date.now() - started >= PRODUCTION_DEPLOYMENT_TIMEOUT_MS - 1000;
    return {
      exitCode: typeof err.code === "number" ? err.code : timedOut ? 124 : 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      timedOut,
      scriptPath,
    };
  }
}

let adapterOverride: ControlledLocalScriptProductionDeploymentAdapter | null = null;

export function setControlledLocalScriptProductionDeploymentAdapterForTests(
  adapter: ControlledLocalScriptProductionDeploymentAdapter | null,
): void {
  adapterOverride = adapter;
}

export function getControlledLocalScriptProductionDeploymentAdapter(): ControlledLocalScriptProductionDeploymentAdapter {
  if (adapterOverride) return adapterOverride;
  return { exec: runLocalScriptProductionDeploy };
}

export async function executeLocalScriptProductionDeployment(
  repoPath: string,
  mergeCommitSha: string,
): Promise<LocalScriptProductionDeploymentResult> {
  return getControlledLocalScriptProductionDeploymentAdapter().exec(repoPath, mergeCommitSha);
}
