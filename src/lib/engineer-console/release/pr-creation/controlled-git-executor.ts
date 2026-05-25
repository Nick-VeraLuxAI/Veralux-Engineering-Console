import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { PrCreationError } from "./pr-creation-types";

const execFileAsync = promisify(execFile);
const MAX_GITHUB_PR_BRANCH_LENGTH = 255;
const MAX_GITHUB_PR_TITLE_LENGTH = 300;
const MAX_GITHUB_PR_BODY_LENGTH = 50_000;

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
  (a) =>
    a[0] === "log" &&
    a.length === 4 &&
    a[1] === "--format=%H%x1f%s" &&
    /^--max-count=\d+$/.test(a[2] ?? "") &&
    isSafeGitRef(a[3] ?? ""),
  (a) =>
    a[0] === "diff-tree" &&
    a.length === 5 &&
    a[1] === "--no-commit-id" &&
    a[2] === "--name-only" &&
    a[3] === "-r" &&
    isSafeCommitSha(a[4] ?? ""),
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
    isSafeGitRef(a[3] ?? ""),
];

function assertGitArgsAllowed(args: string[]): void {
  const allowed = GIT_ALLOWED_PREFIXES.some((check) => check(args));
  if (!allowed) {
    throw new PrCreationError(`Git command not allowed: git ${args.join(" ")}`);
  }
}

function assertGitHubTextValue(
  value: unknown,
  label: "title" | "body",
  options: { maxLength: number; allowNewlines?: boolean; allowTabs?: boolean },
): asserts value is string {
  if (typeof value !== "string") {
    throw new PrCreationError(`Invalid GitHub PR ${label}: must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: value is required.`);
  }
  if (value.length > options.maxLength) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: exceeds maximum length.`);
  }
  if (value.includes("\0")) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: contains NUL bytes.`);
  }

  for (const char of value) {
    const code = char.charCodeAt(0);
    const isAllowedNewline = options.allowNewlines && (code === 10 || code === 13);
    const isAllowedTab = options.allowTabs && code === 9;
    if ((code < 32 || code === 127) && !isAllowedNewline && !isAllowedTab) {
      throw new PrCreationError(`Invalid GitHub PR ${label}: contains control characters.`);
    }
  }
}

async function assertGitHubBranchValue(
  value: unknown,
  label: "branch" | "base branch",
): Promise<void> {
  if (typeof value !== "string") {
    throw new PrCreationError(`Invalid GitHub PR ${label}: must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: value is required.`);
  }
  if (value !== value.trim()) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: must not contain leading or trailing whitespace.`);
  }
  if (value.length > MAX_GITHUB_PR_BRANCH_LENGTH) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: exceeds maximum length.`);
  }
  if (value.includes("\0")) {
    throw new PrCreationError(`Invalid GitHub PR ${label}: contains NUL bytes.`);
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) {
      throw new PrCreationError(`Invalid GitHub PR ${label}: contains control characters.`);
    }
  }

  try {
    await execFileAsync("git", ["check-ref-format", "--branch", value], {
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new PrCreationError(`Invalid GitHub PR ${label}: not a valid git branch name.`);
  }
}

function assertExactGhValue(value: unknown, expected: string, label: string): void {
  if (typeof value !== "string" || value !== expected) {
    throw new PrCreationError(`GitHub CLI ${label} is not allowed.`);
  }
}

function assertGhArgsAreStrings(args: readonly unknown[]): asserts args is string[] {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new PrCreationError("GitHub CLI arguments must be strings.");
  }
}

async function assertGhPrListArgsAllowed(args: string[]): Promise<void> {
  if (
    args.length !== 10 ||
    args[0] !== "pr" ||
    args[1] !== "list" ||
    args[2] !== "--head" ||
    args[4] !== "--base" ||
    args[6] !== "--state" ||
    args[8] !== "--json"
  ) {
    throw new PrCreationError("GitHub CLI PR list command shape not allowed.");
  }
  await assertGitHubBranchValue(args[3], "branch");
  await assertGitHubBranchValue(args[5], "base branch");
  assertExactGhValue(args[7], "all", "PR list state");
  assertExactGhValue(args[9], "number,url", "PR list JSON fields");
}

async function assertGhPrCreateArgsAllowed(args: string[]): Promise<void> {
  const hasDraftFlag = args.length === 11 && args[10] === "--draft";
  if (
    !(args.length === 10 || hasDraftFlag) ||
    args[0] !== "pr" ||
    args[1] !== "create" ||
    args[2] !== "--title" ||
    args[4] !== "--body" ||
    args[6] !== "--base" ||
    args[8] !== "--head"
  ) {
    throw new PrCreationError("GitHub CLI PR create command shape not allowed.");
  }
  assertGitHubTextValue(args[3], "title", { maxLength: MAX_GITHUB_PR_TITLE_LENGTH });
  assertGitHubTextValue(args[5], "body", {
    maxLength: MAX_GITHUB_PR_BODY_LENGTH,
    allowNewlines: true,
    allowTabs: true,
  });
  await assertGitHubBranchValue(args[7], "base branch");
  await assertGitHubBranchValue(args[9], "branch");
}

export async function assertGhArgsAllowed(args: readonly unknown[]): Promise<void> {
  assertGhArgsAreStrings(args);
  const subcommand = args[0] === "pr" ? args[1] : null;
  if (subcommand === "create") {
    await assertGhPrCreateArgsAllowed(args);
    return;
  }
  if (subcommand === "list") {
    await assertGhPrListArgsAllowed(args);
    return;
  }
  throw new PrCreationError("GitHub CLI command not allowed.");
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
  await assertGhArgsAllowed(args);
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

export function getLocalBranchRef(branchName: string): string {
  return `refs/heads/${branchName}`;
}

export function getRemoteBranchRef(branchName: string): string {
  return `refs/remotes/origin/${branchName}`;
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
  return isCommitReachableFromRef(repoPath, commitSha, "HEAD");
}

export async function isCommitReachableFromRef(
  repoPath: string,
  commitSha: string,
  ref: string,
): Promise<boolean> {
  try {
    await runGit(["merge-base", "--is-ancestor", commitSha, ref], repoPath);
    return true;
  } catch {
    return false;
  }
}

export async function listCommitsOnRef(
  repoPath: string,
  ref: string,
  maxCount = 50,
): Promise<Array<{ sha: string; subject: string }>> {
  const { stdout } = await runGit(["log", "--format=%H%x1f%s", `--max-count=${maxCount}`, ref], repoPath);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\x1f");
      return { sha: sha.trim(), subject: subject.trim() };
    })
    .filter((entry) => entry.sha.length > 0);
}

export async function getCommitChangedFiles(repoPath: string, commitSha: string): Promise<string[]> {
  const { stdout } = await runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha], repoPath);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
