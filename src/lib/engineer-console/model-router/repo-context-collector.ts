import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { buildCodeIndexContextSummary } from "../repo-intelligence/code-index/code-index-manager";
import { buildCompatibilityContextSummary } from "../repo-intelligence/compatibility/compatibility-manager";
import { buildIndexedFileInventorySummary } from "../repo-intelligence/file-index/file-index-manager";
import { isProtectedWorkerPath, normalizeRelativePath } from "../worker-plan/path-safety";

const execFileAsync = promisify(execFile);

export const DEFAULT_MAX_FILE_BYTES = 32_768;
export const DEFAULT_MAX_TOTAL_CONTEXT_BYTES = 200_000;
export const DEFAULT_MAX_TREE_DEPTH = 3;

export interface RepoContextCollectorOptions {
  repoPath: string;
  registeredRepoId?: string;
  /** Task title/description terms for ranking symbols/chunks in code index summary. */
  taskSearchTerms?: string[];
  includeFileContents?: string[];
  maxFileBytes?: number;
  maxTotalContextBytes?: number;
  maxTreeDepth?: number;
  branchName?: string | null;
}

export interface SkippedFileEntry {
  path: string;
  reason: string;
}

export interface RepoContextResult {
  packageScripts: Record<string, string>;
  fileTree: string[];
  fileContents: Array<{ path: string; content: string }>;
  gitStatus: string;
  currentBranch: string | null;
  readmeSummary: string | null;
  contextSummary: string;
  skippedFiles: SkippedFileEntry[];
  totalBytesCollected: number;
}

function readPackageScripts(repoPath: string): Record<string, string> {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function shouldSkipEntry(name: string): boolean {
  if (name === ".git" || name === "node_modules") return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  return false;
}

function walkTree(
  dir: string,
  repoRoot: string,
  depth: number,
  maxDepth: number,
  entries: string[],
): void {
  if (depth > maxDepth) return;
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (shouldSkipEntry(item.name)) continue;
    const full = path.join(dir, item.name);
    const relative = normalizeRelativePath(path.relative(repoRoot, full));
    if (isProtectedWorkerPath(relative, {})) continue;

    entries.push(item.isDirectory() ? `${relative}/` : relative);
    if (item.isDirectory()) {
      walkTree(full, repoRoot, depth + 1, maxDepth, entries);
    }
  }
}

async function getGitStatus(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "status", "--short", "-uall"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
      { maxBuffer: 64 * 1024 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function readReadmeSummary(repoPath: string, maxBytes: number): string | null {
  for (const name of ["README.md", "readme.md", "README"]) {
    const readmePath = path.join(repoPath, name);
    if (!fs.existsSync(readmePath)) continue;
    try {
      const buf = fs.readFileSync(readmePath);
      const text = buf.slice(0, maxBytes).toString("utf8");
      const lines = text.split("\n").slice(0, 20);
      return lines.join("\n").trim();
    } catch {
      continue;
    }
  }
  return null;
}

function tryReadFile(
  repoPath: string,
  relativePath: string,
  maxFileBytes: number,
): { content?: string; skip?: SkippedFileEntry } {
  const normalized = normalizeRelativePath(relativePath);
  if (isProtectedWorkerPath(normalized, {})) {
    return {
      skip: { path: normalized, reason: "Protected path" },
    };
  }

  const absolute = path.resolve(repoPath, normalized);
  const repoResolved = path.resolve(repoPath);
  if (!absolute.startsWith(repoResolved + path.sep) && absolute !== repoResolved) {
    return { skip: { path: normalized, reason: "Path escapes repo root" } };
  }

  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    return { skip: { path: normalized, reason: "File not found or is directory" } };
  }

  const size = fs.statSync(absolute).size;
  if (size > maxFileBytes) {
    return {
      skip: {
        path: normalized,
        reason: `Exceeds max file size (${size} > ${maxFileBytes})`,
      },
    };
  }

  return { content: fs.readFileSync(absolute, "utf8") };
}

export async function collectRepoContext(
  options: RepoContextCollectorOptions,
): Promise<RepoContextResult> {
  const repoPath = path.resolve(options.repoPath);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotal = options.maxTotalContextBytes ?? DEFAULT_MAX_TOTAL_CONTEXT_BYTES;
  const maxDepth = options.maxTreeDepth ?? DEFAULT_MAX_TREE_DEPTH;

  const packageScripts = readPackageScripts(repoPath);
  const fileTree: string[] = [];
  walkTree(repoPath, repoPath, 0, maxDepth, fileTree);

  const skippedFiles: SkippedFileEntry[] = [];
  const fileContents: Array<{ path: string; content: string }> = [];
  let totalBytesCollected = 0;

  const pathsToRead = options.includeFileContents ?? [];
  for (const rel of pathsToRead) {
    if (totalBytesCollected >= maxTotal) {
      skippedFiles.push({ path: rel, reason: "Total context size limit reached" });
      continue;
    }
    const result = tryReadFile(repoPath, rel, maxFileBytes);
    if (result.skip) {
      skippedFiles.push(result.skip);
      continue;
    }
    if (result.content !== undefined) {
      const bytes = Buffer.byteLength(result.content, "utf8");
      if (totalBytesCollected + bytes > maxTotal) {
        skippedFiles.push({ path: rel, reason: "Total context size limit reached" });
        continue;
      }
      totalBytesCollected += bytes;
      fileContents.push({ path: normalizeRelativePath(rel), content: result.content });
    }
  }

  const gitStatus = await getGitStatus(repoPath);
  const currentBranch =
    options.branchName ?? (await getCurrentBranch(repoPath));
  const readmeSummary = readReadmeSummary(repoPath, 4096);
  const indexedInventory = options.registeredRepoId
    ? buildIndexedFileInventorySummary(options.registeredRepoId)
    : null;
  const codeIndexSummary = options.registeredRepoId
    ? buildCodeIndexContextSummary(options.registeredRepoId, options.taskSearchTerms ?? [])
    : null;
  const compatibilitySummary = options.registeredRepoId
    ? buildCompatibilityContextSummary(options.registeredRepoId, options.taskSearchTerms ?? [])
    : null;

  const contextSummary = [
    `Branch: ${currentBranch ?? "unknown"}`,
    `File tree entries: ${fileTree.length} (depth <= ${maxDepth})`,
    `Package scripts: ${Object.keys(packageScripts).join(", ") || "none"}`,
    indexedInventory ? `File index:\n${indexedInventory}` : "File index: not available",
    codeIndexSummary ? `Code index:\n${codeIndexSummary}` : "Code index: not available",
    compatibilitySummary
      ? `Compatibility:\n${compatibilitySummary}`
      : "Compatibility: not available",
    readmeSummary ? `README excerpt:\n${readmeSummary}` : "README: not found",
    gitStatus ? `Git status:\n${gitStatus}` : "Git status: clean or unavailable",
    fileContents.length > 0
      ? `Included file contents: ${fileContents.map((f) => f.path).join(", ")}`
      : "Included file contents: none",
    skippedFiles.length > 0
      ? `Skipped: ${skippedFiles.map((s) => `${s.path} (${s.reason})`).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    packageScripts,
    fileTree,
    fileContents,
    gitStatus,
    currentBranch,
    readmeSummary,
    contextSummary,
    skippedFiles,
    totalBytesCollected,
  };
}
