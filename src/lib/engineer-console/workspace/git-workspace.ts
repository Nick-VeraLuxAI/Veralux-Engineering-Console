import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { normalizeRelativePath } from "../worker-plan/path-safety";
import { isWorktreeInfrastructurePath } from "./worktree-path-policy";

const execFileAsync = promisify(execFile);

export class GitWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitWorkspaceError";
  }
}

export interface GitPorcelainEntry {
  indexStatus: string;
  workTreeStatus: string;
  path: string;
  isUntracked: boolean;
  isIgnored: boolean;
}

export interface GetChangedFilesOptions {
  /**
   * When set (worker-plan runs), only untracked porcelain paths in this list are included.
   * Tracked modifications and deletions are always included. Paths are also merged when
   * they exist on disk (covers gitignored worker-plan outputs).
   */
  workerPlanPaths?: string[];
}

export function parseGitPorcelainLine(line: string): GitPorcelainEntry | null {
  const trimmed = line.trimEnd();
  if (trimmed.length < 4) return null;
  if (trimmed[2] !== " ") return null;

  const indexStatus = trimmed[0] ?? " ";
  const workTreeStatus = trimmed[1] ?? " ";
  let filePart = trimmed.slice(3).trim();
  if (!filePart) return null;

  if (filePart.includes(" -> ")) {
    filePart = filePart.split(" -> ").pop()!.trim();
  }

  const isUntracked = indexStatus === "?" && workTreeStatus === "?";
  const isIgnored = indexStatus === "!" && workTreeStatus === "!";

  return {
    indexStatus,
    workTreeStatus,
    path: filePart,
    isUntracked,
    isIgnored,
  };
}

function isPathWithinRepo(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized.includes("..")) return false;
  return true;
}

export async function listGitPorcelainEntries(repoPath: string): Promise<GitPorcelainEntry[]> {
  const resolved = path.resolve(repoPath);
  const { stdout } = await execFileAsync(
    "git",
    ["-C", resolved, "status", "--porcelain", "-uall"],
    { maxBuffer: 1024 * 1024 },
  );

  const entries: GitPorcelainEntry[] = [];
  for (const line of stdout.split("\n")) {
    const entry = parseGitPorcelainLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

export async function verifyGitRepo(repoPath: string): Promise<void> {
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved)) {
    throw new GitWorkspaceError(`Repository path does not exist: ${resolved}`);
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", resolved, "rev-parse", "--git-dir"], {
      maxBuffer: 1024 * 1024,
    });
    if (!stdout.trim()) {
      throw new GitWorkspaceError(`Path is not a git repository: ${resolved}`);
    }
  } catch {
    throw new GitWorkspaceError(`Path is not a git repository: ${resolved}`);
  }
}

export function generateBranchName(taskId: string, runId: string): string {
  const shortTask = taskId.replace(/-/g, "").slice(0, 8);
  const shortRun = runId.replace(/-/g, "").slice(0, 8);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `engineer/${shortTask}/${shortRun}-${timestamp}`;
}

export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  const resolved = path.resolve(repoPath);
  await execFileAsync("git", ["-C", resolved, "checkout", "-b", branchName], {
    maxBuffer: 1024 * 1024,
  });
}

export async function checkoutBranch(repoPath: string, branchName: string): Promise<void> {
  const resolved = path.resolve(repoPath);
  await execFileAsync("git", ["-C", resolved, "checkout", branchName], {
    maxBuffer: 1024 * 1024,
  });
}

export async function getGitStatus(repoPath: string): Promise<string> {
  const resolved = path.resolve(repoPath);
  const { stdout } = await execFileAsync("git", ["-C", resolved, "status", "--short"], {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

export async function getChangedFiles(
  repoPath: string,
  options: GetChangedFilesOptions = {},
): Promise<string[]> {
  const resolved = path.resolve(repoPath);
  const entries = await listGitPorcelainEntries(resolved);
  const workerPlanPaths = options.workerPlanPaths?.map((p) => normalizeRelativePath(p)) ?? null;
  const workerSet = workerPlanPaths ? new Set(workerPlanPaths) : null;
  const files = new Set<string>();

  for (const entry of entries) {
    if (entry.isIgnored) continue;
    const normalized = normalizeRelativePath(entry.path);
    if (!isPathWithinRepo(normalized)) continue;
    if (isWorktreeInfrastructurePath(normalized)) continue;

    if (entry.isUntracked) {
      if (workerSet) {
        if (workerSet.has(normalized)) files.add(normalized);
      } else {
        files.add(normalized);
      }
      continue;
    }

    files.add(normalized);
  }

  if (workerSet) {
    for (const relativePath of workerSet) {
      if (!isPathWithinRepo(relativePath)) continue;
      const absolutePath = path.resolve(resolved, relativePath);
      if (
        absolutePath !== resolved &&
        !absolutePath.startsWith(resolved + path.sep)
      ) {
        continue;
      }
      try {
        if (fs.existsSync(absolutePath)) {
          files.add(relativePath);
        }
      } catch {
        // skip unreadable paths
      }
    }
  }

  return [...files].sort();
}

function countFileLines(absolutePath: string): number | null {
  try {
    const content = fs.readFileSync(absolutePath, "utf8");
    if (!content) return 0;
    return content.split("\n").length;
  } catch {
    return null;
  }
}

function buildWorkingTreeDiffSummary(
  repoPath: string,
  changedFiles: string[],
  maxLines: number,
): string {
  const resolved = path.resolve(repoPath);
  const lines: string[] = ["Working tree changes not yet in HEAD:"];

  for (const file of changedFiles) {
    const absolutePath = path.join(resolved, file);
    let suffix = "";
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.isFile()) {
        const lineCount = countFileLines(absolutePath);
        suffix = lineCount === null ? "" : ` | ${lineCount} lines`;
      } else if (stat.isDirectory()) {
        suffix = " | directory";
      }
    } catch {
      suffix = "";
    }
    lines.push(` ${file}${suffix}`);
  }

  const body = lines.join("\n");
  if (lines.length <= maxLines) {
    return body;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`;
}

function truncateDiffSummary(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`;
}

export async function getDiffSummary(
  repoPath: string,
  options: { changedFiles?: string[]; maxLines?: number } = {},
): Promise<string> {
  const resolved = path.resolve(repoPath);
  const maxLines = options.maxLines ?? 200;

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolved, "diff", "--stat", "HEAD"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (trimmed) {
      return truncateDiffSummary(trimmed, maxLines);
    }
  } catch {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", resolved, "diff", "--stat"],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      const trimmed = stdout.trim();
      if (trimmed) {
        return truncateDiffSummary(trimmed, maxLines);
      }
    } catch {
      // fall through to working-tree summary
    }
  }

  const changedFiles =
    options.changedFiles ?? (await getChangedFiles(resolved));
  if (changedFiles.length > 0) {
    return buildWorkingTreeDiffSummary(resolved, changedFiles, maxLines);
  }

  return "No diff against HEAD (working tree clean).";
}

