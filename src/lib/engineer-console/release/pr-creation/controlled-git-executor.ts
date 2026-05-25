import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { PrCreationError } from "./pr-creation-types";

const execFileAsync = promisify(execFile);

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export interface ControlledGitExecutor {
  git(args: string[], repoPath: string): Promise<GitCommandResult>;
  gh(args: string[], repoPath: string): Promise<GitCommandResult>;
}

function isSafeGitRef(value: string): boolean {
  return /^(HEAD|refs\/heads\/[A-Za-z0-9._/-]+|refs\/remotes\/origin\/[A-Za-z0-9._/-]+)$/.test(value);
}

function isSafeCommitSha(value: string): boolean {
  return /^[a-f0-9]{7,64}$/i.test(value);
}

const GIT_ALLOWED_PREFIXES: Array<(args: string[]) => boolean> = [
  (a) => a[0] === "status" && a[1] === "--short",
  (a) => a[0] === "status" && a[1] === "--porcelain",
  (a) => a[0] === "diff" && a[1] === "--stat",
  (a) => a[0] === "add" && a.length >= 2 && a.every((x, i) => i === 0 || !x.startsWith("-")),
  (a) => a[0] === "commit" && a[1] === "-m" && a.length === 3,
  (a) => a[0] === "rev-parse" && a[1] === "HEAD",
  (a) => a[0] === "rev-parse" && a[1] === "--verify" && a.length === 3 && isSafeGitRef(a[2] ?? ""),
  (a) => a[0] === "checkout" && a.length === 2,
  (a) => a[0] === "branch" && a[1] === "--show-current",
  (a) => a[0] === "remote" && a[1] === "get-url" && a[2] === "origin",
  (a) => a[0] === "push" && a[1] === "-u" && a[2] === "origin" && a.length === 4,
  (a) =>
    a[0] === "merge-base" &&
    a[1] === "--is-ancestor" &&
    a.length === 4 &&
    isSafeCommitSha(a[2] ?? "") &&
    a[3] === "HEAD",
];

function assertGitArgsAllowed(args: string[]): void {
  const allowed = GIT_ALLOWED_PREFIXES.some((check) => check(args));
  if (!allowed) {
    throw new PrCreationError(`Git command not allowed: git ${args.join(" ")}`);
  }
}

function assertGhArgsAllowed(args: string[]): void {
  const subcommand = args[0] === "pr" ? args[1] : null;
  if (subcommand !== "create" && subcommand !== "list") {
    throw new PrCreationError(`gh command not allowed: gh ${args.join(" ")}`);
  }
  const forbidden = args.some((a) => a.includes(";") || a.includes("|") || a.includes("&"));
  if (forbidden) {
    throw new PrCreationError("Invalid characters in gh arguments.");
  }
  if (subcommand === "list") {
    const allowedFlags = new Set(["--head", "--base", "--state", "--json"]);
    for (let i = 2; i < args.length; i += 2) {
      const flag = args[i];
      const value = args[i + 1];
      if (!flag || !allowedFlags.has(flag) || value === undefined) {
        throw new PrCreationError(`gh command not allowed: gh ${args.join(" ")}`);
      }
    }
  }
}

async function defaultExec(
  bin: "git" | "gh",
  args: string[],
  repoPath: string,
): Promise<GitCommandResult> {
  const resolved = path.resolve(repoPath);
  if (bin === "git") {
    assertGitArgsAllowed(args);
    const { stdout, stderr } = await execFileAsync("git", ["-C", resolved, ...args], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  }
  assertGhArgsAllowed(args);
  const { stdout, stderr } = await execFileAsync("gh", args, {
    cwd: resolved,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

let executorOverride: ControlledGitExecutor | null = null;

export function setControlledGitExecutorForTests(executor: ControlledGitExecutor | null): void {
  executorOverride = executor;
}

export function getControlledGitExecutor(): ControlledGitExecutor {
  if (executorOverride) return executorOverride;
  return {
    git: (args, repoPath) => defaultExec("git", args, repoPath),
    gh: (args, repoPath) => defaultExec("gh", args, repoPath),
  };
}

export async function runGit(args: string[], repoPath: string): Promise<GitCommandResult> {
  return getControlledGitExecutor().git(args, repoPath);
}

export async function runGh(args: string[], repoPath: string): Promise<GitCommandResult> {
  return getControlledGitExecutor().gh(args, repoPath);
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await runGit(["branch", "--show-current"], repoPath);
  return stdout.trim();
}

export async function getRemoteOriginUrl(repoPath: string): Promise<string> {
  const { stdout } = await runGit(["remote", "get-url", "origin"], repoPath);
  return stdout.trim();
}

export async function getHeadCommitSha(repoPath: string): Promise<string> {
  const { stdout } = await runGit(["rev-parse", "HEAD"], repoPath);
  return stdout.trim();
}

export async function getRefCommitSha(repoPath: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(["rev-parse", "--verify", ref], repoPath);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isCommitReachableFromHead(
  repoPath: string,
  commitSha: string,
): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", commitSha, "HEAD"], repoPath);
    return true;
  } catch {
    return false;
  }
}
