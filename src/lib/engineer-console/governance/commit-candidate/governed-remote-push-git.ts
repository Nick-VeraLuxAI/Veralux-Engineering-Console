import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { validateCommitCandidateBranchName } from "./branch-name";

const execFileAsync = promisify(execFile);

export const GOVERNED_REMOTE_PUSH_GIT_USES_SHELL = false as const;

const GIT_TIMEOUT_MS = 120_000;

const ALLOWED_REMOTE_NAMES = new Set(["origin"]);

export interface GovernedRemotePushGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type GitArgCheck = (args: string[]) => boolean;

function isSafeRemoteName(remote: string): boolean {
  return ALLOWED_REMOTE_NAMES.has(remote);
}

function isPushRefSpec(refSpec: string): boolean {
  if (!refSpec.startsWith("HEAD:refs/heads/")) return false;
  const branch = refSpec.slice("HEAD:refs/heads/".length);
  if (!branch || branch.includes("..") || branch.startsWith("-")) return false;
  try {
    validateCommitCandidateBranchName(branch);
    return true;
  } catch {
    return false;
  }
}

const REMOTE_PUSH_GIT_ALLOWED: GitArgCheck[] = [
  (a) => a[0] === "status" && a.length === 2 && a[1] === "--porcelain",
  (a) => a[0] === "rev-parse" && a.length === 2 && a[1] === "HEAD",
  (a) => a[0] === "rev-parse" && a.length === 3 && a[1] === "--abbrev-ref" && a[2] === "HEAD",
  (a) => a[0] === "remote" && a.length === 1,
  (a) =>
    a[0] === "push" &&
    a.length === 3 &&
    isSafeRemoteName(a[1] ?? "") &&
    isPushRefSpec(a[2] ?? "") &&
    !a.some((arg) => arg.startsWith("-")),
];

const FORBIDDEN_GIT_SUBCOMMANDS = new Set([
  "merge",
  "pull",
  "fetch",
  "checkout",
  "switch",
  "branch",
  "clean",
  "reset",
  "rebase",
  "cherry-pick",
  "stash",
  "tag",
  "add",
  "commit",
]);

export function assertGovernedRemotePushGitArgsAllowed(args: string[]): void {
  if (!args.length || FORBIDDEN_GIT_SUBCOMMANDS.has(args[0] ?? "")) {
    throw new Error(`Git command not allowed: git ${args.join(" ")}`);
  }
  if (args[0] === "push") {
    if (args.some((arg) => arg === "--force" || arg === "-f" || arg === "--mirror" || arg === "--delete")) {
      throw new Error("Force or destructive git push is not allowed");
    }
  }
  const allowed = REMOTE_PUSH_GIT_ALLOWED.some((check) => check(args));
  if (!allowed) {
    throw new Error(`Git command not allowed for remote push: git ${args.join(" ")}`);
  }
}

export function validateGovernedRemoteName(remoteName: string): string {
  const remote = remoteName?.trim();
  if (!remote || !isSafeRemoteName(remote)) {
    throw new Error(`Remote "${remoteName}" is not allowed; use origin`);
  }
  return remote;
}

export function validateGovernedPushBranchName(branchName: string): string {
  const branch = branchName?.trim();
  if (!branch) {
    throw new Error("Branch name is required");
  }
  validateCommitCandidateBranchName(branch);
  return branch;
}

export async function runGovernedRemotePushGit(
  repoPath: string,
  args: string[],
): Promise<GovernedRemotePushGitResult> {
  assertGovernedRemotePushGitArgsAllowed(args);
  const cwd = path.resolve(repoPath);
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    });
    return { stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: 0 };
  } catch (error: unknown) {
    const err = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      code?: number | string;
    };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

export async function gitRemoteList(repoPath: string): Promise<string[]> {
  const result = await runGovernedRemotePushGit(repoPath, ["remote"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git remote failed");
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function gitRevParseHeadForPush(repoPath: string): Promise<string> {
  const result = await runGovernedRemotePushGit(repoPath, ["rev-parse", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git rev-parse HEAD failed");
  }
  return result.stdout.trim();
}

export async function gitRevParseAbbrevRefHead(repoPath: string): Promise<string> {
  const result = await runGovernedRemotePushGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git rev-parse --abbrev-ref HEAD failed");
  }
  return result.stdout.trim();
}

export async function gitStatusPorcelainForPush(repoPath: string): Promise<string> {
  const result = await runGovernedRemotePushGit(repoPath, ["status", "--porcelain"]);
  return result.stdout;
}

export async function gitPushHeadToRemoteBranch(
  repoPath: string,
  remoteName: string,
  branchName: string,
): Promise<GovernedRemotePushGitResult> {
  const remote = validateGovernedRemoteName(remoteName);
  const branch = validateGovernedPushBranchName(branchName);
  const refSpec = `HEAD:refs/heads/${branch}`;
  return runGovernedRemotePushGit(repoPath, ["push", remote, refSpec]);
}
