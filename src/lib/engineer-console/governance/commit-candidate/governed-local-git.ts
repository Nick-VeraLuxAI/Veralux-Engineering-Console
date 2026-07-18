import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { normalizeRelativePath } from "../../worker-plan/path-safety";

const execFileAsync = promisify(execFile);

export const GOVERNED_LOCAL_GIT_USES_SHELL = false as const;

const GIT_TIMEOUT_MS = 120_000;

export interface GovernedGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function isSafeRelativeRepoPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized || normalized.startsWith("..")) return false;
  if (path.isAbsolute(normalized)) return false;
  return true;
}

type GitArgCheck = (args: string[]) => boolean;

const LOCAL_COMMIT_GIT_ALLOWED: GitArgCheck[] = [
  (a) => a[0] === "status" && a.length === 2 && a[1] === "--porcelain",
  (a) => a[0] === "diff" && a.length === 2 && a[1] === "--name-only",
  (a) =>
    a[0] === "add" &&
    a.length === 3 &&
    a[1] === "--" &&
    isSafeRelativeRepoPath(a[2] ?? ""),
  (a) =>
    a[0] === "commit" &&
    a.length === 3 &&
    a[1] === "-m" &&
    typeof a[2] === "string" &&
    a[2].length > 0 &&
    !a[2].startsWith("-"),
  (a) => a[0] === "rev-parse" && a.length === 2 && a[1] === "HEAD",
];

const FORBIDDEN_GIT_SUBCOMMANDS = new Set([
  "push",
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
  "remote",
]);

export function assertGovernedLocalGitArgsAllowed(args: string[]): void {
  if (!args.length || FORBIDDEN_GIT_SUBCOMMANDS.has(args[0] ?? "")) {
    throw new Error(`Git command not allowed: git ${args.join(" ")}`);
  }
  const allowed = LOCAL_COMMIT_GIT_ALLOWED.some((check) => check(args));
  if (!allowed) {
    throw new Error(`Git command not allowed for local commit: git ${args.join(" ")}`);
  }
}

export async function runGovernedLocalGit(
  repoPath: string,
  args: string[],
): Promise<GovernedGitResult> {
  assertGovernedLocalGitArgsAllowed(args);
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
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number | string };
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(error),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

export function readCurrentBranchFromRepo(repoPath: string): string {
  const headPath = path.join(path.resolve(repoPath), ".git", "HEAD");
  const head = fs.readFileSync(headPath, "utf8").trim();
  if (head.startsWith("ref: refs/heads/")) {
    return head.slice("ref: refs/heads/".length);
  }
  return `detached:${head.slice(0, 12)}`;
}

/**
 * Resolve HEAD OID by reading `.git/HEAD` and the pointed-to ref file.
 * No git subprocess.
 */
export function readHeadShaFromRepo(repoPath: string): string | null {
  const gitDir = path.join(path.resolve(repoPath), ".git");
  const headPath = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headPath)) return null;
  const head = fs.readFileSync(headPath, "utf8").trim();
  if (head.startsWith("ref: ")) {
    const refPath = path.join(gitDir, head.slice("ref: ".length));
    if (!fs.existsSync(refPath)) return null;
    const sha = fs.readFileSync(refPath, "utf8").trim();
    return sha || null;
  }
  return /^[0-9a-f]{40}$/i.test(head) ? head : head || null;
}

export async function gitStatusPorcelain(repoPath: string): Promise<string> {
  const result = await runGovernedLocalGit(repoPath, ["status", "--porcelain"]);
  return result.stdout;
}

export async function gitAddFile(repoPath: string, relativePath: string): Promise<GovernedGitResult> {
  if (!isSafeRelativeRepoPath(relativePath)) {
    throw new Error(`Unsafe path for git add: ${relativePath}`);
  }
  return runGovernedLocalGit(repoPath, ["add", "--", relativePath]);
}

export async function gitCommit(repoPath: string, message: string): Promise<GovernedGitResult> {
  if (!message.trim() || message.startsWith("-")) {
    throw new Error("Invalid commit message for git commit");
  }
  return runGovernedLocalGit(repoPath, ["commit", "-m", message]);
}

export async function gitRevParseHead(repoPath: string): Promise<string> {
  const result = await runGovernedLocalGit(repoPath, ["rev-parse", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git rev-parse HEAD failed");
  }
  return result.stdout.trim();
}
