import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export class GitWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitWorkspaceError";
  }
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

export async function getChangedFiles(repoPath: string): Promise<string[]> {
  const resolved = path.resolve(repoPath);
  const { stdout } = await execFileAsync(
    "git",
    ["-C", resolved, "status", "--porcelain", "-uall"],
    { maxBuffer: 1024 * 1024 },
  );

  const files = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const filePart = line.slice(3).trim();
    const normalized = filePart.includes(" -> ")
      ? filePart.split(" -> ").pop()!.trim()
      : filePart;
    files.add(normalized);
  }
  return [...files].sort();
}

export async function getDiffSummary(repoPath: string, maxLines = 200): Promise<string> {
  const resolved = path.resolve(repoPath);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolved, "diff", "--stat", "HEAD"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) {
      return "No diff against HEAD (working tree may be clean or only untracked files).";
    }
    const lines = trimmed.split("\n");
    if (lines.length <= maxLines) {
      return trimmed;
    }
    return `${lines.slice(0, maxLines).join("\n")}\n… (${lines.length - maxLines} more lines)`;
  } catch {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolved, "diff", "--stat"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout.trim() || "No diff available.";
  }
}
