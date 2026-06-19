import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface WorkspaceGitResult {
  stdout: string;
  stderr: string;
}

export class WorkspaceGitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceGitError";
    this.code = code;
  }
}

function assertNoControlChars(value: string, label: string): void {
  if (!value || value.includes("\0") || /[\r\n\t]/.test(value)) {
    throw new WorkspaceGitError("INVALID_GIT_ARGUMENT", `${label} contains invalid characters.`);
  }
}

export function sanitizeGitRefSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function assertSafeBranchName(branchName: string, protectedBranches: string[] = []): void {
  assertNoControlChars(branchName, "branch name");
  if (branchName.startsWith("-") || branchName.includes("..") || branchName.endsWith(".lock")) {
    throw new WorkspaceGitError("INVALID_BRANCH_NAME", "Branch name is not safe.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branchName)) {
    throw new WorkspaceGitError("INVALID_BRANCH_NAME", "Branch name contains unsupported characters.");
  }
  if (protectedBranches.includes(branchName) || protectedBranches.some((entry) => branchName === entry)) {
    throw new WorkspaceGitError("PROTECTED_BRANCH", `Protected branch cannot be modified: ${branchName}`);
  }
}

export function assertInside(parent: string, child: string): string {
  const resolvedParent = fs.realpathSync.native(path.resolve(parent));
  const resolvedChild = path.resolve(child);
  const existingChild = fs.existsSync(resolvedChild)
    ? fs.realpathSync.native(resolvedChild)
    : resolvedChild;
  if (existingChild !== resolvedParent && !existingChild.startsWith(resolvedParent + path.sep)) {
    throw new WorkspaceGitError("PATH_OUTSIDE_BOUNDARY", `${existingChild} is outside ${resolvedParent}`);
  }
  return existingChild;
}

export async function runWorkspaceGit(
  repoPath: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<WorkspaceGitResult> {
  const resolved = path.resolve(repoPath);
  for (const arg of args) assertNoControlChars(arg, "git argument");
  const denied = ["reset", "push", "clean", "rebase", "filter-branch"];
  if (denied.includes(args[0] ?? "")) {
    throw new WorkspaceGitError("GIT_COMMAND_DENIED", `git ${args[0]} is denied for workspaces.`);
  }
  const { stdout, stderr } = await execFileAsync("git", ["-C", resolved, ...args], {
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function getRepoRoot(repoPath: string): Promise<string> {
  const { stdout } = await runWorkspaceGit(repoPath, ["rev-parse", "--show-toplevel"]);
  return path.resolve(stdout);
}

export async function getHeadCommit(repoPath: string): Promise<string> {
  const { stdout } = await runWorkspaceGit(repoPath, ["rev-parse", "HEAD"]);
  return stdout;
}

export async function getCurrentBranchName(repoPath: string): Promise<string> {
  const { stdout } = await runWorkspaceGit(repoPath, ["branch", "--show-current"]);
  return stdout || "HEAD";
}

export async function getTreeHash(repoPath: string, ref = "HEAD"): Promise<string> {
  const { stdout } = await runWorkspaceGit(repoPath, ["rev-parse", `${ref}^{tree}`]);
  return stdout;
}

export async function getPatchHash(repoPath: string, baseCommit: string, candidateCommit: string): Promise<string> {
  const { stdout } = await runWorkspaceGit(repoPath, ["diff", "--binary", baseCommit, candidateCommit]);
  const { createHash } = await import("crypto");
  return createHash("sha256").update(stdout, "utf8").digest("hex");
}

export async function getChangedFilesBetween(
  repoPath: string,
  baseCommit: string,
  candidateCommit = "HEAD",
): Promise<string[]> {
  const { stdout } = await runWorkspaceGit(repoPath, ["diff", "--name-only", baseCommit, candidateCommit]);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
}

export async function createBranchWorktree(input: {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  workspaceRoot: string;
  protectedBranches: string[];
}): Promise<void> {
  assertSafeBranchName(input.branchName, input.protectedBranches);
  const workspaceParent = path.dirname(input.worktreePath);
  fs.mkdirSync(workspaceParent, { recursive: true });
  assertInside(input.workspaceRoot, workspaceParent);
  if (fs.existsSync(input.worktreePath)) return;
  await runWorkspaceGit(input.repoPath, [
    "worktree",
    "add",
    "-b",
    input.branchName,
    input.worktreePath,
    input.baseCommit,
  ]);
}

export async function createDetachedWorktree(input: {
  repoPath: string;
  worktreePath: string;
  commit: string;
  workspaceRoot: string;
}): Promise<void> {
  const workspaceParent = path.dirname(input.worktreePath);
  fs.mkdirSync(workspaceParent, { recursive: true });
  assertInside(input.workspaceRoot, workspaceParent);
  if (fs.existsSync(input.worktreePath)) return;
  await runWorkspaceGit(input.repoPath, ["worktree", "add", "--detach", input.worktreePath, input.commit]);
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  if (!fs.existsSync(worktreePath)) return;
  await runWorkspaceGit(repoPath, ["worktree", "remove", worktreePath]);
}

export async function commitAll(input: {
  worktreePath: string;
  message: string;
}): Promise<string> {
  await runWorkspaceGit(input.worktreePath, ["add", "--all"]);
  await runWorkspaceGit(input.worktreePath, ["commit", "-m", input.message]);
  return getHeadCommit(input.worktreePath);
}

export async function cherryPick(input: {
  worktreePath: string;
  candidateCommit: string;
}): Promise<{ ok: boolean; conflictSummary: string | null }> {
  try {
    await runWorkspaceGit(input.worktreePath, ["cherry-pick", "--no-commit", input.candidateCommit]);
    return { ok: true, conflictSummary: null };
  } catch (error) {
    const status = await runWorkspaceGit(input.worktreePath, ["status", "--porcelain"]).catch((err) => ({
      stdout: err instanceof Error ? err.message : String(err),
      stderr: "",
    }));
    return { ok: false, conflictSummary: status.stdout || String(error) };
  }
}