export async function getHeadRevision(repoPath: string): Promise<string> {
  const resolved = path.resolve(repoPath);
  const { stdout } = await execFileAsync("git", ["-C", resolved, "rev-parse", "HEAD"], {
    maxBuffer: 64 * 1024,
  });
  const rev = stdout.trim();
  if (!rev) {
    throw new GitWorkspaceError(`Unable to resolve HEAD for ${resolved}`);
  }
  return rev;
}

const EMPTY_REPO_BASELINE_MESSAGE = "Initial repository baseline for Engineer Console runs.";

/** True when the git repo exists but has no commits yet (unborn HEAD). */
export async function hasHeadRevision(repoPath: string): Promise<boolean> {
  try {
    await getHeadRevision(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Isolated worktrees need a commit SHA. Empty repos have no HEAD.
 * Create a local empty baseline commit so any new repo can start a run.
 * Does not add untracked files.
 */
export async function ensureHeadRevision(repoPath: string): Promise<string> {
  try {
    return await getHeadRevision(repoPath);
  } catch {
    // unborn HEAD — fall through to baseline commit
  }

  const resolved = path.resolve(repoPath);
  try {
    await execFileAsync(
      "git",
      ["-C", resolved, "commit", "--allow-empty", "-m", EMPTY_REPO_BASELINE_MESSAGE],
      {
        maxBuffer: 64 * 1024,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Engineer Console",
          GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "engineer-console@local",
          GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Engineer Console",
          GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "engineer-console@local",
        },
      },
    );
  } catch {
    throw new GitWorkspaceError(
      "This git repository has no commits yet, and the console could not create a baseline commit for an isolated run.",
    );
  }

  return getHeadRevision(resolved);
}

/**
 * After copying uncommitted host scaffold into a worktree, commit those paths
 * so getChangedFiles / scope review only see AE mutations — not the seed itself.
 */
export async function commitSeededScaffoldBaseline(
  worktreePath: string,
  seededRelativePaths: string[],
): Promise<string | null> {
  if (seededRelativePaths.length === 0) return null;
  const resolved = path.resolve(worktreePath);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Engineer Console",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "engineer-console@local",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Engineer Console",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "engineer-console@local",
  };
  try {
    await execFileAsync("git", ["-C", resolved, "add", "--", ...seededRelativePaths], {
      maxBuffer: 8 * 1024 * 1024,
      env,
    });
    const { stdout: status } = await execFileAsync(
      "git",
      ["-C", resolved, "status", "--porcelain"],
      { maxBuffer: 2 * 1024 * 1024, env },
    );
    if (!status.trim()) return null;
    await execFileAsync(
      "git",
      [
        "-C",
        resolved,
        "commit",
        "-m",
        "ae: seed host scaffold baseline for isolated run",
      ],
      { maxBuffer: 2 * 1024 * 1024, env },
    );
    return await getHeadRevision(resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitWorkspaceError(
      `Failed to commit seeded scaffold baseline in ${resolved}: ${message}`,
    );
  }
}

export async function getGitLog(repoPath: string, maxEntries = 20): Promise<string> {
  const resolved = path.resolve(repoPath);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolved, "log", "-n", String(maxEntries), "--oneline"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function addGitWorktree(input: {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseRevision: string;
}): Promise<void> {
  const repo = path.resolve(input.repoPath);
  const worktree = path.resolve(input.worktreePath);
  await execFileAsync(
    "git",
    ["-C", repo, "worktree", "add", "-b", input.branchName, worktree, input.baseRevision],
    { maxBuffer: 1024 * 1024 },
  );
}

export async function removeGitWorktree(input: {
  repoPath: string;
  worktreePath: string;
  force?: boolean;
}): Promise<void> {
  const repo = path.resolve(input.repoPath);
  const worktree = path.resolve(input.worktreePath);
  const args = ["-C", repo, "worktree", "remove", worktree];
  if (input.force) args.push("--force");
  await execFileAsync("git", args, { maxBuffer: 1024 * 1024 });
}
