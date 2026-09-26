import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb, getEngineerConsoleDbPath } from "../db/client";
import {
  addGitWorktree,
  commitSeededScaffoldBaseline,
  generateBranchName,
  getChangedFiles,
  ensureHeadRevision,
  GitWorkspaceError,
  removeGitWorktree,
  verifyGitRepo,
} from "./git-workspace";

export const RUN_WORKTREE_STATUSES = [
  "active",
  "recorded_dirty",
  "cleaned",
  "cleanup_blocked",
  "failed",
] as const;

export type RunWorktreeStatus = (typeof RUN_WORKTREE_STATUSES)[number];

export interface RunWorktreeRecord {
  id: string;
  runId: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  baseRevision: string;
  status: RunWorktreeStatus;
  dirtyPaths: string[];
  cleanupBlockedReason: string | null;
  cleanupRecordedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RunWorktreeRow {
  id: string;
  run_id: string;
  repo_path: string;
  worktree_path: string;
  branch_name: string;
  base_revision: string;
  status: string;
  dirty_paths_json: string;
  cleanup_blocked_reason: string | null;
  cleanup_recorded_at: string | null;
  created_at: string;
  updated_at: string;
}

export class WorktreeCleanupError extends Error {
  readonly code = "WORKTREE_CLEANUP_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "WorktreeCleanupError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseDirtyPaths(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Allowlisted QC in a git worktree needs the host repo's installed dependencies. */
export function linkWorktreeRuntimeDependencies(repoPath: string, worktreePath: string): void {
  const source = path.join(path.resolve(repoPath), "node_modules");
  const destination = path.join(path.resolve(worktreePath), "node_modules");
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  fs.symlinkSync(source, destination);
}

const SEED_SKIP_DIRS = new Set(["node_modules", ".git", ".next"]);

/**
 * Copy host working-tree files missing from an isolated worktree.
 * Needed when the repo has uncommitted scaffold (empty HEAD checkout).
 */
export function seedWorktreeFromHostRepo(hostRepoPath: string, worktreePath: string): string[] {
  const seeded: string[] = [];
  const hostRoot = path.resolve(hostRepoPath);
  const worktreeRoot = path.resolve(worktreePath);

  function walk(relativeDir: string): void {
    const hostDir = path.join(hostRoot, relativeDir);
    if (!fs.existsSync(hostDir)) return;
    const entries = fs.readdirSync(hostDir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const normalized = relative.replace(/\\/g, "/");
      if (SEED_SKIP_DIRS.has(entry.name)) continue;
      const hostAbs = path.join(hostRoot, relative);
      const worktreeAbs = path.join(worktreeRoot, relative);
      if (entry.isDirectory()) {
        if (!fs.existsSync(worktreeAbs)) {
          fs.mkdirSync(worktreeAbs, { recursive: true });
        }
        walk(relative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (fs.existsSync(worktreeAbs)) continue;
      fs.mkdirSync(path.dirname(worktreeAbs), { recursive: true });
      fs.copyFileSync(hostAbs, worktreeAbs);
      seeded.push(normalized);
    }
  }

  walk("");
  return seeded;
}

function mapRow(row: RunWorktreeRow): RunWorktreeRecord {
  return {
    id: row.id,
    runId: row.run_id,
    repoPath: row.repo_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    baseRevision: row.base_revision,
    status: row.status as RunWorktreeStatus,
    dirtyPaths: parseDirtyPaths(row.dirty_paths_json),
    cleanupBlockedReason: row.cleanup_blocked_reason,
    cleanupRecordedAt: row.cleanup_recorded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getWorktreeRoot(): string {
  return (
    process.env.ENGINEER_CONSOLE_WORKTREE_ROOT ??
    path.join(path.dirname(getEngineerConsoleDbPath()), "worktrees")
  );
}

export function getRunWorktree(runId: string): RunWorktreeRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_run_worktrees WHERE run_id = ?`)
    .get(runId) as RunWorktreeRow | undefined;
  return row ? mapRow(row) : null;
}

function persist(record: RunWorktreeRecord): void {
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_run_worktrees SET
        status = @status,
        dirty_paths_json = @dirty_paths_json,
        cleanup_blocked_reason = @cleanup_blocked_reason,
        cleanup_recorded_at = @cleanup_recorded_at,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id: record.id,
      status: record.status,
      dirty_paths_json: JSON.stringify(record.dirtyPaths),
      cleanup_blocked_reason: record.cleanupBlockedReason,
      cleanup_recorded_at: record.cleanupRecordedAt,
      updated_at: record.updatedAt,
    });
}

export async function createIsolatedRunWorktree(input: {
  runId: string;
  taskId: string;
  repoPath: string;
}): Promise<RunWorktreeRecord> {
  const existing = getRunWorktree(input.runId);
  if (existing && existing.status === "active" && fs.existsSync(existing.worktreePath)) {
    return existing;
  }

  await verifyGitRepo(input.repoPath);
  const baseRevision = await ensureHeadRevision(input.repoPath);
  const branchName = generateBranchName(input.taskId, input.runId);
  const worktreePath = path.join(getWorktreeRoot(), input.runId);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  try {
    await addGitWorktree({
      repoPath: input.repoPath,
      worktreePath,
      branchName,
      baseRevision,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitWorkspaceError(`Failed to create isolated worktree for run ${input.runId}: ${message}`);
  }

  linkWorktreeRuntimeDependencies(input.repoPath, worktreePath);
  const seeded = seedWorktreeFromHostRepo(input.repoPath, worktreePath);
  let baseRevisionAfterSeed = baseRevision;
  if (seeded.length > 0) {
    const seededHead = await commitSeededScaffoldBaseline(worktreePath, seeded);
    if (seededHead) baseRevisionAfterSeed = seededHead;
  }

  const now = nowIso();
  const record: RunWorktreeRecord = {
    id: uuidv4(),
    runId: input.runId,
    repoPath: path.resolve(input.repoPath),
    worktreePath,
    branchName,
    baseRevision: baseRevisionAfterSeed,
    status: "active",
    dirtyPaths: [],
    cleanupBlockedReason: null,
    cleanupRecordedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_run_worktrees
        (id, run_id, repo_path, worktree_path, branch_name, base_revision, status,
         dirty_paths_json, cleanup_blocked_reason, cleanup_recorded_at, created_at, updated_at)
       VALUES
        (@id, @run_id, @repo_path, @worktree_path, @branch_name, @base_revision, @status,
         @dirty_paths_json, @cleanup_blocked_reason, @cleanup_recorded_at, @created_at, @updated_at)`,
    )
    .run({
      id: record.id,
      run_id: record.runId,
      repo_path: record.repoPath,
      worktree_path: record.worktreePath,
      branch_name: record.branchName,
      base_revision: record.baseRevision,
      status: record.status,
      dirty_paths_json: JSON.stringify(record.dirtyPaths),
      cleanup_blocked_reason: record.cleanupBlockedReason,
      cleanup_recorded_at: record.cleanupRecordedAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });

  return record;
}

/**
 * Governed cleanup. Never silently deletes unrecorded dirty work.
 * Clean worktrees may be removed. Dirty worktrees are recorded and left in place.
 */
export async function cleanupRunWorktree(
  runId: string,
  options: { allowForceIfRecorded?: boolean } = {},
): Promise<RunWorktreeRecord> {
  const record = getRunWorktree(runId);
  if (!record) {
    throw new WorktreeCleanupError(`No worktree recorded for run ${runId}`);
  }
  if (record.status === "cleaned") return record;

  const exists = fs.existsSync(record.worktreePath);
  if (!exists) {
    const updated: RunWorktreeRecord = {
      ...record,
      status: "cleaned",
      cleanupRecordedAt: nowIso(),
      updatedAt: nowIso(),
    };
    persist(updated);
    return updated;
  }

  const dirtyPaths = await getChangedFiles(record.worktreePath);
  if (dirtyPaths.length > 0 && !options.allowForceIfRecorded) {
    const updated: RunWorktreeRecord = {
      ...record,
      status: "cleanup_blocked",
      dirtyPaths,
      cleanupBlockedReason:
        "Worktree has unrecorded or uncommitted changes; refusing silent delete.",
      cleanupRecordedAt: nowIso(),
      updatedAt: nowIso(),
    };
    persist(updated);
    throw new WorktreeCleanupError(updated.cleanupBlockedReason!);
  }

  if (dirtyPaths.length > 0 && options.allowForceIfRecorded) {
    const recorded: RunWorktreeRecord = {
      ...record,
      status: "recorded_dirty",
      dirtyPaths,
      cleanupBlockedReason: "Dirty paths recorded before governed force-remove.",
      cleanupRecordedAt: nowIso(),
      updatedAt: nowIso(),
    };
    persist(recorded);
  }

  try {
    await removeGitWorktree({
      repoPath: record.repoPath,
      worktreePath: record.worktreePath,
      force: Boolean(options.allowForceIfRecorded),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated: RunWorktreeRecord = {
      ...record,
      status: "cleanup_blocked",
      dirtyPaths,
      cleanupBlockedReason: message,
      cleanupRecordedAt: nowIso(),
      updatedAt: nowIso(),
    };
    persist(updated);
    throw new WorktreeCleanupError(message);
  }

  const cleaned: RunWorktreeRecord = {
    ...record,
    status: "cleaned",
    dirtyPaths,
    cleanupBlockedReason: null,
    cleanupRecordedAt: nowIso(),
    updatedAt: nowIso(),
  };
  persist(cleaned);
  return cleaned;
}

export function resolveRunExecutionPath(runId: string, fallbackRepoPath: string): string {
  const worktree = getRunWorktree(runId);
  if (worktree && worktree.status === "active" && fs.existsSync(worktree.worktreePath)) {
    return worktree.worktreePath;
  }
  return fallbackRepoPath;
}

/** Test helper: tmp worktree root isolated from the console data dir. */
export function createTempWorktreeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-ae-wt-"));
}
