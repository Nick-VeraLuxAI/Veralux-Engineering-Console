import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { normalizeRelativePath } from "../worker-plan/path-safety";

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
