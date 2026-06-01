import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const GOVERNED_POST_MERGE_GIT_USES_SHELL = false as const;

const GIT_TIMEOUT_MS = 60_000;

export interface GovernedPostMergeGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const POST_MERGE_GIT_ALLOWED: Array<(args: string[]) => boolean> = [
  (a) => a[0] === "status" && a.length === 2 && a[1] === "--porcelain",
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
  "add",
  "commit",
]);

export function assertGovernedPostMergeGitArgsAllowed(args: string[]): void {
  if (!args.length || FORBIDDEN_GIT_SUBCOMMANDS.has(args[0] ?? "")) {
    throw new Error(`Git command not allowed: git ${args.join(" ")}`);
  }
  const allowed = POST_MERGE_GIT_ALLOWED.some((check) => check(args));
  if (!allowed) {
    throw new Error(`Git command not allowed for post-merge verification: git ${args.join(" ")}`);
  }
}

export async function runGovernedPostMergeGit(
  repoPath: string,
  args: string[],
): Promise<GovernedPostMergeGitResult> {
  assertGovernedPostMergeGitArgsAllowed(args);
  const cwd = path.resolve(repoPath);
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
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

export async function readGovernedRepoHeadSha(repoPath: string): Promise<string> {
  const result = await runGovernedPostMergeGit(repoPath, ["rev-parse", "HEAD"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git rev-parse HEAD failed");
  }
  return result.stdout.trim();
}

export async function readGovernedRepoPorcelainStatus(repoPath: string): Promise<string> {
  const result = await runGovernedPostMergeGit(repoPath, ["status", "--porcelain"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git status --porcelain failed");
  }
  return result.stdout.trim();
}
