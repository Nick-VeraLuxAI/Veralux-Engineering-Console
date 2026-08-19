import fs from "fs";
import path from "path";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";

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

/**
 * Live models often pick create vs update incorrectly. Coerce to the worktree
 * without weakening the worker-plan schema: operations stay typed and validated.
 */
export function coerceWorkerPlanToWorktree(repoPath: string, plan: WorkerPlan): WorkerPlan {
  const operations = (plan.operations ?? []).map((operation) => {
    const relative = operation.path.replace(/^\.?\//, "");
    const exists = fs.existsSync(path.join(repoPath, relative));
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
    if (operation.content.length >= existing.length * TRUNCATION_RATIO) continue;
    errors.push(
      `operation ${index} truncates ${operation.path} from ${existing.length} to ${operation.content.length} bytes; add a new small file instead of rewriting a large module`,
    );
  }
  return errors;
}
