import fs from "fs";
import path from "path";
import { collectRepoContext } from "../model-router/repo-context-collector";
import { searchSymbols } from "../repo-intelligence/code-index/search-symbols";
import { listIndexedFiles } from "../repo-intelligence/file-index/list-indexed-files";
import { getGitLog, getGitStatus, verifyGitRepo } from "../workspace/git-workspace";
import { isProtectedWorkerPath, resolvePathWithinRepo } from "../worker-plan/path-safety";
import type { AutonomousAuthorityEnvelope, InvestigationObservation } from "./types";
import { isInvestigationPathAllowed } from "./authority";
import { BudgetExhaustedError, checkBudget } from "./budget";
import type { AutonomousBudgetConfig, AutonomousBudgetUsage } from "./types";

export type InvestigationOperation =
  | { type: "search_files"; query: string }
  | { type: "search_symbols"; query: string }
  | { type: "read_file"; path: string }
  | { type: "list_tree" }
  | { type: "git_status" }
  | { type: "git_log" }
  | { type: "package_scripts" }
  | { type: "read_config"; path: string };

export interface InvestigationContext {
  repoPath: string;
  registeredRepoId: string | null;
  envelope: AutonomousAuthorityEnvelope;
  budget: AutonomousBudgetConfig;
  usage: AutonomousBudgetUsage;
  taskSearchTerms: string[];
}

export interface InvestigationResult {
  observations: InvestigationObservation[];
  packageScripts: Record<string, string>;
  fileTree: string[];
  fileContents: Array<{ path: string; content: string }>;
  gitStatus: string;
  gitLog: string;
  contextSummary: string;
  usage: AutonomousBudgetUsage;
}

function nowIso(): string {
  return new Date().toISOString();
}

function observation(
  operation: string,
  summary: string,
  extra: Partial<InvestigationObservation> = {},
): InvestigationObservation {
  return { at: nowIso(), operation, summary, ...extra };
}

function assertReadAllowed(envelope: AutonomousAuthorityEnvelope, relativePath: string): void {
  const protectedPath = isProtectedWorkerPath(relativePath, {});
  if (protectedPath) {
    throw new Error(`Investigation blocked for protected path: ${relativePath}`);
  }
  if (envelope.authorizedPathPrefixes.length === 0) return;
  if (isInvestigationPathAllowed(envelope, relativePath)) return;
  throw new Error(`Investigation path not in authority envelope: ${relativePath}`);
}

function chargeRead(
  usage: AutonomousBudgetUsage,
  budget: AutonomousBudgetConfig,
  bytes: number,
): void {
  checkBudget(budget, usage, "investigationReads", 1);
  usage.investigationReads += 1;
  checkBudget(budget, usage, "contextBytes", bytes);
  usage.contextBytes += bytes;
}

export async function runInvestigation(
  ctx: InvestigationContext,
  operations: InvestigationOperation[] = [{ type: "list_tree" }, { type: "package_scripts" }, { type: "git_status" }],
): Promise<InvestigationResult> {
  await verifyGitRepo(ctx.repoPath);
  const usage = { ...ctx.usage };
  const observations: InvestigationObservation[] = [];
  const fileContents: Array<{ path: string; content: string }> = [];

  const repoContext = await collectRepoContext({
    repoPath: ctx.repoPath,
    registeredRepoId: ctx.registeredRepoId ?? undefined,
    taskSearchTerms: ctx.taskSearchTerms,
    maxTotalContextBytes: ctx.budget.max_context_bytes,
  });

  chargeRead(usage, ctx.budget, Math.min(repoContext.totalBytesCollected, ctx.budget.max_context_bytes));
  observations.push(
    observation("collect_repo_context", "Collected bounded repo context", {
      detail: repoContext.contextSummary.slice(0, 500),
    }),
  );

  let gitLog = "";
  let gitStatus = repoContext.gitStatus;

  for (const op of operations) {
    switch (op.type) {
      case "search_files": {
        if (!ctx.registeredRepoId) {
          observations.push(observation("search_files", "No registered repo index; skipped file search"));
          break;
        }
        const files = listIndexedFiles({ repoId: ctx.registeredRepoId, q: op.query, limit: 40 });
        observations.push(
          observation("search_files", `Indexed file search for "${op.query}" returned ${files.length} path(s)`, {
            paths: files.map((file) => file.relativePath),
          }),
        );
        break;
      }
      case "search_symbols": {
        if (!ctx.registeredRepoId) {
          observations.push(observation("search_symbols", "No registered repo index; skipped symbol search"));
          break;
        }
        const symbols = searchSymbols({ repoId: ctx.registeredRepoId, q: op.query, limit: 40 });
        observations.push(
          observation("search_symbols", `Symbol search for "${op.query}" returned ${symbols.length} hit(s)`, {
            paths: symbols.map((symbol) => symbol.relativePath),
          }),
        );
        break;
      }
      case "read_file":
      case "read_config": {
        assertReadAllowed(ctx.envelope, op.path);
        const resolved = resolvePathWithinRepo(ctx.repoPath, op.path);
        if (!resolved.ok) {
          observations.push(observation(op.type, `Blocked read: ${resolved.error.message}`, { paths: [op.path] }));
          break;
        }
        try {
          const content = fs.readFileSync(resolved.resolved.absolutePath, "utf8");
          const slice = content.slice(0, 16_384);
          chargeRead(usage, ctx.budget, slice.length);
          fileContents.push({ path: resolved.resolved.relativePath, content: slice });
          observations.push(observation(op.type, `Read ${resolved.resolved.relativePath}`, { paths: [op.path] }));
        } catch {
          observations.push(observation(op.type, `File not readable: ${op.path}`, { paths: [op.path] }));
        }
        break;
      }
      case "list_tree": {
        observations.push(
          observation("list_tree", `Directory structure (${repoContext.fileTree.length} entries)`, {
            paths: repoContext.fileTree.slice(0, 80),
          }),
        );
        break;
      }
      case "git_status": {
        gitStatus = await getGitStatus(ctx.repoPath);
        observations.push(observation("git_status", gitStatus || "Working tree clean"));
        break;
      }
      case "git_log": {
        gitLog = await getGitLog(ctx.repoPath);
        observations.push(observation("git_log", gitLog || "No git log"));
        break;
      }
      case "package_scripts": {
        const names = Object.keys(repoContext.packageScripts);
        observations.push(
          observation(
            "package_scripts",
            names.length > 0 ? `package.json scripts: ${names.join(", ")}` : "No package.json scripts detected",
          ),
        );
        break;
      }
    }
  }

  return {
    observations,
    packageScripts: repoContext.packageScripts,
    fileTree: repoContext.fileTree,
    fileContents,
    gitStatus,
    gitLog,
    contextSummary: repoContext.contextSummary,
    usage,
  };
}

export function defaultInvestigationOperations(objective: string): InvestigationOperation[] {
  const ops: InvestigationOperation[] = [
    { type: "list_tree" },
    { type: "package_scripts" },
    { type: "git_status" },
    { type: "git_log" },
    { type: "read_config", path: "package.json" },
  ];
  const tokens = objective
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 6);
  for (const token of tokens) {
    ops.push({ type: "search_files", query: token });
    ops.push({ type: "search_symbols", query: token });
  }
  return ops;
}

export function fileLooksLikeTestOrConfig(relativePath: string): boolean {
  const name = path.basename(relativePath).toLowerCase();
  return (
    name.includes("test") ||
    name.endsWith(".config.ts") ||
    name.endsWith(".config.js") ||
    name === "package.json" ||
    name === "vitest.config.ts"
  );
}

export { BudgetExhaustedError };
