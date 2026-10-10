import fs from "fs";
import path from "path";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import {
  isProtectedScaffoldPath,
  normalizeScaffoldRelativePath,
  SNIPPET_PRIORITY_PATHS,
  validateProtectedScaffoldContent,
} from "./scaffold-contract-guard";

function walkFiles(root: string, prefix: string, acc: string[], limit: number): void {
  if (acc.length >= limit) return;
  const abs = path.join(root, prefix);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    acc.push(prefix.replace(/\\/g, "/"));
    return;
  }
  if (!stat.isDirectory()) return;
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= limit) return;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".next") continue;
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) walkFiles(root, rel, acc, limit);
    else if (entry.isFile()) acc.push(rel.replace(/\\/g, "/"));
  }
}

export function listAuthorizedWorktreeFiles(
  repoPath: string,
  prefixes: string[],
  limit = 48,
): string[] {
  const acc: string[] = [];
  const roots = prefixes.length > 0 ? prefixes : ["src/"];
  for (const prefix of roots) {
    walkFiles(repoPath, prefix.replace(/^\.?\//, ""), acc, limit);
  }
  return acc;
}

/** Bounded source snippets for planning — required to repair existing modules instead of guessing. */
export function readAuthorizedWorktreeSnippets(
  repoPath: string,
  prefixes: string[],
  options: {
    maxFiles?: number;
    maxBytesPerFile?: number;
    maxTotalBytes?: number;
    priorityPaths?: readonly string[];
  } = {},
): Array<{ path: string; content: string }> {
  // Keep defaults small enough for ~8k-token local workers after prompts/overhead.
  const maxFiles = options.maxFiles ?? 4;
  const maxBytesPerFile = options.maxBytesPerFile ?? 1_800;
  const maxTotalBytes = options.maxTotalBytes ?? 6_000;
  const priorityPaths = options.priorityPaths ?? SNIPPET_PRIORITY_PATHS;
  const files = listAuthorizedWorktreeFiles(repoPath, prefixes, Math.max(maxFiles * 3, 24));
  const snippets: Array<{ path: string; content: string }> = [];
  let total = 0;

  const readSnippet = (relative: string): boolean => {
    if (snippets.length >= maxFiles || total >= maxTotalBytes) return false;
    const absolute = path.join(repoPath, relative);
    try {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
      const raw = fs.readFileSync(absolute, "utf8");
      const content = raw.slice(0, Math.min(maxBytesPerFile, maxTotalBytes - total));
      snippets.push({ path: relative, content });
      total += content.length;
      return true;
    } catch {
      return false;
    }
  };

  for (const relative of priorityPaths) {
    if (snippets.some((snippet) => snippet.path === relative)) continue;
    readSnippet(relative.replace(/^\.?\//, ""));
  }

  // Prefer smaller modules (easier to remediate) over giant orchestrators.
  const ranked = files
    .filter((relative) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relative))
    .filter((relative) => !/\.test\.(ts|tsx|js|jsx)$/.test(relative) && !relative.includes("__tests__/"))
    .filter((relative) => !snippets.some((snippet) => snippet.path === relative))
    .map((relative) => {
      const absolute = path.join(repoPath, relative);
      try {
        return { relative, size: fs.statSync(absolute).size };
      } catch {
        return { relative, size: Number.MAX_SAFE_INTEGER };
      }
    })
    .sort((a, b) => a.size - b.size)
    .map((entry) => entry.relative);
  for (const relative of ranked) {
    if (snippets.length >= maxFiles || total >= maxTotalBytes) break;
    readSnippet(relative);
  }
  return snippets;
}

/**
 * Live models often pick create vs update incorrectly. Coerce to the worktree
 * without weakening the worker-plan schema: operations stay typed and validated.
 */
export function coerceWorkerPlanToWorktree(repoPath: string, plan: WorkerPlan): WorkerPlan {
  const operations = (plan.operations ?? []).map((operation) => {
    const relative = operation.path.replace(/^\.?\//, "");
    const exists = fs.existsSync(path.join(repoPath, relative));
    if (operation.type === "delete_file") {
      return { ...operation, path: relative, content: "" };
    }
    if (operation.type === "create_file" && exists) {
      return { ...operation, type: "update_file" as const, path: relative };
    }
    if ((operation.type === "update_file" || operation.type === "append_file") && !exists) {
      return { ...operation, type: "create_file" as const, path: relative };
    }
    return { ...operation, path: relative };
  });
  const allowedFiles = [
    ...new Set([...(plan.allowedFiles ?? []), ...operations.map((operation) => operation.path)]),
  ];
  return { ...plan, operations, allowedFiles };
}

const LARGE_FILE_BYTES = 2500;
const TRUNCATION_RATIO = 0.5;

/** Reject updates/appends that would gut or tack onto an existing large module. */
export function truncatingUpdateErrors(repoPath: string, plan: WorkerPlan): string[] {
  const errors: string[] = [];
  for (const [index, operation] of (plan.operations ?? []).entries()) {
    const abs = path.join(repoPath, operation.path.replace(/^\.?\//, ""));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const existing = fs.readFileSync(abs, "utf8");
    if (existing.length < LARGE_FILE_BYTES) continue;
    if (operation.type === "append_file") {
      errors.push(
        `operation ${index} appends to large file ${operation.path} (${existing.length} bytes); add a new small file instead of modifying a large module`,
      );
      continue;
    }
    if (operation.type !== "update_file") continue;
    if (isProtectedScaffoldPath(operation.path)) {
      const regressions = validateProtectedScaffoldContent({
        baselineRepoPath: repoPath,
        relativePath: normalizeScaffoldRelativePath(operation.path),
        nextContent: operation.content,
      });
      if (regressions.length > 0) {
        errors.push(`operation ${index} regresses protected scaffold ${operation.path}: ${regressions[0]}`);
        continue;
      }
    }
    if (operation.content.length >= existing.length * TRUNCATION_RATIO) continue;
    errors.push(
      `operation ${index} truncates ${operation.path} from ${existing.length} to ${operation.content.length} bytes; add a new small file instead of rewriting a large module`,
    );
  }
  return errors;
}
